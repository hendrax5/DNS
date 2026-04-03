package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

type ZoneRecord struct {
	ID      int    `json:"id"`
	ZoneID  int    `json:"zone_id"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	Content string `json:"content"`
	TTL     int    `json:"ttl"`
}

type Zone struct {
	ID      int          `json:"id"`
	Domain  string       `json:"domain"`
	Records []ZoneRecord `json:"records,omitempty"`
}

func GetZones(c *fiber.Ctx) error {
	rows, err := db.Query("SELECT id, domain FROM zones")
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var zones []Zone
	for rows.Next() {
		var z Zone
		rows.Scan(&z.ID, &z.Domain)

		// Fetch records
		rRows, _ := db.Query("SELECT id, type, name, content, ttl FROM zone_records WHERE zone_id = ?", z.ID)
		for rRows.Next() {
			var rec ZoneRecord
			rRows.Scan(&rec.ID, &rec.Type, &rec.Name, &rec.Content, &rec.TTL)
			rec.ZoneID = z.ID
			z.Records = append(z.Records, rec)
		}
		rRows.Close()

		zones = append(zones, z)
	}

	return c.JSON(zones)
}

func AddZone(c *fiber.Ctx) error {
	var req struct {
		Domain string `json:"domain"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	_, err := db.Exec("INSERT INTO zones (domain) VALUES (?)", req.Domain)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Domain already exists or DB error"})
	}

	go GenerateConfigs()

	return c.JSON(fiber.Map{"status": "success", "message": "Zone added"})
}

func AddRecord(c *fiber.Ctx) error {
	var rec ZoneRecord
	if err := c.BodyParser(&rec); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if rec.TTL == 0 {
		rec.TTL = 3600
	}

	_, err := db.Exec("INSERT INTO zone_records (zone_id, type, name, content, ttl) VALUES (?, ?, ?, ?, ?)",
		rec.ZoneID, rec.Type, rec.Name, rec.Content, rec.TTL)
	
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	go GenerateConfigs()

	return c.JSON(fiber.Map{"status": "success", "message": "Record added"})
}

func DeleteZone(c *fiber.Ctx) error {
	id := c.Params("id")
	db.Exec("DELETE FROM zones WHERE id = ?", id)
	go GenerateConfigs()
	return c.JSON(fiber.Map{"status": "success"})
}

func DeleteRecord(c *fiber.Ctx) error {
	id := c.Params("id")
	db.Exec("DELETE FROM zone_records WHERE id = ?", id)
	go GenerateConfigs()
	return c.JSON(fiber.Map{"status": "success"})
}

// GenerateZoneFiles generated standard BIND formatting files for PowerDNS
func GenerateZoneFiles() (string, error) {
	rows, err := db.Query("SELECT id, domain FROM zones")
	if err != nil {
		return "", err
	}
	defer rows.Close()

	os.MkdirAll("/etc/powerdns/zones", 0755)

	authZones := []string{}

	for rows.Next() {
		var z Zone
		rows.Scan(&z.ID, &z.Domain)

		zoneContent := fmt.Sprintf(`$ORIGIN %s.
$TTL 3600
@ IN SOA ns1.%s. hostmaster.%s. (
	2026040301 ; serial
	3600       ; refresh
	1800       ; retry
	604800     ; expire
	86400      ; negative TTL
)

@ IN NS ns1.%s.
ns1 IN A 127.0.0.1
`, z.Domain, z.Domain, z.Domain, z.Domain)

		rRows, _ := db.Query("SELECT type, name, content, ttl FROM zone_records WHERE zone_id = ?", z.ID)
		for rRows.Next() {
			var rec ZoneRecord
			rRows.Scan(&rec.Type, &rec.Name, &rec.Content, &rec.TTL)

			if rec.Name == "@" {
				rec.Name = ""
			} else {
				rec.Name = rec.Name + " "
			}

			// Format TXT records properly with quotes if not present
			content := rec.Content
			if rec.Type == "TXT" && !strings.HasPrefix(content, "\"") {
				content = "\"" + content + "\""
			}

			zoneContent += fmt.Sprintf("%sIN %d %s %s\n", rec.Name, rec.TTL, rec.Type, content)
		}
		rRows.Close()

		filename := fmt.Sprintf("/etc/powerdns/zones/%s.zone", z.Domain)
		os.WriteFile(filename, []byte(zoneContent), 0644)

		authZones = append(authZones, fmt.Sprintf("%s=%s", z.Domain, filename))
	}

	return strings.Join(authZones, ","), nil
}
