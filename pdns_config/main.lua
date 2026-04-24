-- DNSDist LUA FFI & Routing Engine
local ffi = require("ffi")
local bit = require("bit")

-- FFI C Declarations for MMAP
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

-- Hot Swap Reload (RCU Pattern)
function reload_bloom()
    if bloom_fd ~= -1 then
        ffi.C.close(bloom_fd)
    end
    bloom_fd = ffi.C.open("/etc/powerdns/bloom.bin", O_RDONLY)
    if bloom_fd >= 0 then
        bloom_ptr = ffi.C.mmap(nil, bloom_size, PROT_READ, MAP_SHARED, bloom_fd, 0)
        bloom_ptr = ffi.cast("uint8_t *", bloom_ptr)
    else
        bloom_ptr = nil
    end
end

reload_bloom()

-- FNV-1a Hash (Identik dengan C/Go Implementation Generator)
local function domainFNV1a(domain)
    local hash = ffi.new("uint64_t", 0xcbf29ce484222325ULL)
    local prime = ffi.new("uint64_t", 0x100000001b3ULL)
    
    for part in string.gmatch(domain, "[^%.]+") do
        hash = bit.bxor(hash, ffi.new("uint64_t", #part))
        hash = hash * prime
        for i=1, #part do
            local byte = string.byte(part, i)
            if byte >= 65 and byte <= 90 then byte = byte + 32 end -- lowercase
            hash = bit.bxor(hash, ffi.new("uint64_t", byte))
            hash = hash * prime
        end
    end
    return hash
end

local function checkBloom(domain)
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

function bloom_router(dq)
    local qname = dq.qname:toString()
    qname = string.gsub(qname, "%.$", "")
    
    -- Telemetry & Anomaly Logging bypass code ...
    
    local is_dirty = checkBloom(qname)
    if is_dirty then
        -- Kirim ke PowerDNS Recursor (RPZ Engine)
        return DNSAction.Pool, "POWERDNS"
    end
    
    -- Kirim ke Unbound Resolver (Pure Fast Resolution)
    return DNSAction.Pool, "UNBOUND"
end
