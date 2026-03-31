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

type CustomListsRequest struct {
	Blacklist []string `json:"blacklist"`
	Whitelist []string `json:"whitelist"`
}

type RPZFeed struct {
	URL     string `json:"url"`
	Enabled bool   `json:"enabled"`
}

type RPZRequest struct {
	Feeds        []RPZFeed `json:"feeds"`
	SyncInterval int       `json:"sync_interval"`
}

type RPZAXFRFeed struct {
	MasterIP string `json:"master_ip"`
	ZoneName string `json:"zone_name"`
	Enabled  bool   `json:"enabled"`
}

type RPZAXFRRequest struct {
	Feeds []RPZAXFRFeed `json:"feeds"`
}

type ForwarderRequest struct {
	DomainForwarders string   `json:"domain_forwarders"`
	ParentResolvers  []string `json:"parent_resolvers"`
}

type FeedStatus struct {
	Name    string `json:"name"`
	URL     string `json:"url"`
	Status  string `json:"status"`
	Error   string `json:"error"`
	Records int    `json:"records"`
	Time    string `json:"time"`
}

var (
	feedStatuses []FeedStatus
	feedMutex    sync.RWMutex
	forceSync    = make(chan bool, 1)

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

	api.Get("/rpz-axfr", GetRPZAXFRFeeds)
	api.Post("/rpz-axfr", SaveRPZAXFRFeeds)

	api.Get("/forwarders", GetForwarders)
	api.Post("/forwarders", SaveForwarders)

	api.Get("/stats", GetPDNSStats)
    api.Get("/top-analytics", GetTopAnalytics)
    api.Get("/check-domain", CheckDomainBlock)
	api.Get("/search-rpz", SearchRPZ)

	api.Get("/custom-lists", GetCustomLists)
	api.Post("/custom-lists", SaveCustomLists)

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
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_blacklist', '')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_whitelist', '')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_sync_interval', '1440')`)
	db.Exec(`UPDATE settings SET value = '1440' WHERE key = 'rpz_sync_interval' AND value = '1'`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_axfr_feeds', '[{"master_ip":"182.23.79.202","zone_name":"trustpositifkominfo","enabled":false},{"master_ip":"139.255.196.202","zone_name":"trustpositifkominfo","enabled":false}]')`)
	db.Exec(`UPDATE settings SET value = '[{"url":"https://trustpositif.kominfo.go.id/","enabled":true}]' WHERE key = 'rpz_feeds' AND value NOT LIKE '[%'`)

	// Inject new komdigi default if absent
	var rpzValue string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_feeds'").Scan(&rpzValue)
	if !strings.Contains(rpzValue, "trustpositif.komdigi.go.id/assets/db/domains") {
		var feeds []RPZFeed
		json.Unmarshal([]byte(rpzValue), &feeds)
		feeds = append(feeds, RPZFeed{URL: "https://trustpositif.komdigi.go.id/assets/db/domains", Enabled: false})
		newJSON, _ := json.Marshal(feeds)
		db.Exec("UPDATE settings SET value = ? WHERE key = 'rpz_feeds'", string(newJSON))
	}
}

