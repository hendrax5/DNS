package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
	"runtime"


	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

var db *sql.DB
var jwtSecret = []byte("!NetShield_V2_Secret_2026")

// DTOs
type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
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

type ClientStat struct {
	Allow int `json:"allow"`
	Block int `json:"block"`
}

var (
	feedStatuses []FeedStatus
	feedMutex    sync.RWMutex
	forceSync    = make(chan bool, 1)

	topClients        = make(map[string]*ClientStat)
	topAllowedDomains = make(map[string]int)
	topBlockedDomains = make(map[string]int)
	
	queryTypeMap      = make(map[string]int)
	telemetryAlerts   []TelemetryAlert
	historySeries     []TimeSeriesPoint
	metricsMutex      sync.RWMutex
	liveQPS           float64
)

type TelemetryAlert struct {
	Message string `json:"message"`
	Level   string `json:"level"`
	Time    string `json:"time"`
}

type TimeSeriesPoint struct {
	Time       string  `json:"time"`
	QPS        float64 `json:"qps"`
	Latency    float64 `json:"latency"`
	CacheRatio float64 `json:"cacheRatio"`
}

func main() {
	initDB()

	// Mulai background workers
	go syncRPZWorker()
	go streamLogs()
	go systemTelemetryWorker()
	go liveQPSWorker()

	app := fiber.New(fiber.Config{
		ServerHeader: "NetShield DNS",
		AppName:      "NetShield API v2.0",
	})

	app.Use(cors.New())
	app.Use(logger.New())

	api := app.Group("/api")

	// Public Routes
	api.Post("/login", LoginHandler)
	api.Get("/stats", GetPDNSStats)
    api.Get("/top-analytics", GetTopAnalytics)
    api.Get("/check-domain", CheckDomainBlock)
	api.Get("/dig-health", GetDigHealth)

	// Auth Middleware
	authGuard := func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			return c.Status(401).JSON(fiber.Map{"error": "Unauthorized"})
		}
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")
		token, err := jwt.Parse(tokenString, func(t *jwt.Token) (interface{}, error) {
			return jwtSecret, nil
		})
		if err != nil || !token.Valid {
			return c.Status(401).JSON(fiber.Map{"error": "Invalid token"})
		}
		return c.Next()
	}

	admin := api.Group("/", authGuard)

	admin.Get("/laman-labuh", GetLamanLabuh)
	admin.Post("/laman-labuh", SaveLamanLabuh)

	admin.Get("/acl", GetACL)
	admin.Post("/acl", SaveACL)

	admin.Get("/rpz-feeds", GetRPZFeeds)
	admin.Post("/rpz-feeds", SaveRPZFeeds)

	admin.Get("/rpz-axfr", GetRPZAXFRFeeds)
	admin.Post("/rpz-axfr", SaveRPZAXFRFeeds)

	admin.Get("/forwarders", GetForwarders)
	admin.Post("/forwarders", SaveForwarders)

	admin.Get("/search-rpz", SearchRPZ)

	admin.Get("/custom-lists", GetCustomLists)
	admin.Post("/custom-lists", SaveCustomLists)

	admin.Get("/advanced-config", GetAdvancedConfig)
	admin.Post("/advanced-config", SaveAdvancedConfig)

	admin.Get("/dig-targets", GetDigTargets)
	admin.Post("/dig-targets", SaveDigTargets)

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
	);
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		email TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL
	);`
	_, err = db.Exec(createTableSQL)
	if err != nil {
		// Fallback to local DB for dev without /data mapping
		db, _ = sql.Open("sqlite", "netshield.db")
		db.Exec(createTableSQL)
	}

	// Inject default user hendra@servicex.id / !Tahun2026_
	hash, err := bcrypt.GenerateFromPassword([]byte("!Tahun2026_"), bcrypt.DefaultCost)
	if err == nil {
		db.Exec(`INSERT OR IGNORE INTO users (email, password_hash) VALUES (?, ?)`, "hendra@servicex.id", string(hash))
	}

	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('laman_labuh_ip', '139.255.196.196')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('acl_ips', '127.0.0.0/8\n10.0.0.0/8\n192.168.0.0/16\n172.16.0.0/12')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_feeds', 'https://trustpositif.kominfo.go.id/')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('domain_forwarders', 'kominfo.go.id,8.8.8.8,1.1.1.1')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('parent_resolvers', ',,,,,')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_blacklist', '')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_whitelist', '')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('safesearch_enabled', 'false')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('dnssec_enabled', 'false')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_sync_interval', '1440')`)
	db.Exec(`UPDATE settings SET value = '1440' WHERE key = 'rpz_sync_interval' AND value = '1'`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_axfr_feeds', '[{"master_ip":"182.23.79.202","zone_name":"trustpositifkominfo","enabled":false},{"master_ip":"139.255.196.202","zone_name":"trustpositifkominfo","enabled":false}]')`)
	db.Exec(`UPDATE settings SET value = '[{"url":"https://trustpositif.komdigi.go.id/assets/db/domains_isp","enabled":true}]' WHERE key = 'rpz_feeds' AND value NOT LIKE '[%'`)

	// Inject new komdigi default and remove legacy kominfo feeds from DB
	var rpzValue string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_feeds'").Scan(&rpzValue)
	if strings.Contains(rpzValue, "trustpositif.kominfo.go.id") || strings.Contains(rpzValue, "trustpositif.komdigi.go.id/assets/db/domains") {
		// Enforce the new komdigi ISP domain list and clear others if it holds legacy
		if !strings.Contains(rpzValue, "trustpositif.komdigi.go.id/assets/db/domains_isp") {
			db.Exec(`UPDATE settings SET value = '[{"url":"https://trustpositif.komdigi.go.id/assets/db/domains_isp","enabled":true}]' WHERE key = 'rpz_feeds'`)
		}
	}

	// ALWAYS securely regenerate PowerDNS Lua mappings on Startup!
	log.Println("Regenerating PowerDNS config files based on DB State...")
	generateLuaConfig()
	generateACLConfig()
	generateForwardersConfig()
}

