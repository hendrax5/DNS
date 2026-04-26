local function domainFNV1a(domain)
    local hash = 0xCBF29CE484222325
    local prime = 0x100000001B3
    for part in string.gmatch(domain, "[^%.]+") do
        hash = hash ~ #part
        hash = hash * prime
        for i=1, #part do
            local byte = string.byte(part, i)
            if byte >= 65 and byte <= 90 then byte = byte + 32 end
            hash = hash ~ byte
            hash = hash * prime
        end
    end
    return hash
end

print(string.format("0x%X", domainFNV1a("youporn.com")))
print(string.format("0x%X", domainFNV1a("salt_byouporn.com")))