func generateLuaConfig() {
	var axfrValue string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_axfr_feeds'").Scan(&axfrValue)
	var axfrFeeds []RPZAXFRFeed
	if axfrValue != "" {
		json.Unmarshal([]byte(axfrValue), &axfrFeeds)
	}

	luaContent := `rpzFile("/etc/powerdns/rpz_compiled.zone")` + "\n"

	for _, f := range axfrFeeds {
		if f.Enabled && f.MasterIP != "" && f.ZoneName != "" {
			luaContent += fmt.Sprintf(`rpzMaster("%s", "%s")`+"\n", f.MasterIP, f.ZoneName)
		}
	}

	ioutil.WriteFile("/etc/powerdns/laman_labuh.lua", []byte(luaContent), 0644)
	exec.Command("rec_control", "reload-lua-config").Run()
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

	ipsStr := strings.Join(req.IPs, "\n")
	_, err := db.Exec("UPDATE settings SET value = ? WHERE key = 'laman_labuh_ip'", ipsStr)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	generateLuaConfig()

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
	currentStatus := make([]FeedStatus, len(feedStatuses))
	copy(currentStatus, feedStatuses)
	feedMutex.RUnlock()

	// Fallback empty array
	if currentStatus == nil {
		currentStatus = []FeedStatus{}
	}

	var axfrValue string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_axfr_feeds'").Scan(&axfrValue)
	var axfrFeeds []RPZAXFRFeed
	if axfrValue != "" {
		json.Unmarshal([]byte(axfrValue), &axfrFeeds)
		for _, f := range axfrFeeds {
			statusStr := "Disconnected"
			if f.Enabled {
				statusStr = "AXFR/IXFR Link"
			}
			currentStatus = append(currentStatus, FeedStatus{
				Name:    fmt.Sprintf("Zone: %s", f.ZoneName),
				URL:     f.MasterIP,
				Status:  statusStr,
				Error:   "",
				Records: 0,
				Time:    "Native DNS",
			})
		}
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

	select {
	case forceSync <- true:
	default:
	}

	return c.JSON(fiber.Map{"message": "RPZ Feeds updated successfully"})
}

func GetRPZAXFRFeeds(c *fiber.Ctx) error {
	var value string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_axfr_feeds'").Scan(&value)
	if err != nil || value == "" {
		value = `[]`
	}
	var feeds []RPZAXFRFeed
	json.Unmarshal([]byte(value), &feeds)
	return c.JSON(fiber.Map{"feeds": feeds})
}

func SaveRPZAXFRFeeds(c *fiber.Ctx) error {
	var req RPZAXFRRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	feedsJSON, _ := json.Marshal(req.Feeds)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'rpz_axfr_feeds'", string(feedsJSON))
	generateLuaConfig()

	return c.JSON(fiber.Map{"message": "AXFR Feeds applied"})
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
			
			// Start compiling new Master Zone File
			compiledLines := []string{
				"$TTL 60",
				"@ IN SOA localhost. root.localhost. 1 12H 15M 3W 2H",
				"@ IN NS localhost.",
				"",
			}
			
			// Load Laman Labuh Action
			var ipListStr string
			db.QueryRow("SELECT value FROM settings WHERE key = 'laman_labuh_ip'").Scan(&ipListStr)
			blockAction := "CNAME ."
			for _, ip := range strings.Split(ipListStr, "\n") {
				if ip = strings.TrimSpace(ip); ip != "" {
					blockAction = "A " + ip
					break
				}
			}

			// Load custom whitelist to override blacklist/RPZ
			var wlStr string
			db.QueryRow("SELECT value FROM settings WHERE key = 'custom_whitelist'").Scan(&wlStr)
			wlMap := make(map[string]bool)
			for _, d := range strings.Split(wlStr, "\n") {
				d = strings.TrimSpace(d)
				if d != "" { wlMap[d] = true }
			}

			// Load Custom Blacklist & Deduplicate
			var blStr string
			db.QueryRow("SELECT value FROM settings WHERE key = 'custom_blacklist'").Scan(&blStr)
			for _, d := range strings.Split(blStr, "\n") {
				d = strings.TrimSpace(d)
				if d != "" && !wlMap[d] {
					compiledLines = append(compiledLines, fmt.Sprintf("%s %s", d, blockAction))
				}
			}
			
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
					newStatuses = append(newStatuses, FeedStatus{Name: displayName, URL: u, Status: "Disabled", Error: "", Records: 0, Time: time.Now().Format("15:04:05")})
					continue
				}

				req, err := http.NewRequest("GET", u, nil)
				if err != nil {
					newStatuses = append(newStatuses, FeedStatus{Name: displayName, URL: u, Status: "Error HTTP", Error: err.Error(), Records: 0, Time: time.Now().Format("15:04:05")})
					continue
				}
				
				client := &http.Client{Timeout: 15 * time.Second}
				resp, err := client.Do(req)

				if err == nil && resp.StatusCode == 200 {
					body, _ := ioutil.ReadAll(resp.Body)
					resp.Body.Close()
					
					lines := strings.Split(string(body), "\n")
					validCount := 0
					for _, line := range lines {
						line = strings.TrimSpace(line)
						if line == "" || strings.HasPrefix(line, "#") { continue }
						
						parts := strings.Fields(line)
						domain := ""
						if len(parts) == 1 {
							domain = parts[0]
						} else if len(parts) >= 2 {
							if parts[0] == "0.0.0.0" || parts[0] == "127.0.0.1" {
								domain = parts[1]
							}
						}

						if domain != "" && domain != "localhost" && domain != "local" {
							domain = strings.ReplaceAll(domain, "http://", "")
							domain = strings.ReplaceAll(domain, "https://", "")
							domain = strings.Split(domain, "/")[0]
							
							// Ensure not whitelisted
							if !wlMap[domain] {
								validCount++
								compiledLines = append(compiledLines, fmt.Sprintf("%s %s", domain, blockAction))
							}
						}
					}

					newStatuses = append(newStatuses, FeedStatus{
						Name:    displayName,
						URL:     u,
						Status:  "Synced & Parsed",
						Error:   "",
						Records: validCount,
						Time:    time.Now().Format("15:04:05"),
					})
				} else {
					statusText := "Failed to fetch"
					errStr := "Unknown error"
					if resp != nil {
						statusText = fmt.Sprintf("HTTP %d", resp.StatusCode)
						errStr = fmt.Sprintf("Server returned status: %v", resp.Status)
					} else if err != nil {
						errStr = err.Error()
					}
					newStatuses = append(newStatuses, FeedStatus{Name: displayName, URL: u, Status: statusText, Error: errStr, Records: 0, Time: time.Now().Format("15:04:05")})
				}
			}

			feedMutex.Lock()
			feedStatuses = newStatuses
			feedMutex.Unlock()

			// Write Whitelist explicit rules at bottom to guarantee parsing validity
			for d := range wlMap {
				compiledLines = append(compiledLines, fmt.Sprintf("%s CNAME rpz-passthru.", d))
			}

			// Write Compiled RPZ Zone Master to disk
			errWrite := ioutil.WriteFile("/etc/powerdns/rpz_compiled.zone", []byte(strings.Join(compiledLines, "\n")), 0644)
			if errWrite == nil {
				// Signal PowerDNS to instantly reload latest compiled policies
				exec.Command("rec_control", "reload-lua-config").Run()
			}
		}
		
		var intervalStr string
		db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_sync_interval'").Scan(&intervalStr)
		interval := 1
		if res, err := strconv.Atoi(intervalStr); err == nil && res > 0 {
			interval = res
		}

		select {
		case <-time.After(time.Duration(interval) * time.Minute):
		case <-forceSync:
			// Instantly wakeup and run sync!
		}
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

