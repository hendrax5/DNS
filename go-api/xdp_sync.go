package main

// XDP Domain Hash Utility
// Menghitung FNV-1a hash untuk domain, identik dengan implementasi di dns_filter.c
// Hash ini digunakan sebagai key di BPF map untuk lookup O(1) di kernel.

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"log"

	"github.com/gofiber/fiber/v2"
)

const (
	fnvOffsetBasis = uint64(0xcbf29ce484222325)
	fnvPrime       = uint64(0x100000001b3)
)

// domainFNV1a menghitung FNV-1a hash dari nama domain dalam DNS wire format
// Wire format: "google.com" → \x06google\x03com (tanpa null terminator)
// Harus IDENTIK dengan flat loop di xdp/setup_xdp_host.sh
func domainFNV1a(domain string) uint64 {
	domain = strings.TrimSuffix(strings.ToLower(domain), ".")
	// Convert ke wire format dan hash setiap byte
	parts := strings.Split(domain, ".")
	hash := fnvOffsetBasis
	for _, part := range parts {
		// Hash length byte
		hash ^= uint64(len(part))
		hash *= fnvPrime
		// Hash label bytes
		for i := 0; i < len(part); i++ {
			c := part[i]
			if c >= 'A' && c <= 'Z' { c += 32 }
			hash ^= uint64(c)
			hash *= fnvPrime
		}
	}
	return hash
}

// domainHashHex mengembalikan hex string 16 karakter (little-endian, cocok untuk bpftool)
func domainHashHex(domain string) string {
	h := domainFNV1a(domain)
	buf := make([]byte, 8)
	binary.LittleEndian.PutUint64(buf, h)
	return hex.EncodeToString(buf)
}

// syncDomainsToXDP menulis hash domain ke file dan panggil xdp_manager.sh sync
func syncDomainsToXDP(domains []string) {
	hashFile := "/tmp/xdp_hashes.txt"

	var lines []string
	for _, dom := range domains {
		dom = strings.TrimSpace(dom)
		if dom == "" { continue }
		h := domainHashHex(dom)
		// Format: hex bytes separated by spaces for bpftool
		spaced := ""
		for i := 0; i < len(h); i += 2 {
			if i > 0 { spaced += " " }
			spaced += h[i:i+2]
		}
		lines = append(lines, spaced)
	}

	content := strings.Join(lines, "\n")
	os.WriteFile(hashFile, []byte(content), 0644)

	out, err := exec.Command("/etc/xdp/xdp_manager.sh", "sync", hashFile).CombinedOutput()
	if err != nil {
		log.Printf("[XDP Sync] Error: %v - %s", err, string(out))
	} else {
		log.Printf("[XDP Sync] %s", strings.TrimSpace(string(out)))
	}
}

// isXDPActive mengecek apakah XDP filter sedang aktif
func isXDPActive() bool {
	out, err := exec.Command("/etc/xdp/xdp_manager.sh", "stats").CombinedOutput()
	if err != nil { return false }
	return strings.Contains(string(out), `"xdp_active": true`)
}

// getXDPStats mendapatkan statistik XDP
func getXDPStats() string {
	out, _ := exec.Command("/etc/xdp/xdp_manager.sh", "stats").CombinedOutput()
	return strings.TrimSpace(string(out))
}

// Standalone mode: bisa dijalankan langsung untuk testing hash
func xdpHashMain() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: xdp_hash <domain>")
		os.Exit(1)
	}
	domain := os.Args[1]
	h := domainFNV1a(domain)
	fmt.Printf("Domain: %s\nHash:   0x%016x\nHex LE: %s\n", domain, h, domainHashHex(domain))
}

// API: XDP Statistics
func GetXDPStatsAPI(c *fiber.Ctx) error {
	stats := getXDPStats()
	if stats == "" {
		return c.JSON(fiber.Map{"xdp_active": false, "message": "XDP not available"})
	}
	// Return raw JSON from xdp_manager.sh stats
	c.Set("Content-Type", "application/json")
	return c.SendString(stats)
}

// API: Toggle XDP on/off
func ToggleXDP(c *fiber.Ctx) error {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Enabled {
		out, err := exec.Command("/etc/xdp/xdp_manager.sh", "load").CombinedOutput()
		if err != nil {
			return c.JSON(fiber.Map{"success": false, "message": string(out)})
		}
		return c.JSON(fiber.Map{"success": true, "message": "XDP filter activated"})
	} else {
		exec.Command("/etc/xdp/xdp_manager.sh", "unload").Run()
		return c.JSON(fiber.Map{"success": true, "message": "XDP filter deactivated"})
	}
}