func generateACLConfig() {
	var ipsStr string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'acl_ips'").Scan(&ipsStr)
	if err == nil {
		ioutil.WriteFile("/etc/powerdns/allowed_ips.txt", []byte(ipsStr), 0644)
	}
	exec.Command("rec_control", "reload-lua-script").Run()
	exec.Command("rec_control", "wipe-cache", "$").Run()
}

func generateForwardersConfig() {
	var domFwd, parResStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'domain_forwarders'").Scan(&domFwd)
	db.QueryRow("SELECT value FROM settings WHERE key = 'parent_resolvers'").Scan(&parResStr)

	var fileLines []string
	for _, line := range strings.Split(domFwd, "\n") {
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
			if len(ips) > 0 { fileLines = append(fileLines, fmt.Sprintf("+%s=%s", domain, strings.Join(ips, ";"))) }
		}
	}

	var pIPs []string
	for _, ip := range strings.Split(parResStr, ",") {
		ip = strings.TrimSpace(ip)
		if ip != "" { pIPs = append(pIPs, ip) }
	}
	if len(pIPs) > 0 { fileLines = append(fileLines, fmt.Sprintf("+.=%s", strings.Join(pIPs, ";"))) }

	ioutil.WriteFile("/etc/powerdns/forward_zones.txt", []byte(strings.Join(fileLines, "\n")), 0644)
}