func GetCustomLists(c *fiber.Ctx) error {
	var bl, wl string
	db.QueryRow("SELECT value FROM settings WHERE key = 'custom_blacklist'").Scan(&bl)
	db.QueryRow("SELECT value FROM settings WHERE key = 'custom_whitelist'").Scan(&wl)
	
	blArr, wlArr := []string{}, []string{}
	for _, x := range strings.Split(bl, "\n") { if x != "" { blArr = append(blArr, x) } }
	for _, x := range strings.Split(wl, "\n") { if x != "" { wlArr = append(wlArr, x) } }
	
	return c.JSON(fiber.Map{"blacklist": blArr, "whitelist": wlArr})
}

func SaveCustomLists(c *fiber.Ctx) error {
	var req CustomListsRequest
	if err := c.BodyParser(&req); err != nil { return c.Status(400).JSON(fiber.Map{"error":"bad request"}) }
	
	db.Exec("UPDATE settings SET value = ? WHERE key = 'custom_blacklist'", strings.Join(req.Blacklist, "\n"))
	db.Exec("UPDATE settings SET value = ? WHERE key = 'custom_whitelist'", strings.Join(req.Whitelist, "\n"))
	
	select { case forceSync <- true: default: }
	return c.JSON(fiber.Map{"message": "Custom Lists Updates Saved"})
}

func SearchRPZ(c *fiber.Ctx) error {
	q := c.Query("q")
	if len(q) < 3 {
		return c.Status(400).JSON(fiber.Map{"error": "Query minimal 3 karakter"})
	}

	cmd := exec.Command("grep", "-i", "-m", "100", q, "/etc/powerdns/rpz_compiled.zone")
	out, err := cmd.Output()
	if err != nil {
		return c.JSON(fiber.Map{"results": []string{}})
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var results []string
	for _, l := range lines {
		l = strings.TrimSpace(l)
		if l != "" && !strings.HasPrefix(l, "$") && !strings.HasPrefix(l, "@ ") {
			parts := strings.Fields(l)
			action := "BLOCKED"
			if len(parts) >= 3 && parts[2] == "rpz-passthru." {
				action = "WHITELISTED"
			}
			if len(parts) > 0 {
				results = append(results, fmt.Sprintf("%s [%s]", parts[0], action))
			}
		}
	}
	return c.JSON(fiber.Map{"results": results})
}

func CheckDomainBlock(c *fiber.Ctx) error {
	domain := c.Query("domain")
	if domain == "" {
		return c.Status(400).JSON(fiber.Map{"error": "domain needed"})
	}

	var ipsStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'laman_labuh_ip'").Scan(&ipsStr)
	lamanLabuhIPs := strings.Split(ipsStr, "\n")

	cmd := exec.Command("dig", "@127.0.0.1", "-p", "53", "+short", domain)
	out, _ := cmd.Output()
	result := strings.TrimSpace(string(out))

	isBlocked := false
	for _, rawIP := range lamanLabuhIPs {
		ip := strings.TrimSpace(rawIP)
		if ip != "" && strings.Contains(result, ip) {
			isBlocked = true
			break
		}
	}

	return c.JSON(fiber.Map{
		"domain":     domain,
		"is_blocked": isBlocked,
		"resolve_to": result,
	})
}
