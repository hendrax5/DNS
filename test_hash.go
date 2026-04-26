package main
import (
	"fmt"
	"strings"
)

var fnvOffsetBasis = uint64(0xcbf29ce484222325)
var fnvPrime       = uint64(0x100000001b3)

func domainFNV1a(domain string) uint64 {
	domain = strings.TrimSuffix(strings.ToLower(domain), ".")
	parts := strings.Split(domain, ".")
	hash := fnvOffsetBasis
	for _, part := range parts {
		hash ^= uint64(len(part))
		hash *= fnvPrime
		for i := 0; i < len(part); i++ {
			c := part[i]
			if c >= 'A' && c <= 'Z' { c += 32 }
			hash ^= uint64(c)
			hash *= fnvPrime
		}
	}
	return hash
}

func main() {
	fmt.Printf("0x%X\n", domainFNV1a("youporn.com"))
	fmt.Printf("0x%X\n", domainFNV1a("salt_byouporn.com"))
}