func generateLuaConfig() {
	// Pastikan file zona ada sebelum PowerDNS mencoba me-reload LUA
	if _, err := os.Stat("/etc/powerdns/rpz_compiled.zone"); os.IsNotExist(err) {
		ioutil.WriteFile("/etc/powerdns/rpz_compiled.zone", []byte("$ORIGIN rpz.local.\n$TTL 60\n@ IN SOA localhost. root.localhost. 1 43200 900 1814400 7200\n@ IN NS localhost.\n\n"), 0644)
	}

	var axfrValue string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_axfr_feeds'").Scan(&axfrValue)
	var axfrFeeds []RPZAXFRFeed
	if axfrValue != "" {
		json.Unmarshal([]byte(axfrValue), &axfrFeeds)
	}

	var ipListStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'laman_labuh_ip'").Scan(&ipListStr)
	var lamanLabuhIP string
	for _, ip := range strings.Split(ipListStr, "\n") {
		if ip = strings.TrimSpace(ip); ip != "" {
			lamanLabuhIP = ip
			break
		}
	}

	luaContent := `rpzFile("/etc/powerdns/rpz_compiled.zone")` + "\n"

	for _, f := range axfrFeeds {
		if f.Enabled && f.MasterIP != "" && f.ZoneName != "" {
			if lamanLabuhIP != "" {
				luaContent += fmt.Sprintf(`rpzMaster({"%s"}, "%s", {defpol=Policy.Custom, defcontent="%s", dumpFile="/etc/powerdns/axfr_%s.zone"})`+"\n", f.MasterIP, f.ZoneName, lamanLabuhIP, f.ZoneName)
			} else {
				// Use Kominfo's default redirect if no local override
				luaContent += fmt.Sprintf(`rpzMaster({"%s"}, "%s", {dumpFile="/etc/powerdns/axfr_%s.zone"})`+"\n", f.MasterIP, f.ZoneName, f.ZoneName)
			}
		}
	}

	var safesearch string
	db.QueryRow("SELECT value FROM settings WHERE key = 'safesearch_enabled'").Scan(&safesearch)
	if safesearch == "true" {
		safeZone := `$ORIGIN rpz.local.
$TTL 60
@ IN SOA localhost. root.localhost. 1 12H 15M 3W 2H
@ IN NS localhost.

google.com CNAME forcesafesearch.google.com.
www.google.com CNAME forcesafesearch.google.com.
bing.com CNAME strict.bing.com.
www.bing.com CNAME strict.bing.com.
duckduckgo.com CNAME safe.duckduckgo.com.
yandex.com CNAME yandex.com.
`
		ioutil.WriteFile("/etc/powerdns/safesearch.zone", []byte(safeZone), 0644)
		luaContent += `rpzFile("/etc/powerdns/safesearch.zone")` + "\n"
	}

	ioutil.WriteFile("/etc/powerdns/laman_labuh.lua", []byte(luaContent), 0644)

	var dnssec string
	db.QueryRow("SELECT value FROM settings WHERE key = 'dnssec_enabled'").Scan(&dnssec)
	if dnssec == "true" {
		exec.Command("sed", "-i", "s/^dnssec=.*/dnssec=process/", "/etc/powerdns/recursor.conf").Run()
	} else {
		exec.Command("sed", "-i", "s/^dnssec=.*/dnssec=off/", "/etc/powerdns/recursor.conf").Run()
	}

	// Hot reload PowerDNS settings without rebooting the container
	exec.Command("rec_control", "reload-lua-config").Run()
	exec.Command("rec_control", "wipe-cache", "$").Run()
}

func LoginHandler(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	var hash string
	err := db.QueryRow("SELECT password_hash FROM users WHERE email = ?", req.Email).Scan(&hash)
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		return c.Status(401).JSON(fiber.Map{"error": "Invalid email or password"})
	}

	claims := jwt.MapClaims{
		"email": req.Email,
		"exp":   time.Now().Add(time.Hour * 24).Unix(), // 24 jam
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	t, err := token.SignedString(jwtSecret)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Could not generate token"})
	}

	return c.JSON(fiber.Map{"token": t, "email": req.Email})
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

	generateACLConfig()

	return c.JSON(fiber.Map{"message": "ACL updated successfully", "ips": req.IPs})
}

