-- Lua PreResolve Hook for ACL Management
acl = newNMG()

-- Open query log file safely
local logfile = io.open("/var/log/pdns-queries.log", "a")
if logfile then logfile:setvbuf("line") end

-- Load Allowed IPs from text file
local acl_file = "/etc/powerdns/allowed_ips.txt"
local f = io.open(acl_file, "r")
if f then
    for line in f:lines() do
        if line:match("%S") and not line:match("^#") then
            acl:addMask(line)
        end
    end
    f:close()
end

function gettag(remote, ednsmask, localmac, qname, qtype, ednsoptions, tcp)
    local action = "ALLOW"
    local drop = false

    if not acl:match(remote) then
        action = "DROP_ACL"
        drop = true
    end

    if logfile then
        logfile:write(string.format('{"time":%d, "ip":"%s", "qname":"%s", "type":%d, "action":"%s"}\n', os.time(), remote:toString(), qname:toString(), qtype, action))
    end

    if drop then
        return 1
    end
    return 0
end

function preresolve(dq)
    -- Enforce ACL Drop (Return REFUSED)
    if not acl:match(dq.remoteaddr) then
        dq.rcode = pdns.REFUSED
        return true
    end

    if dq.appliedPolicy and dq.appliedPolicy.policyKind ~= pdns.policykinds.NoAction then
        if logfile then
            logfile:write(string.format('{"time":%d, "ip":"%s", "qname":"%s", "type":%d, "action":"DROP_RPZ"}\n', os.time(), dq.remoteaddr:toString(), dq.qname:toString(), dq.qtype))
        end
    end
    return false
end
