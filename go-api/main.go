package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	_ "modernc.org/sqlite"
)

var db *sql.DB

// DTOs
type LamanLabuhRequest struct {
	IPs []string `json:"ips"`
}

type ACLRequest struct {
	IPs []string `json:"ips"`
}

type RPZFeed struct {
	URL     string `json:"url"`
	Enabled bool   `json:"enabled"`
}

type RPZRequest struct {
	Feeds        []RPZFeed `json:"feeds"`
	SyncInterval int       `json:"sync_interval"`
}

type ForwarderRequest struct {
	DomainForwarders string   `json:"domain_forwarders"`
	ParentResolvers  []string `json:"parent_resolvers"`
}

type FeedStatus struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Records int    `json:"records"`
	Time    string `json:"time"`
}

var (
	feedStatuses []FeedStatus
	feedMutex    sync.RWMutex

	wsClients    = make(map[*websocket.Conn]bool)
	clientMutex  sync.Mutex
	topClients   = make(map[string]int)
	topDomains   = make(map[string]int)
	metricsMutex sync.RWMutex
)

func main() {
	initDB()

	// Mulai background workers
	go syncRPZWorker()
	go streamLogs()

	app := fiber.New(fiber.Config{
		ServerHeader: "NetShield DNS",
		AppName:      "NetShield API v2.0",
	})

	app.Use(cors.New())
	app.Use(logger.New())

	api := app.Group("/api")

	api.Get("/laman-labuh", GetLamanLabuh)
	api.Post("/laman-labuh", SaveLamanLabuh)

	api.Get("/acl", GetACL)
	api.Post("/acl", SaveACL)

	api.Get("/rpz-feeds", GetRPZFeeds)
	api.Post("/rpz-feeds", SaveRPZFeeds)

	api.Get("/forwarders", GetForwarders)
	api.Post("/forwarders", SaveForwarders)

	api.Get("/stats", GetPDNSStats)
    api.Get("/top-analytics", GetTopAnalytics)

	// WebSocket handler
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})

	app.Get("/ws", websocket.New(func(c *websocket.Conn) {
		clientMutex.Lock()
		wsClients[c] = true
		clientMutex.Unlock()

		defer func() {
			clientMutex.Lock()
			delete(wsClients, c)
			clientMutex.Unlock()
			c.Close()
		}()

		for {
			if _, _, err := c.ReadMessage(); err != nil {
				break
			}
		}
	}))

	// Serve Static Frontend
	app.Static("/", "/var/www/html/")

	log.Println("Server listening on :80")
	log.Fatal(app.Listen(":80"))
}

func initDB() {
	var err error
	// Use local directory for testing if /data isn't available
	dbPath := "/data/netshield.db"
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatal(err)
	}

	createTableSQL := `CREATE TABLE IF NOT EXISTS settings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		key TEXT UNIQUE NOT NULL,
		value TEXT NOT NULL
	);`
	_, err = db.Exec(createTableSQL)
	if err != nil {
		// Fallback to local DB for dev without /data mapping
		db, _ = sql.Open("sqlite", "netshield.db")
		db.Exec(createTableSQL)
	}

	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('laman_labuh_ip', '139.255.196.196')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('acl_ips', '127.0.0.0/8\n10.0.0.0/8\n192.168.0.0/16\n172.16.0.0/12')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_feeds', 'https://trustpositif.kominfo.go.id/')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('domain_forwarders', 'kominfo.go.id,8.8.8.8,1.1.1.1')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('parent_resolvers', ',,,,,')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_sync_interval', '1')`)
	db.Exec(`UPDATE settings SET value = '[{"url":"https://trustpositif.kominfo.go.id/","enabled":true}]' WHERE key = 'rpz_feeds' AND value NOT LIKE '[%'`)
}

func GetLamanLabuh(c *fiber.Ctx) error {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'laman_labuh_ip'").Scan(&value)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ips": strings.Split(value, ",")})
}

func SaveLamanLabuh(c *fiber.Ctx) error {
	var req LamanLabuhRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	ipsStr := strings.Join(req.IPs, ",")
	_, err := db.Exec("UPDATE settings SET value = ? WHERE key = 'laman_labuh_ip'", ipsStr)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	luaContent := fmt.Sprintf(`rpzFile("/etc/powerdns/trustpositif.rpz", {defpol=Policy.Custom, defcontent={"%s"}})`, strings.Join(req.IPs, `", "`))
	err = ioutil.WriteFile("/etc/powerdns/laman_labuh.lua", []byte(luaContent), 0644)
	if err != nil {
		fmt.Println("Warning: Failed to write Lua file (expected if not in container):", err)
	} else {
		exec.Command("rec_control", "reload-lua-config").Run()
	}

	return c.JSON(fiber.Map{"message": "Laman Labuh updated successfully", "ips": req.IPs})
}