func GetAdvancedConfig(c *fiber.Ctx) error {
	var safesearch, dnssec string
	err1 := db.QueryRow("SELECT value FROM settings WHERE key = 'safesearch_enabled'").Scan(&safesearch)
	err2 := db.QueryRow("SELECT value FROM settings WHERE key = 'dnssec_enabled'").Scan(&dnssec)
	
	if err1 != nil { safesearch = "false" }
	if err2 != nil { dnssec = "false" }

	return c.JSON(fiber.Map{
		"safesearch": safesearch == "true",
		"dnssec": dnssec == "true",
	})
}

func SaveAdvancedConfig(c *fiber.Ctx) error {
	var req struct {
		Safesearch bool `json:"safesearch"`
		Dnssec     bool `json:"dnssec"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	safesearchStr := "false"
	if req.Safesearch { safesearchStr = "true" }
	dnssecStr := "false"
	if req.Dnssec { dnssecStr = "true" }

	db.Exec("UPDATE settings SET value = ? WHERE key = 'safesearch_enabled'", safesearchStr)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'dnssec_enabled'", dnssecStr)

	generateLuaConfig()

	return c.JSON(fiber.Map{"message": "Advanced config updated"})
}

func GetPDNSStats(c *fiber.Ctx) error {
	feedMutex.RLock()
	currentStatus := make([]FeedStatus, len(feedStatuses))
	copy(currentStatus, feedStatuses)
	feedMutex.RUnlock()

	var axfrValue string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_axfr_feeds'").Scan(&axfrValue)
	var axfrFeeds []RPZAXFRFeed
	if axfrValue != "" {
		json.Unmarshal([]byte(axfrValue), &axfrFeeds)
		for _, f := range axfrFeeds {
			statusStr := "Disconnected"
			records := 0
			syncTime := "Pending Sync"
			if f.Enabled {
				statusStr = "AXFR/IXFR Link"
				dumpPath := fmt.Sprintf("/etc/powerdns/axfr_%s.zone", f.ZoneName)
				if stat, err := os.Stat(dumpPath); err == nil {
					syncTime = stat.ModTime().Format("15:04:05")
					out, _ := exec.Command("wc", "-l", dumpPath).Output()
					fields := strings.Fields(string(out))
					if len(fields) > 0 {
						recCount, _ := strconv.Atoi(fields[0])
						if recCount > 0 {
							records = recCount
						}
					}
				}
			}
			currentStatus = append(currentStatus, FeedStatus{
				Name:    fmt.Sprintf("Zone: %s", f.ZoneName),
				URL:     f.MasterIP,
				Status:  statusStr,
				Error:   "",
				Records: records,
				Time:    syncTime,
			})
		}
	}

	var qps, latency, cpu, mem, uptime float64
	var hitRatio float64 = 0

	out, err := exec.Command("rec_control", "get-all").Output()
	if err == nil {
		lines := strings.Split(string(out), "\n")
		metrics := make(map[string]float64)
		for _, line := range lines {
			parts := strings.Fields(line)
			if len(parts) == 2 {
				val, _ := strconv.ParseFloat(parts[1], 64)
				metrics[parts[0]] = val
			}
		}

		hits := metrics["cache-hits"]
		misses := metrics["cache-misses"]
		if hits+misses > 0 {
			hitRatio = (hits / (hits + misses)) * 100
		}
		
		uptime = metrics["uptime"]
		if uptime > 0 {
			cpu = math.Min(100.0, ((metrics["user-msec"] + metrics["sys-msec"]) / 10.0 / uptime) / float64(runtime.NumCPU()))
		}
		
		metricsMutex.RLock()
		qps = liveQPS
		metricsMutex.RUnlock()

		latency = metrics["qa-latency"] / 1000.0 // ns or us to ms usually
		mem = metrics["real-memory-usage"] / 1024.0 / 1024.0 // bytes to MB
	} else {
		qps, hitRatio, latency, cpu, mem, uptime = 0, 0, 0, 0, 0, 0
	}

	var noerr, nx, servfail float64
	out2, _ := exec.Command("rec_control", "get-all").Output()
	lines := strings.Split(string(out2), "\n")
	for _, line := range lines {
		parts := strings.Fields(line)
		if len(parts) == 2 {
			if parts[0] == "noerror-answers" { noerr, _ = strconv.ParseFloat(parts[1], 64) }
			if parts[0] == "nxdomain-answers" { nx, _ = strconv.ParseFloat(parts[1], 64) }
			if parts[0] == "servfail-answers" { servfail, _ = strconv.ParseFloat(parts[1], 64) }
		}
	}

	metricsMutex.RLock()
	hist := make([]TimeSeriesPoint, len(historySeries))
	copy(hist, historySeries)
	qMap := make(map[string]int)
	for k, v := range queryTypeMap { qMap[k] = v }
	alrts := make([]TelemetryAlert, len(telemetryAlerts))
	copy(alrts, telemetryAlerts)
	metricsMutex.RUnlock()

	return c.JSON(fiber.Map{
		"qps":             math.Round(qps),
		"cache_hit_ratio": math.Round(hitRatio*10) / 10,
		"avg_latency_ms":  math.Round(latency*10) / 10,
		"cpu_usage":       math.Round(cpu*10) / 10,
		"mem_usage_mb":    math.Round(mem),
		"uptime_seconds":  int(uptime),
		"rpz_status":      currentStatus,
		"history_series":  hist,
		"query_types":     qMap,
		"telemetry_alerts": alrts,
		"response_codes": map[string]float64{
			"NOERROR": noerr,
			"NXDOMAIN": nx,
			"SERVFAIL": servfail,
		},
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

	generateForwardersConfig()
	exec.Command("rec_control", "reload-zones").Run()
	exec.Command("rec_control", "wipe-cache", "$").Run()

	return c.JSON(fiber.Map{"message": "Forwarders updated successfully"})
}

func syncRPZWorker() {
	for {
		var value string
		err := db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_feeds'").Scan(&value)
		if err == nil && value != "" {
			var feeds []RPZFeed
			json.Unmarshal([]byte(value), &feeds)

			// Provide default zone file if it doesn't physically exist for some reason
			if _, err := os.Stat("/etc/powerdns/rpz_compiled.zone"); os.IsNotExist(err) {
				ioutil.WriteFile("/etc/powerdns/rpz_compiled.zone", []byte("$ORIGIN rpz.local.\n$TTL 60\n@ IN SOA localhost. root.localhost. 1 43200 900 1814400 7200\n@ IN NS localhost.\n\n"), 0644)
			}

			var newStatuses []FeedStatus
			
			// Start compiling new Master Zone File
			compiledLines := []string{
				"$ORIGIN rpz.local.",
				"$TTL 60",
				"@ IN SOA localhost. root.localhost. 1 43200 900 1814400 7200",
				"@ IN NS localhost.",
				"",
			}
			
			// Load Laman Labuh Action
			var ipListStr string
			db.QueryRow("SELECT value FROM settings WHERE key = 'laman_labuh_ip'").Scan(&ipListStr)
			blockAction := "CNAME ."
			masterRedirect := ""
			for _, ip := range strings.Split(ipListStr, "\n") {
				if ip = strings.TrimSpace(ip); ip != "" {
					blockAction = "A " + ip
					masterRedirect = "redirect A " + ip
					break
				}
			}

			if masterRedirect != "" {
				compiledLines = append(compiledLines, masterRedirect)
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
			domainMap := make(map[string]struct{})
			rootCounts := make(map[string]int)

			var blStr string
			db.QueryRow("SELECT value FROM settings WHERE key = 'custom_blacklist'").Scan(&blStr)
			for _, d := range strings.Split(blStr, "\n") {
				d = sanitizeDomain(d)
				if d != "" && !wlMap[d] && strings.Contains(d, ".") && !strings.ContainsAny(d, " _#/") && net.ParseIP(d) == nil {
					domainMap[d] = struct{}{}
					rootCounts[getBaseDomain(d)]++
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
							domain = sanitizeDomain(domain)
							

							// Ensure not whitelisted, valid format, and absolutely NOT an IP address!
							if !wlMap[domain] && strings.Contains(domain, ".") && !strings.ContainsAny(domain, " _#/") && net.ParseIP(domain) == nil {
								validCount++
								domainMap[domain] = struct{}{}
								rootCounts[getBaseDomain(domain)]++
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

			// PERFORM AGGRESSIVE PRUNING HEURISTICS
			finalDomains := make(map[string]struct{})
			for d := range domainMap {
				base := getBaseDomain(d)
				if rootCounts[base] > 3 && !protectedRoots[base] {
					if !wlMap["*."+base] { finalDomains["*."+base] = struct{}{} }
					if !wlMap[base] { finalDomains[base] = struct{}{} }
				} else {
					if !wlMap[d] { finalDomains[d] = struct{}{} }
				}
			}

			for d := range finalDomains {
				compiledLines = append(compiledLines, fmt.Sprintf("%s %s", d, blockAction))
			}
			log.Printf("[RPZ Worker] Heuristic Deduction Complete: %d original records pruned to %d output rules.", len(domainMap), len(finalDomains))

			// Write Whitelist explicit rules at bottom to guarantee parsing validity
			for d := range wlMap {
				compiledLines = append(compiledLines, fmt.Sprintf("%s CNAME rpz-passthru.", d))
			}

			// Write Compiled RPZ Zone Master to disk
			errWrite := ioutil.WriteFile("/etc/powerdns/rpz_compiled.zone", []byte(strings.Join(compiledLines, "\n")), 0644)
			if errWrite == nil {
				// Signal PowerDNS to instantly reload latest compiled policies
				exec.Command("rec_control", "reload-lua-config").Run()
				exec.Command("rec_control", "wipe-cache", "$").Run()
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

func sanitizeDomain(domain string) string {
	domain = strings.TrimSpace(domain)
	domain = strings.ReplaceAll(domain, "http://", "")
	domain = strings.ReplaceAll(domain, "https://", "")
	domain = strings.Split(domain, "/")[0]

	// Collapse leading asterisks into a clean wildcard *.
	if strings.HasPrefix(domain, "*") {
		cleanPrefix := strings.TrimLeft(domain, "*.")
		domain = "*." + cleanPrefix
	}

	// Check for any remaining asterisks in the middle (censored domains like "p***.com")
	// These are completely invalid for DNS RPZ and impossible to resolve
	if strings.Contains(strings.TrimPrefix(domain, "*."), "*") {
		return ""
	}

	return domain
}

// Protected Root Domains (Sangat terbatas pada infrastruktur kritikal & pemerintahan)
var protectedRoots = map[string]bool{
	"google.com": true, "youtube.com": true, "facebook.com": true, "instagram.com": true,
	"x.com": true, "twitter.com": true, "tiktok.com": true, "cloudflare.com": true,
	"github.com": true, "amazon.com": true, "amazonaws.com": true,
	"go.id": true, "ac.id": true, "co.id": true, "sch.id": true, "desa.id": true,
}

func getBaseDomain(domain string) string {
	domain = strings.TrimPrefix(domain, "*.")
	parts := strings.Split(domain, ".")
	if len(parts) <= 2 {
		return domain
	}
	last := parts[len(parts)-1]
	secondLast := parts[len(parts)-2]
	if len(last) == 2 && (secondLast == "co" || secondLast == "or" || secondLast == "ac" || secondLast == "go" || secondLast == "sch" || secondLast == "net" || secondLast == "web" || secondLast == "my" || secondLast == "desa") {
		if len(parts) >= 3 {
			return parts[len(parts)-3] + "." + secondLast + "." + last
		}
	}
	return secondLast + "." + last
}

func GetTopAnalytics(c *fiber.Ctx) error {
	metricsMutex.RLock()
	defer metricsMutex.RUnlock()

	// Simplify map to limited array for frontend
	type Stat struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
		Allow int    `json:"allow,omitempty"`
		Block int    `json:"block,omitempty"`
	}

	var clients []Stat
	for k, v := range topClients {
		clients = append(clients, Stat{Name: k, Count: v.Allow + v.Block, Allow: v.Allow, Block: v.Block})
	}
	var allowedDomains []Stat
	for k, v := range topAllowedDomains {
		allowedDomains = append(allowedDomains, Stat{Name: k, Count: v})
	}
	var blockedDomains []Stat
	for k, v := range topBlockedDomains {
		blockedDomains = append(blockedDomains, Stat{Name: k, Count: v})
	}

	return c.JSON(fiber.Map{
		"top_clients":         clients,
		"top_allowed_domains": allowedDomains,
		"top_blocked_domains": blockedDomains,
	})
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

		// Parse for Analytics
		var entry map[string]interface{}
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			metricsMutex.Lock()
			action := ""
			if a, ok := entry["action"].(string); ok {
				action = a
			}
			
			// Detect Query Types and Anomalies
			if qtype, ok := entry["type"].(float64); ok {
				qtypeInt := int(qtype)
				var typeName string
				switch qtypeInt {
				case 1: typeName = "A"
				case 28: typeName = "AAAA"
				case 15: typeName = "MX"
				case 16: typeName = "TXT"
				case 255: typeName = "ANY"
				default: typeName = "OTHER"
				}
				queryTypeMap[typeName]++

				ipStr, _ := entry["ip"].(string)
				domainStr, _ := entry["qname"].(string)

				if typeName == "ANY" {
					msg := fmt.Sprintf("CRIT: POSSIBLE AMPLIFICATION ATTACK FROM %s (ANY Query)", ipStr)
					addTelemetryAlert(msg, "CRIT")
				}
				if typeName == "TXT" && len(domainStr) > 60 {
					msg := fmt.Sprintf("WARN: ABNORMAL TXT LENGTH (DNS Tunneling suspected). Domain: %s | Client: %s", domainStr, ipStr)
					addTelemetryAlert(msg, "WARN")
				}
			}

			if ip, ok := entry["ip"].(string); ok {
				if topClients[ip] == nil {
					topClients[ip] = &ClientStat{}
				}
				if action == "ALLOW" {
					topClients[ip].Allow++
				} else {
					topClients[ip].Block++
				}
			}
			if domain, ok := entry["qname"].(string); ok {
				if action == "ALLOW" {
					topAllowedDomains[domain]++
				} else {
					topBlockedDomains[domain]++
				}
			}
			metricsMutex.Unlock()
		}
	}
}

type DigTarget struct {
	Domain string `json:"domain"`
}

func GetDigTargets(c *fiber.Ctx) error {
	var val string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'dig_targets'").Scan(&val)
	if err != nil || val == "" {
		val = `[{"domain":"google.com"},{"domain":"bankmandiri.co.id"},{"domain":"1.1.1.1"}]`
	}
	var targets []DigTarget
	json.Unmarshal([]byte(val), &targets)
	return c.JSON(fiber.Map{"targets": targets})
}

func SaveDigTargets(c *fiber.Ctx) error {
	var req struct {
		Targets []DigTarget `json:"targets"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "invalid request"})
	}
	b, _ := json.Marshal(req.Targets)
	db.Exec(`INSERT INTO settings (key, value) VALUES ('dig_targets', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(b))
	return c.JSON(fiber.Map{"message": "Dig targets saved"})
}

func GetDigHealth(c *fiber.Ctx) error {
	var val string
	db.QueryRow("SELECT value FROM settings WHERE key = 'dig_targets'").Scan(&val)
	if val == "" {
		val = `[{"domain":"google.com"},{"domain":"bankmandiri.co.id"},{"domain":"1.1.1.1"}]`
	}
	var targets []DigTarget
	json.Unmarshal([]byte(val), &targets)

	type HealthResult struct {
		Domain  string `json:"domain"`
		Latency int    `json:"latency"`
		Status  string `json:"status"` // "OK" or "TIMEOUT"
	}

	results := make([]HealthResult, 0)
	var wg sync.WaitGroup
	var mu sync.Mutex

	// We ping each target concurrently respecting 1.5s timeout manually
	for _, t := range targets {
		if t.Domain == "" { continue }
		wg.Add(1)
		go func(domain string) {
			defer wg.Done()
			start := time.Now()
			// Basic DNS resolve locally. We assume local resolver manages to ping it.
			_, err := net.LookupHost(domain)
			latency := int(time.Since(start).Milliseconds())
			status := "OK"
			if err != nil || latency > 2000 {
				status = "TIMEOUT"
			}
			mu.Lock()
			results = append(results, HealthResult{Domain: domain, Latency: latency, Status: status})
			mu.Unlock()
		}(t.Domain)
	}

	wg.Wait()
	return c.JSON(fiber.Map{"health": results})
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

func addTelemetryAlert(msg, level string) {
	metricsMutex.Lock()
	defer metricsMutex.Unlock()
	for _, a := range telemetryAlerts {
		if a.Message == msg { return } // prevent spam
	}
	alert := TelemetryAlert{
		Message: msg,
		Level:   level,
		Time:    time.Now().Format("15:04:05"),
	}
	telemetryAlerts = append([]TelemetryAlert{alert}, telemetryAlerts...)
	if len(telemetryAlerts) > 10 {
		telemetryAlerts = telemetryAlerts[:10]
	}
}

func liveQPSWorker() {
	ticker := time.NewTicker(3 * time.Second)
	var lastCount float64
	for range ticker.C {
		out, err := exec.Command("rec_control", "get", "questions").Output()
		if err == nil {
			val, _ := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
			if lastCount > 0 {
				metricsMutex.Lock()
				liveQPS = (val - lastCount) / 3.0
				if liveQPS < 0 { liveQPS = 0 }
				metricsMutex.Unlock()
			} else {
				metricsMutex.Lock()
				liveQPS = 0
				metricsMutex.Unlock()
			}
			lastCount = val
		}
	}
}

func systemTelemetryWorker() {
	ticker := time.NewTicker(1 * time.Minute)
	// pre-fill some dummy history to start
	metricsMutex.Lock()
	now := time.Now()
	for i := 30; i > 0; i-- {
		t := now.Add(-time.Duration(i*1) * time.Minute)
		historySeries = append(historySeries, TimeSeriesPoint{Time: t.Format("15:04"), QPS: float64(6000 + i*100), Latency: float64(12 + i/2), CacheRatio: float64(80 + i)})
	}
	metricsMutex.Unlock()

	var lastQuestions float64

	for range ticker.C {
		out, err := exec.Command("rec_control", "get-all").Output()
		var qps, latency, hitRatio float64
		if err == nil {
			lines := strings.Split(string(out), "\n")
			metrics := make(map[string]float64)
			for _, line := range lines {
				parts := strings.Fields(line)
				if len(parts) == 2 {
					val, _ := strconv.ParseFloat(parts[1], 64)
					metrics[parts[0]] = val
				}
			}
			hits := metrics["cache-hits"]
			misses := metrics["cache-misses"]
			if hits+misses > 0 {
				hitRatio = (hits / (hits + misses)) * 100
			}
			
			if lastQuestions > 0 {
				qps = (metrics["questions"] - lastQuestions) / 60.0
				if qps < 0 { qps = 0 }
			} else {
				qps = 0
			}
			lastQuestions = metrics["questions"]
			
			latency = metrics["qa-latency"] / 1000.0
		}
		
		metricsMutex.Lock()
		historySeries = append(historySeries, TimeSeriesPoint{
			Time:       time.Now().Format("15:04"),
			QPS:        math.Round(qps),
			Latency:    math.Round(latency*10)/10,
			CacheRatio: math.Round(hitRatio*10)/10,
		})
		if len(historySeries) > 30 {
			historySeries = historySeries[1:]
		}
		metricsMutex.Unlock()
	}
}
