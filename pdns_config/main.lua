-- DNSDist Bloom Filter & Routing Engine
-- Cross-Compatible with LuaJIT (FFI) and Standard Lua 5.4

local enable_mmap = false
local has_ffi, ffi = pcall(require, "ffi")
local has_bit, bit = pcall(require, "bit")

if has_ffi and has_bit then
    enable_mmap = true
end

local checkBloom_func

if enable_mmap then
    ffi.cdef[[
        int open(const char *pathname, int flags);
        void *mmap(void *addr, size_t length, int prot, int flags, int fd, int64_t offset);
        int close(int fd);
        typedef uint32_t mode_t;
    ]]

    local O_RDONLY = 0
    local PROT_READ = 1
    local MAP_SHARED = 1

    local bloom_ptr = nil
    local bloom_fd = -1
    local bloom_size = 33554432 -- 32MB

    function _G.reload_bloom()
        if bloom_fd ~= -1 then
            ffi.C.close(bloom_fd)
        end
        bloom_fd = ffi.C.open("/etc/powerdns/bloom.bin", O_RDONLY)
        if bloom_fd >= 0 then
            local ptr = ffi.C.mmap(nil, bloom_size, PROT_READ, MAP_SHARED, bloom_fd, 0)
            bloom_ptr = ffi.cast("uint8_t *", ptr)
        else
            bloom_ptr = nil
        end
    end

    _G.reload_bloom()

    local function domainFNV1a(domain)
        local hash = ffi.new("uint64_t", 0xcbf29ce484222325ULL)
        local prime = ffi.new("uint64_t", 0x100000001b3ULL)
        
        for part in string.gmatch(domain, "[^%.]+") do
            hash = bit.bxor(hash, ffi.new("uint64_t", #part))
            hash = hash * prime
            for i=1, #part do
                local byte = string.byte(part, i)
                if byte >= 65 and byte <= 90 then byte = byte + 32 end 
                hash = bit.bxor(hash, ffi.new("uint64_t", byte))
                hash = hash * prime
            end
        end
        return hash
    end

    checkBloom_func = function(domain)
        if bloom_ptr == nil then return false end
        local h1 = domainFNV1a(domain)
        local h2 = domainFNV1a("salt_b" .. domain)
        
        local mBits = ffi.new("uint64_t", 268435456ULL)
        local k = 9
        
        for i=0, k-1 do
            local idx = tonumber((h1 + ffi.new("uint64_t", i)*h2) % mBits)
            local byteIdx = math.floor(idx / 8)
            local bitIdx = idx % 8
            local byteVal = bloom_ptr[byteIdx]
            if bit.band(byteVal, bit.lshift(1, bitIdx)) == 0 then
                return false
            end
        end
        return true
    end

else
    -- Fallback to Standard Lua (String buffering instead of mmap)
    local fallback_code = [[
        local bloom_str = ""
        function _G.reload_bloom()
            local f = io.open("/etc/powerdns/bloom.bin", "rb")
            if f then
                bloom_str = f:read("*a")
                f:close()
            end
        end

        local function domainFNV1a(domain)
            local hash = 2166136261
            local prime = 16777619
            for part in string.gmatch(domain, "[^%.]+") do
                hash = (hash ~ #part)
                hash = (hash * prime) & 0xFFFFFFFF
                for i=1, #part do
                    local byte = string.byte(part, i)
                    if byte >= 65 and byte <= 90 then byte = byte + 32 end
                    hash = (hash ~ byte)
                    hash = (hash * prime) & 0xFFFFFFFF
                end
            end
            return hash
        end

        return function(domain)
            if #bloom_str == 0 then return false end
            local h1 = domainFNV1a(domain)
            local h2 = domainFNV1a("salt_b" .. domain)
            
            local mBits = 268435456
            local k = 9
            
            for i=0, k-1 do
                local idx = (h1 + i * h2) % mBits
                local byteIdx = math.floor(idx / 8)
                local bitIdx = idx % 8
                
                local byteVal = string.byte(bloom_str, byteIdx + 1)
                if not byteVal then return false end
                
                if (byteVal & (1 << bitIdx)) == 0 then
                    return false
                end
            end
            return true
        end
    ]]
    
    local ok, pure_func_gen = pcall(load, fallback_code)
    if ok and pure_func_gen then
        checkBloom_func = pure_func_gen()
        _G.reload_bloom()
    else
        -- Absolute fallback so DNS is not disrupted
        function _G.reload_bloom() end
        checkBloom_func = function(domain) return false end
    end
end

-- Primary Router Handler
function bloom_router(dq)
    local qname = dq.qname:toString()
    qname = string.gsub(qname, "%.$", "")
    
    local is_dirty = checkBloom_func(qname)
    if is_dirty then
        -- Kirim ke PowerDNS Recursor (RPZ Engine)
        return DNSAction.Pool, "POWERDNS"
    end
    
    -- Kirim ke Unbound Resolver (Pure Fast Resolution)
    return DNSAction.Pool, "UNBOUND"
end