func GetACL(c *fiber.Ctx) error {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'acl_ips'").Scan(&value)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"ips": strings.Split(value, "\n")})
}

func SaveACL(c *fiber.Ctx) error {
	var req ACLRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	ipsStr := strings.Join(req.IPs, "\n")
	_, err := db.Exec("UPDATE settings SET value = ? WHERE key = 'acl_ips'", ipsStr)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	err = ioutil.WriteFile("/etc/powerdns/allowed_ips.txt", []byte(ipsStr), 0644)
	if err != nil {
		fmt.Println("Warning: Failed to write ACL file (expected if not in container):", err)
	} else {
		exec.Command("rec_control", "reload-lua-script").Run()
	}

	return c.JSON(fiber.Map{"message": "ACL updated successfully", "ips": req.IPs})
}

func GetPDNSStats(c *fiber.Ctx) error {
	feedMutex.RLock()
	currentStatus := feedStatuses
	feedMutex.RUnlock()

	// Jika belum ada data dari worker, kirim array kosong bukan nil
	if currentStatus == nil {
		currentStatus = []FeedStatus{}
	}

	return c.JSON(fiber.Map{
		"qps":             125432,
		"cache_hit_ratio": 94.2,
		"avg_latency_ms":  42.3,
		"cpu_usage":       23,
		"mem_usage_mb":    4200,
		"uptime_seconds":  1234567,
		"rpz_status":      currentStatus,
	})
}

func GetRPZFeeds(c *fiber.Ctx) error {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_feeds'").Scan(&value)
	if err != nil || value == "" {
		value = `[]`
	}
	var feeds []RPZFeed
	json.Unmarshal([]byte(value), &feeds)

	var interval int
	err = db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_sync_interval'").Scan(&interval)
	if err != nil || interval <= 0 {
		interval = 1
	}

	return c.JSON(fiber.Map{"feeds": feeds, "sync_interval": interval})
}

func SaveRPZFeeds(c *fiber.Ctx) error {
	var req RPZRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	feedsJSON, _ := json.Marshal(req.Feeds)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'rpz_feeds'", string(feedsJSON))
	db.Exec("UPDATE settings SET value = ? WHERE key = 'rpz_sync_interval'", fmt.Sprintf("%d", req.SyncInterval))

	var activeURLs []string
	for _, f := range req.Feeds {
		if f.Enabled {
			activeURLs = append(activeURLs, f.URL)
		}
	}
	
	urlsStr := strings.Join(activeURLs, "\n")
	err := ioutil.WriteFile("/etc/powerdns/rpz_feeds.txt", []byte(urlsStr), 0644)
	if err != nil {
		fmt.Println("Warning: Failed to write RPZ Feeds file:", err)
	}

	return c.JSON(fiber.Map{"message": "RPZ Feeds updated successfully"})
}

func GetForwarders(c *fiber.Ctx) error {
	var domFwd string
	db.QueryRow("SELECT value FROM settings WHERE key = 'domain_forwarders'").Scan(&domFwd)
	
	var parResStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'parent_resolvers'").Scan(&parResStr)
	
	parRes := []string{"", "", "", "", "", ""}
	if parResStr != "" {
		parts := strings.Split(parResStr, ",")
		for i, p := range parts {
			if i < 6 {
				parRes[i] = p
			}
		}
	}
	
	return c.JSON(fiber.Map{
		"domain_forwarders": domFwd,
		"parent_resolvers":  parRes,
	})
}

func SaveForwarders(c *fiber.Ctx) error {
	var req ForwarderRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	db.Exec("UPDATE settings SET value = ? WHERE key = 'domain_forwarders'", req.DomainForwarders)
	parResStr := strings.Join(req.ParentResolvers, ",")
	db.Exec("UPDATE settings SET value = ? WHERE key = 'parent_resolvers'", parResStr)

	var fileLines []string

	lines := strings.Split(req.DomainForwarders, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" { continue }
		parts := strings.Split(line, ",")
		if len(parts) >= 2 {
			domain := strings.TrimSpace(parts[0])
			var ips []string
			for _, ip := range parts[1:] {
				ip = strings.TrimSpace(ip)
				if ip != "" { ips = append(ips, ip) }
			}
			if len(ips) > 0 {
				fileLines = append(fileLines, fmt.Sprintf("+%s=%s", domain, strings.Join(ips, ";")))
			}
		}
	}

	var pIPs []string
	for _, ip := range req.ParentResolvers {
		ip = strings.TrimSpace(ip)
		if ip != "" { pIPs = append(pIPs, ip) }
	}
	if len(pIPs) > 0 {
		fileLines = append(fileLines, fmt.Sprintf("+.=%s", strings.Join(pIPs, ";")))
	}

	err := ioutil.WriteFile("/etc/powerdns/forward_zones.txt", []byte(strings.Join(fileLines, "\n")), 0644)
	if err != nil {
		fmt.Println("Warning: Failed to write forward zones file:", err)
	} else {
		exec.Command("rec_control", "reload-zones").Run()
	}

	return c.JSON(fiber.Map{"message": "Forwarders updated successfully"})
}

