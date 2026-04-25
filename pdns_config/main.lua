-- DNSDist Bloom Filter & Routing Engine
-- Hardware acceleration loaded via C-Native Bindings 

local bloom_c = nil
local ok, err = pcall(function()
    package.cpath = package.cpath .. ";/etc/powerdns/?.so"
    bloom_c = require("bloom_native")
end)

if not ok then
    print("[DNSDist] FATAL: Failed to load bloom_native extension: " .. tostring(err))
else
    print("[DNSDist] SUCCESS: Native C Bloom Filter Engine Loaded")
end

function _G.reload_bloom()
    if bloom_c then
        bloom_c.reload()
    end
end

function bloom_router(dq)
    local domain = dq.qname:toString()
    
    if bloom_c and bloom_c.check(domain) then
        return DNSAction.Pool, "POWERDNS"
    end
    
    return DNSAction.None, ""
end
