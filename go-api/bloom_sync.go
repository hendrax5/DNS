package main

import (
	"log"
	"os"
	"os/exec"
)

// generateBloomFilter creates a 32MB Bloom Filter from the parsed domains.
// Expected memory footprint: exactly 33,554,432 bytes.
func generateBloomFilter(domains map[string]struct{}) {
	var mBits uint64 = 268435456 // 32MB in bits (2^28)
	var mBytes uint64 = 33554432
	var k int = 9

	bloom := make([]byte, mBytes)

	for d := range domains {
		h1 := domainFNV1a(d)
		h2 := domainFNV1a("salt_b" + d)

		for i := 0; i < k; i++ {
			idx := (h1 + uint64(i)*h2) % mBits
			byteIdx := idx / 8
			bitIdx := idx % 8
			bloom[byteIdx] |= (1 << bitIdx)
		}
	}

	tmpFile := "/etc/powerdns/bloom.bin.tmp"
	err := os.WriteFile(tmpFile, bloom, 0644)
	if err != nil {
		log.Printf("[Bloom Sync] Error writing tmp file: %v\n", err)
		return
	}

	// Atomic RCU Swap
	err = os.Rename(tmpFile, "/etc/powerdns/bloom.bin")
	if err != nil {
		log.Printf("[Bloom Sync] Error atomic swap: %v\n", err)
		return
	}
	
	// Instruct DNSDist to re-map the new file
	exec.Command("dnsdist", "-c", "127.0.0.1:5199", "-k", "odCw4adPMwaEYslkALNwp4K7UksD3av9TGpDeSge814=", "-e", "reload_bloom()").Run()
	
	log.Printf("[Bloom Sync] Generated 32MB Bloom Filter for %d domains.\n", len(domains))
}