func syncRPZWorker() {
	for {
		var value string
		err := db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_feeds'").Scan(&value)
		if err == nil && value != "" {
			var feeds []RPZFeed
			json.Unmarshal([]byte(value), &feeds)
			var newStatuses []FeedStatus

			for _, f := range feeds {
				u := strings.TrimSpace(f.URL)
				if u == "" {
					continue
				}

				displayName := u
				if len(u) > 30 {
					displayName = u[:30] + "..."
				}

				if !f.Enabled {
					newStatuses = append(newStatuses, FeedStatus{Name: displayName, Status: "Disabled", Records: 0, Time: time.Now().Format("15:04:05")})
					continue
				}

				req, err := http.NewRequest("GET", u, nil)
				if err != nil {
					newStatuses = append(newStatuses, FeedStatus{Name: displayName, Status: "Error HTTP", Records: 0, Time: time.Now().Format("15:04:05")})
					continue
				}
				
				client := &http.Client{Timeout: 15 * time.Second}
				resp, err := client.Do(req)

				if err == nil && resp.StatusCode == 200 {
					body, _ := ioutil.ReadAll(resp.Body)
					resp.Body.Close()
					
					// Hitung baris valid
					lines := strings.Split(string(body), "\n")
					validCount := 0
					for _, line := range lines {
						line = strings.TrimSpace(line)
						if line != "" && !strings.HasPrefix(line, "#") {
							validCount++
						}
					}

					newStatuses = append(newStatuses, FeedStatus{
						Name:    displayName,
						Status:  "Synced & Parsed",
						Records: validCount,
						Time:    time.Now().Format("15:04:05"),
					})
				} else {
					statusText := "Failed to fetch"
					if resp != nil {
						statusText = fmt.Sprintf("HTTP %d", resp.StatusCode)
					}
					newStatuses = append(newStatuses, FeedStatus{Name: displayName, Status: statusText, Records: 0, Time: time.Now().Format("15:04:05")})
				}
			}

			feedMutex.Lock()
			feedStatuses = newStatuses
			feedMutex.Unlock()
		}
		
		var intervalStr string
		db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_sync_interval'").Scan(&intervalStr)
		interval := 1
		if res, err := strconv.Atoi(intervalStr); err == nil && res > 0 {
			interval = res
		}

		time.Sleep(time.Duration(interval) * time.Minute)
	}
}

func GetTopAnalytics(c *fiber.Ctx) error {
	metricsMutex.RLock()
	defer metricsMutex.RUnlock()

	// Simplify map to limited array for frontend
	type Stat struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	var clients []Stat
	for k, v := range topClients {
		clients = append(clients, Stat{k, v})
	}
	var domains []Stat
	for k, v := range topDomains {
		domains = append(domains, Stat{k, v})
	}

	return c.JSON(fiber.Map{
		"top_clients": clients,
		"top_domains": domains,
	})
}

func broadcastWS(msg []byte) {
	clientMutex.Lock()
	defer clientMutex.Unlock()
	for client := range wsClients {
		if err := client.WriteMessage(websocket.TextMessage, msg); err != nil {
			client.Close()
			delete(wsClients, client)
		}
	}
}

func streamLogs() {
	// Create file if not exist
	filePath := "/var/log/pdns-queries.log"
	
	// Open file
	var file *os.File
	var err error
	for {
		file, err = os.Open(filePath)
		if err == nil {
			break
		}
		// If fails, wait and retry (PowerDNS might not have created it yet)
		time.Sleep(1 * time.Second)
	}
	defer file.Close()

	// Seek to end
	file.Seek(0, os.SEEK_END)
	reader := bufio.NewReader(file)

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Broadcast immediately to WebSockets
		broadcastWS([]byte(line))

		// Parse for Analytics
		var entry map[string]interface{}
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			metricsMutex.Lock()
			if ip, ok := entry["ip"].(string); ok {
				topClients[ip]++
			}
			if domain, ok := entry["qname"].(string); ok {
				topDomains[domain]++
			}
			metricsMutex.Unlock()
		}
	}
}
