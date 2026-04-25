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
	"sort"


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

type BGPPeer struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	IP       string `json:"ip"`
	ASN      int    `json:"asn"`
	Multihop int    `json:"multihop"`
	MD5      string `json:"md5"`
	Enabled  bool   `json:"enabled"`
}

type BGPConfig struct {
	Enabled  bool       `json:"enabled"`
	LocalASN int        `json:"local_asn"`
	RouterID string     `json:"router_id"`
	Peers    []BGPPeer  `json:"peers"`
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

type WorkerLog struct {
	Worker string `json:"worker"`
	Msg    string `json:"msg"`
	Time   string `json:"time"`
}

var (
	workerLogs      []WorkerLog
	workerLogsMutex sync.RWMutex
)

func addWorkerLog(worker string, msg string) {
	workerLogsMutex.Lock()
	defer workerLogsMutex.Unlock()
	workerLogs = append([]WorkerLog{{Worker: worker, Msg: msg, Time: time.Now().Format("15:04:05")}}, workerLogs...)
	if len(workerLogs) > 200 {
		workerLogs = workerLogs[:200]
	}
}

type TopAnalyticItem struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type DigHealth struct {
	Domain  string `json:"domain"`
	Status  string `json:"status"`
	Latency int    `json:"latency"`
	Ping    int    `json:"ping"`
}

var (
	globalTopClients   []TopAnalyticItem
	globalTopAllowed   []TopAnalyticItem
	globalTopBlocked   []TopAnalyticItem
	digHealth          []DigHealth
)

func parsePDNSTopOutput(out string) []TopAnalyticItem {
	var items []TopAnalyticItem
	lines := strings.Split(out, "\n")
	for _, line := range lines {
		if strings.Contains(line, "%") && !strings.Contains(line, "rest") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				name := strings.Split(parts[1], "|")[0]
				pctStr := strings.TrimRight(parts[0], "%")
				pct, _ := strconv.ParseFloat(pctStr, 64)
				countObj := int(pct)
				if countObj == 0 {
					countObj = 1
				}
				items = append(items, TopAnalyticItem{Name: name, Count: countObj * 10})
			}
		}
	}
	return items
}

func advancedMonitoringWorker() {
	checkNodes := []string{"1.1.1.1", "8.8.8.8", "9.9.9.9"}
	for {
		outC, _ := exec.Command("rec_control", "top-remotes").Output()
		tc := parsePDNSTopOutput(string(outC))
		
		outQ, _ := exec.Command("rec_control", "top-queries").Output()
		ta := parsePDNSTopOutput(string(outQ))
		
		var dh []DigHealth
		for _, node := range checkNodes {
			start := time.Now()
			err := exec.Command("ping", "-c", "1", "-W", "1", "-q", node).Run()
			latency := int(time.Since(start).Milliseconds())
			status := "OK"
			if err != nil {
				status = "ERR"
			}
			dh = append(dh, DigHealth{
				Domain:  node,
				Status:  status,
				Latency: latency,
				Ping:    latency,
			})
		}
		
		metricsMutex.Lock()
		globalTopClients = tc
		globalTopAllowed = ta
		digHealth = dh
		metricsMutex.Unlock()
		
		time.Sleep(10 * time.Second)
	}
}

func main() {
	initDB()
	writeCustomRPZ()

	// Mulai background workers
	go syncRPZWorker()
	go streamLogs()
	go advancedMonitoringWorker()
	go systemTelemetryWorker()
	go liveQPSWorker()
	go prefetchWorker()
	go upstreamScoringWorker()

	app := fiber.New(fiber.Config{
		ServerHeader: "NetShield DNS",
		AppName:      "NetShield API v2.0",
	})

	app.Use(cors.New())
	app.Use(logger.New())

	api := app.Group("/api")

	// Public Routes
	api.Post("/cli-change-password", func(c *fiber.Ctx) error {
		if c.IP() != "127.0.0.1" && c.IP() != "::1" {
			return c.Status(403).SendString("Forbidden")
		}
		var req struct { Password string `json:"password"` }
		if err := c.BodyParser(&req); err != nil { return err }
		if req.Password != "" {
			hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), 10)
			db.Exec("UPDATE users SET password_hash = ? WHERE email = 'hendra@servicex.id'", string(hash))
		}
		return c.SendString("OK")
	})

	api.Post("/cli-toggle-tproxy", func(c *fiber.Ctx) error {
		if c.IP() != "127.0.0.1" && c.IP() != "::1" {
			return c.Status(403).SendString("Forbidden")
		}
		var req struct { Tproxy bool `json:"tproxy"` }
		if err := c.BodyParser(&req); err != nil { return err }

		tproxyStr := "false"
		if req.Tproxy { tproxyStr = "true" }
		db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('tproxy_enabled', 'false')")
		db.Exec("UPDATE settings SET value = ? WHERE key = 'tproxy_enabled'", tproxyStr)

		exec.Command("bash", "-c", "nft add table ip netshield_nat || true").Run()
		exec.Command("bash", "-c", "nft flush table ip netshield_nat").Run()
		exec.Command("bash", "-c", "nft add chain ip netshield_nat prerouting '{ type nat hook prerouting priority dstnat; policy accept; }'").Run()
		
		if req.Tproxy {
			exec.Command("bash", "-c", "nft add rule ip netshield_nat prerouting udp dport 53 redirect to :53").Run()
			exec.Command("bash", "-c", "nft add rule ip netshield_nat prerouting tcp dport 53 redirect to :53").Run()
			exec.Command("bash", "-c", "nft add rule ip netshield_nat prerouting tcp dport 80 redirect to :53").Run()
		}
		return c.SendString("OK")
	})

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

	admin.Get("/worker-logs", func(c *fiber.Ctx) error {
		workerLogsMutex.RLock()
		defer workerLogsMutex.RUnlock()
		return c.JSON(fiber.Map{"logs": workerLogs})
	})

	admin.Get("/forwarders", GetForwarders)
	admin.Post("/forwarders", SaveForwarders)

	admin.Get("/search-rpz", SearchRPZ)

	admin.Get("/custom-lists", GetCustomLists)
	admin.Post("/custom-lists", SaveCustomLists)

	admin.Get("/advanced-config", GetAdvancedConfig)
	admin.Post("/advanced-config", SaveAdvancedConfig)

	admin.Get("/dig-targets", GetDigTargets)
	admin.Post("/dig-targets", SaveDigTargets)

	admin.Get("/bgp-config", GetBGPConfig)
	admin.Post("/bgp-config", SaveBGPConfig)
	admin.Get("/bgp-status", GetBGPStatus)

	admin.Get("/upstream", GetUpstreamConfig)
	admin.Post("/upstream", SaveUpstreamConfig)

	admin.Get("/top-domains", GetTopDomains)
	admin.Get("/upstream-health", GetUpstreamHealth)

	admin.Get("/sys-update/check", CheckSysUpdate)
	admin.Post("/sys-update/pull", PullSysUpdate)
	admin.Get("/sys-update/status", GetSysUpdateStatus)
	admin.Get("/sys-update/log", GetSysUpdateLog)
	admin.Get("/sys/intel-log", GetIntelLog)
	admin.Delete("/sys/intel-log", ClearIntelLog)

	admin.Get("/xdp/stats", GetXDPStatsAPI)
	admin.Post("/xdp/toggle", ToggleXDP)

	// Zones Management
	admin.Get("/zones", GetZones)
	admin.Post("/zones", AddZone)
	admin.Delete("/zones/:id", DeleteZone)
	
	// Zone Records
	admin.Post("/records", AddRecord)
	admin.Delete("/records/:id", DeleteRecord)

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
	);
	CREATE TABLE IF NOT EXISTS zones (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		domain TEXT UNIQUE NOT NULL
	);
	CREATE TABLE IF NOT EXISTS zone_records (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		zone_id INTEGER,
		type TEXT NOT NULL,
		name TEXT NOT NULL,
		content TEXT NOT NULL,
		ttl INTEGER DEFAULT 3600,
		FOREIGN KEY(zone_id) REFERENCES zones(id) ON DELETE CASCADE
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
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('tproxy_enabled', 'true')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('acl_ips', '127.0.0.0/8\n10.0.0.0/8\n192.168.0.0/16\n172.16.0.0/12')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_feeds', 'https://trustpositif.kominfo.go.id/')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('domain_forwarders', 'kominfo.go.id,8.8.8.8,1.1.1.1')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('parent_resolvers', ',,,,,')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_blacklist', '')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('custom_whitelist', '')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('safesearch_enabled', 'false')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('dnssec_enabled', 'false')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('rpz_sync_interval', '1440')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('upstream_forwarding_enabled', 'false')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('upstream_resolvers', '1.1.1.1,8.8.8.8,9.9.9.9')`)
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

	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('bgp_enabled', 'false')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('bgp_local_asn', '65000')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('bgp_router_id', '127.0.0.1')`)
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('bgp_peers', '[]')`)

	// ALWAYS securely regenerate PowerDNS Lua mappings on Startup!
	log.Println("Regenerating PowerDNS config files based on DB State...")
	generateLuaConfig()
	generateACLConfig()
	generateForwardersConfig()
	generateGoBGPConfig()
}

func generateACLConfig() {
	var ipsStr string
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'acl_ips'").Scan(&ipsStr)
	if err == nil {
		ioutil.WriteFile("/etc/powerdns/allowed_ips.txt", []byte(ipsStr), 0644)
	}
	exec.Command("rec_control", "reload-lua-script").Run()
	exec.Command("rec_control", "wipe-cache", "$").Run()
	exec.Command("dnsdist", "--config", "/etc/powerdns/dnsdist.conf", "-c", "127.0.0.1:5199", "-k", "odCw4adPMwaEYslkALNwp4K7UksD3av9TGpDeSge814=", "-e", "getPool(\"UNBOUND\"):getCache():expunge(0)").Run()
}

func generateForwardersConfig() {
	var domFwd, parResStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'domain_forwarders'").Scan(&domFwd)
	db.QueryRow("SELECT value FROM settings WHERE key = 'parent_resolvers'").Scan(&parResStr)

	// Baca konfigurasi Upstream Global Forwarding
	var upstreamEnabled, upstreamResolvers string
	db.QueryRow("SELECT value FROM settings WHERE key = 'upstream_forwarding_enabled'").Scan(&upstreamEnabled)
	db.QueryRow("SELECT value FROM settings WHERE key = 'upstream_resolvers'").Scan(&upstreamResolvers)

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

	// Parent Resolvers (manual per-slot)
	var pIPs []string
	for _, ip := range strings.Split(parResStr, ",") {
		ip = strings.TrimSpace(ip)
		if ip != "" { pIPs = append(pIPs, ip) }
	}
	if len(pIPs) > 0 { fileLines = append(fileLines, fmt.Sprintf("+.=%s", strings.Join(pIPs, ";"))) }

	// Upstream Global Forwarding (jika diaktifkan dari panel admin)
	// Ini memaksa PowerDNS meneruskan SEMUA cache-miss ke resolver raksasa
	// alih-alih melakukan rekursi penuh sendiri (Root→TLD→Auth = 65ms → 5ms)
	if upstreamEnabled == "true" && upstreamResolvers != "" {
		var uIPs []string
		for _, ip := range strings.Split(upstreamResolvers, ",") {
			ip = strings.TrimSpace(ip)
			if ip != "" { uIPs = append(uIPs, ip) }
		}
		if len(uIPs) > 0 {
			// Forward global zone (.) ke upstream resolvers
			// Ini MENGGANTIKAN parent_resolvers jika keduanya aktif
			fileLines = append(fileLines, fmt.Sprintf("+.=%s", strings.Join(uIPs, ";")))
		}
	}

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
	luaContent += `rpzFile("/etc/powerdns/custom_whitelist.zone", {defpol=Policy.Passthru})` + "\n"
	if lamanLabuhIP != "" {
		luaContent += fmt.Sprintf(`rpzFile("/etc/powerdns/custom_blacklist.zone", {defpol=Policy.Custom, defcontent="%s"})`+"\n", lamanLabuhIP)
	} else {
		luaContent += `rpzFile("/etc/powerdns/custom_blacklist.zone")` + "\n"
	}

	for _, f := range axfrFeeds {
		if f.Enabled && f.MasterIP != "" && f.ZoneName != "" {
			if lamanLabuhIP != "" {
				luaContent += fmt.Sprintf(`rpzMaster({"%s"}, "%s", {defpol=Policy.Custom, defcontent="%s", dumpFile="/etc/powerdns/axfr_%s.zone", axfrTimeout=1200, maxIdleTime=60})`+"\n", f.MasterIP, f.ZoneName, lamanLabuhIP, f.ZoneName)
			} else {
				// Use Kominfo's default redirect if no local override
				luaContent += fmt.Sprintf(`rpzMaster({"%s"}, "%s", {dumpFile="/etc/powerdns/axfr_%s.zone", axfrTimeout=1200, maxIdleTime=60})`+"\n", f.MasterIP, f.ZoneName, f.ZoneName)
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
	exec.Command("dnsdist", "--config", "/etc/powerdns/dnsdist.conf", "-c", "127.0.0.1:5199", "-k", "odCw4adPMwaEYslkALNwp4K7UksD3av9TGpDeSge814=", "-e", "getPool(\"backend\"):getCache():expunge(0)").Run()
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
	var safesearch, dnssec, tproxy, maxqps string
	err1 := db.QueryRow("SELECT value FROM settings WHERE key = 'safesearch_enabled'").Scan(&safesearch)
	err2 := db.QueryRow("SELECT value FROM settings WHERE key = 'dnssec_enabled'").Scan(&dnssec)
	err3 := db.QueryRow("SELECT value FROM settings WHERE key = 'tproxy_enabled'").Scan(&tproxy)
	err4 := db.QueryRow("SELECT value FROM settings WHERE key = 'max_qps_per_ip'").Scan(&maxqps)
	
	if err1 != nil { safesearch = "false" }
	if err2 != nil { dnssec = "false" }
	if err3 != nil { tproxy = "false" }
	if err4 != nil { maxqps = "0" }
	
	qpsInt, _ := strconv.Atoi(maxqps)

	return c.JSON(fiber.Map{
		"safesearch": safesearch == "true",
		"dnssec": dnssec == "true",
		"tproxy": tproxy == "true",
		"max_qps": qpsInt,
	})
}

func SaveAdvancedConfig(c *fiber.Ctx) error {
	var req struct {
		Safesearch bool `json:"safesearch"`
		Dnssec     bool `json:"dnssec"`
		Tproxy     bool `json:"tproxy"`
		MaxQPS     int  `json:"max_qps"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	safesearchStr := "false"
	if req.Safesearch { safesearchStr = "true" }
	dnssecStr := "false"
	if req.Dnssec { dnssecStr = "true" }
	tproxyStr := "false"
	if req.Tproxy { tproxyStr = "true" }
	
	maxQpsStr := strconv.Itoa(req.MaxQPS)

	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('safesearch_enabled', 'false')")
	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('dnssec_enabled', 'false')")
	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('tproxy_enabled', 'false')")
	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('max_qps_per_ip', '0')")

	db.Exec("UPDATE settings SET value = ? WHERE key = 'safesearch_enabled'", safesearchStr)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'dnssec_enabled'", dnssecStr)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'tproxy_enabled'", tproxyStr)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'max_qps_per_ip'", maxQpsStr)

	// Execute TProxy nftables
	exec.Command("bash", "-c", "nft add table ip netshield_nat || true").Run()
	exec.Command("bash", "-c", "nft flush table ip netshield_nat").Run()
	exec.Command("bash", "-c", "nft add chain ip netshield_nat prerouting '{ type nat hook prerouting priority dstnat; policy accept; }'").Run()
	
	if req.Tproxy {
		exec.Command("bash", "-c", "nft add rule ip netshield_nat prerouting udp dport 53 redirect to :53").Run()
		exec.Command("bash", "-c", "nft add rule ip netshield_nat prerouting tcp dport 53 redirect to :53").Run()
		exec.Command("bash", "-c", "nft add rule ip netshield_nat prerouting tcp dport 80 redirect to :53").Run()
	}

	generateLuaConfig()

	// Update DNSDist Config for Max QPS
	b, err := ioutil.ReadFile("/etc/powerdns/dnsdist.conf")
	if err == nil {
		lines := strings.Split(string(b), "\n")
		changed := false
		for i, line := range lines {
			if strings.Contains(line, "MaxQPSIPRule") {
				if req.MaxQPS > 0 {
					lines[i] = fmt.Sprintf("addAction(MaxQPSIPRule(%d), TCAction())", req.MaxQPS)
				} else {
					lines[i] = "-- addAction(MaxQPSIPRule(1000), DropAction())"
				}
				changed = true
			}
		}
		if changed {
			ioutil.WriteFile("/etc/powerdns/dnsdist.conf", []byte(strings.Join(lines, "\n")), 0644)
			exec.Command("supervisorctl", "restart", "dnsdist").Run()
		}
	}

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

	var topA_clients []TopAnalyticItem
	var topA_allowed []TopAnalyticItem
	var dh []DigHealth

	metricsMutex.RLock()
	hist := make([]TimeSeriesPoint, len(historySeries))
	copy(hist, historySeries)
	qMap := make(map[string]int)
	for k, v := range queryTypeMap { qMap[k] = v }
	alrts := make([]TelemetryAlert, len(telemetryAlerts))
	copy(alrts, telemetryAlerts)
	
	// Copy topAnalytics to prevent race conditions during serialization
	topA_clients = make([]TopAnalyticItem, len(globalTopClients))
	copy(topA_clients, globalTopClients)
	topA_allowed = make([]TopAnalyticItem, len(globalTopAllowed))
	copy(topA_allowed, globalTopAllowed)
	dh = make([]DigHealth, len(digHealth))
	copy(dh, digHealth)
	
	metricsMutex.RUnlock()

	workerLogsMutex.RLock()
	wLogs := make([]WorkerLog, len(workerLogs))
	copy(wLogs, workerLogs)
	workerLogsMutex.RUnlock()

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
		"worker_logs":      wLogs,
		"response_codes": map[string]float64{
			"NOERROR": noerr,
			"NXDOMAIN": nx,
			"SERVFAIL": servfail,
		},
		"topAnalytics": fiber.Map{
			"clients": topA_clients,
			"allowed": topA_allowed,
			"blocked": []TopAnalyticItem{}, // Optional mock or leave empty for NXDOMAIN blocked features
		},
		"digHealth": dh,
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

func GetBGPStatus(c *fiber.Ctx) error {
	out, err := exec.Command("timeout", "3", "gobgp", "neighbor", "-j").Output()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to connect to GoBGP daemon or daemon is stopped"})
	}
	var data interface{}
	if err := json.Unmarshal(out, &data); err != nil {
		return c.JSON([]interface{}{})
	}
	return c.JSON(data)
}

func GetBGPConfig(c *fiber.Ctx) error {
	var cfg BGPConfig
	var enabledStr, lAsn, peersStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_enabled'").Scan(&enabledStr)
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_local_asn'").Scan(&lAsn)
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_router_id'").Scan(&cfg.RouterID)
	err := db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_peers'").Scan(&peersStr)
	if err != nil || peersStr == "" {
		peersStr = "[]"
	}

	cfg.Enabled = enabledStr == "true"
	cfg.LocalASN, _ = strconv.Atoi(lAsn)
	json.Unmarshal([]byte(peersStr), &cfg.Peers)
	if cfg.Peers == nil { cfg.Peers = []BGPPeer{} }

	return c.JSON(cfg)
}

func SaveBGPConfig(c *fiber.Ctx) error {
	var req BGPConfig
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	enabledStr := "false"
	if req.Enabled { enabledStr = "true" }
	peersBytes, _ := json.Marshal(req.Peers)

	db.Exec("UPDATE settings SET value = ? WHERE key = 'bgp_enabled'", enabledStr)
	db.Exec("UPDATE settings SET value = ? WHERE key = 'bgp_local_asn'", strconv.Itoa(req.LocalASN))
	db.Exec("UPDATE settings SET value = ? WHERE key = 'bgp_router_id'", req.RouterID)
	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('bgp_peers', '[]')")
	db.Exec("UPDATE settings SET value = ? WHERE key = 'bgp_peers'", string(peersBytes))

	generateGoBGPConfig()

	return c.JSON(fiber.Map{"message": "BGP Config saved and reloaded"})
}

func generateGoBGPConfig() {
	var enabled, _localASN, routerID, peersStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_enabled'").Scan(&enabled)
	if enabled != "true" {
		ioutil.WriteFile("/etc/gobgpd.toml", []byte(""), 0644)
		exec.Command("supervisorctl", "restart", "gobgp").Run()
		return
	}
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_local_asn'").Scan(&_localASN)
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_router_id'").Scan(&routerID)
	db.QueryRow("SELECT value FROM settings WHERE key = 'bgp_peers'").Scan(&peersStr)

	var peers []BGPPeer
	if peersStr == "" { peersStr = "[]" }
	json.Unmarshal([]byte(peersStr), &peers)

	var sb strings.Builder
	sb.WriteString("[global.config]\n")
	sb.WriteString(fmt.Sprintf("  as = %s\n", _localASN))
	sb.WriteString(fmt.Sprintf("  router-id = \"%s\"\n\n", routerID))

	sb.WriteString("[[policy-definitions]]\n")
	sb.WriteString("  name = \"next-hop-self\"\n")
	sb.WriteString("  [[policy-definitions.statements]]\n")
	sb.WriteString("    name = \"st1\"\n")
	sb.WriteString("    [policy-definitions.statements.actions.bgp-actions]\n")
	sb.WriteString(fmt.Sprintf("      set-next-hop = \"%s\"\n\n", routerID))

	localAsnInt, _ := strconv.Atoi(_localASN)

	for _, p := range peers {
		if !p.Enabled || p.IP == "" { continue }
		sb.WriteString("[[neighbors]]\n")
		sb.WriteString("  [neighbors.config]\n")
		sb.WriteString(fmt.Sprintf("    neighbor-address = \"%s\"\n", p.IP))
		sb.WriteString(fmt.Sprintf("    peer-as = %d\n", p.ASN))
		if p.MD5 != "" {
			sb.WriteString(fmt.Sprintf("    auth-password = \"%s\"\n", p.MD5))
		}

		if p.Type == "ebgp" && p.Multihop > 0 {
			sb.WriteString("  [neighbors.ebgp-multihop.config]\n")
			sb.WriteString("    enabled = true\n")
			sb.WriteString(fmt.Sprintf("    multihop-ttl = %d\n", p.Multihop))
		}

		if p.Type == "ibgp" || p.ASN == localAsnInt {
			sb.WriteString("  [neighbors.apply-policy.config]\n")
			sb.WriteString("    export-policy-list = [\"next-hop-self\"]\n")
			sb.WriteString("    default-export-policy = \"accept-route\"\n")
		}
		sb.WriteString("\n")
	}

	ioutil.WriteFile("/etc/gobgpd.toml", []byte(sb.String()), 0644)
	addWorkerLog("BGP", "Reloading GoBGP Configuration")
    
	err := exec.Command("pkill", "-SIGHUP", "gobgpd").Run()
	if err != nil {
		exec.Command("supervisorctl", "start", "gobgp").Run()
	}
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
	
	var resMode string
	db.QueryRow("SELECT value FROM settings WHERE key = 'resolver_mode'").Scan(&resMode)
	if resMode == "" {
		resMode = "hybrid"
	}

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
		"resolver_mode":     resMode,
	})
}

func SaveForwarders(c *fiber.Ctx) error {
	var req struct {
		DomainForwarders string   `json:"domain_forwarders"`
		ParentResolvers  []string `json:"parent_resolvers"`
		ResolverMode     string   `json:"resolver_mode"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	db.Exec("UPDATE settings SET value = ? WHERE key = 'domain_forwarders'", req.DomainForwarders)
	
	validP := []string{}
	for _, p := range req.ParentResolvers {
		if strings.TrimSpace(p) != "" {
			validP = append(validP, strings.TrimSpace(p))
		}
	}
	parResStr := strings.Join(validP, ",")
	db.Exec("UPDATE settings SET value = ? WHERE key = 'parent_resolvers'", parResStr)
	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('parent_resolvers', ?)", parResStr)

	resMode := req.ResolverMode
	if resMode != "root_only" && resMode != "forward_only" && resMode != "hybrid" {
		resMode = "hybrid"
	}
	db.Exec("UPDATE settings SET value = ? WHERE key = 'resolver_mode'", resMode)
	db.Exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('resolver_mode', ?)", resMode)

	generateForwardersConfig()
	go GenerateConfigs()

	return c.JSON(fiber.Map{"message": "Forwarders updated successfully"})
}

func GetUpstreamConfig(c *fiber.Ctx) error {
	var fwds string
	db.QueryRow(`SELECT value FROM settings WHERE key = 'parent_resolvers'`).Scan(&fwds)
	
	fwdList := []string{}
	for _, f := range strings.Split(fwds, ",") {
		if strings.TrimSpace(f) != "" {
			fwdList = append(fwdList, strings.TrimSpace(f))
		}
	}

	var dnssecStr, dohStr, dotStr, resolverMode string
	db.QueryRow(`SELECT value FROM settings WHERE key = 'dnssec_enabled'`).Scan(&dnssecStr)
	db.QueryRow(`SELECT value FROM settings WHERE key = 'doh_enabled'`).Scan(&dohStr)
	db.QueryRow(`SELECT value FROM settings WHERE key = 'dot_enabled'`).Scan(&dotStr)
	db.QueryRow(`SELECT value FROM settings WHERE key = 'resolver_mode'`).Scan(&resolverMode)
	
	if resolverMode == "" {
		resolverMode = "hybrid"
	}

	return c.JSON(fiber.Map{
		"forwarders": fwdList,
		"dnssec":     dnssecStr == "true",
		"doh":        dohStr == "true",
		"dot":        dotStr == "true",
		"resolver_mode": resolverMode,
	})
}

func SaveUpstreamConfig(c *fiber.Ctx) error {
	var req struct {
		Forwarders []string `json:"forwarders"`
		DNSSEC     bool     `json:"dnssec"`
		DoH        bool     `json:"doh"`
		DoT        bool     `json:"dot"`
		ResolverMode string `json:"resolver_mode"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	fwds := strings.Join(req.Forwarders, ",")
	dnssecStr := "false"
	if req.DNSSEC {
		dnssecStr = "true"
	}
	dohStr := "false"
	if req.DoH {
		dohStr = "true"
	}
	dotStr := "false"
	if req.DoT {
		dotStr = "true"
	}
	rMode := req.ResolverMode
	if rMode != "root_only" && rMode != "forward_only" && rMode != "hybrid" {
		rMode = "hybrid"
	}

	db.Exec(`UPDATE settings SET value = ? WHERE key = 'parent_resolvers'`, fwds)
	db.Exec(`INSERT OR REPLACE INTO settings (key, value) VALUES ('parent_resolvers', ?)`, fwds)
	
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('dnssec_enabled', ?)`, dnssecStr)
	db.Exec(`UPDATE settings SET value = ? WHERE key = 'dnssec_enabled'`, dnssecStr)
	
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('doh_enabled', ?)`, dohStr)
	db.Exec(`UPDATE settings SET value = ? WHERE key = 'doh_enabled'`, dohStr)
	
	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('dot_enabled', ?)`, dotStr)
	db.Exec(`UPDATE settings SET value = ? WHERE key = 'dot_enabled'`, dotStr)

	db.Exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('resolver_mode', ?)`, rMode)
	db.Exec(`UPDATE settings SET value = ? WHERE key = 'resolver_mode'`, rMode)

	// Call Configuration Template Engine
	go GenerateConfigs()

	return c.JSON(fiber.Map{"status": "success", "message": "Upstream config saved, backend reloading..."})
}

func syncRPZWorker() {
	var intervalStr string
	db.QueryRow("SELECT value FROM settings WHERE key = 'rpz_sync_interval'").Scan(&intervalStr)
	interval := 1
	if res, err := strconv.Atoi(intervalStr); err == nil && res > 0 {
		interval = res
	}

	// Jangan fetch ulang setiap restart jika cache masih segar (berdasarkan ModTime dan Size)
	if stat, err := os.Stat("/etc/powerdns/rpz_compiled.zone"); err == nil && stat.Size() > 200 {
		timePassed := time.Since(stat.ModTime())
		timeRequired := time.Duration(interval) * time.Minute
		if timePassed < timeRequired {
			sleepTime := timeRequired - timePassed
			msg := fmt.Sprintf("Startup: Cache zone RPZ masih segar. Menunda antrean fetch selama %v...", sleepTime.Round(time.Second))
			log.Println("[RPZ Worker]", msg)
			addWorkerLog("RPZ WORKER", msg)
			
			select {
			case <-time.After(sleepTime):
			case <-forceSync:
			}
		}
	}

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
			// DIRECT MAPPING WITHOUT HEURISTICS
			finalDomains := make(map[string]struct{})
			for d := range domainMap {
				if !wlMap[d] { 
					finalDomains[d] = struct{}{} 
				}
			}

			for d := range finalDomains {
				compiledLines = append(compiledLines, fmt.Sprintf("%s %s", d, blockAction))
			}
			msg := fmt.Sprintf("[RPZ Worker] Parsing Selesai: %d original records menghasilkan %d rules blokir akurat.", len(domainMap), len(finalDomains))
			log.Println(msg)
			addWorkerLog("RPZ WORKER", msg)

			// Generate the mmap Bloom Filter for DNSDist
			go generateBloomFilter(finalDomains)

			// Write Whitelist explicit rules at bottom to guarantee parsing validity
			for d := range wlMap {
				compiledLines = append(compiledLines, fmt.Sprintf("%s CNAME rpz-passthru.", d))
			}

			// Write Compiled RPZ Zone Master to disk
			errWrite := ioutil.WriteFile("/etc/powerdns/rpz_compiled.zone", []byte(strings.Join(compiledLines, "\n")), 0644)
			if errWrite == nil {
				// Signal PowerDNS to instantly reload latest compiled policies
				exec.Command("rec_control", "reload-lua-config").Run()
				exec.Command("rec_control", "reload-zones").Run()
				exec.Command("rec_control", "wipe-cache", "$").Run()
				exec.Command("dnsdist", "--config", "/etc/powerdns/dnsdist.conf", "-c", "127.0.0.1:5199", "-k", "odCw4adPMwaEYslkALNwp4K7UksD3av9TGpDeSge814=", "-e", "getPool(\"UNBOUND\"):getCache():expunge(0)").Run()

				// Sinkronisasi ke XDP BPF Map (jika XDP aktif)
				// Domain terblokir akan di-DROP di level NIC!
				if isXDPActive() {
					var xdpDomains []string
					for d := range finalDomains {
						xdpDomains = append(xdpDomains, d)
					}
					go syncDomainsToXDP(xdpDomains)
					log.Printf("[RPZ Worker] XDP sync initiated for %d domains", len(xdpDomains))
				}
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
	metricsMutex.Lock()
	defer metricsMutex.Unlock()

	type Stat struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
		Allow int    `json:"allow,omitempty"`
		Block int    `json:"block,omitempty"`
	}

	clients := make([]Stat, 0, len(topClients))
	for k, v := range topClients {
		clients = append(clients, Stat{Name: k, Count: v.Allow + v.Block, Allow: v.Allow, Block: v.Block})
	}
	sort.Slice(clients, func(i, j int) bool { return clients[i].Count > clients[j].Count })
	
	allowed := make([]Stat, 0, len(topAllowedDomains))
	for k, v := range topAllowedDomains {
		allowed = append(allowed, Stat{Name: k, Count: v})
	}
	sort.Slice(allowed, func(i, j int) bool { return allowed[i].Count > allowed[j].Count })

	blocked := make([]Stat, 0, len(topBlockedDomains))
	for k, v := range topBlockedDomains {
		blocked = append(blocked, Stat{Name: k, Count: v})
	}
	sort.Slice(blocked, func(i, j int) bool { return blocked[i].Count > blocked[j].Count })

	// PRUNE maps if they get too large (prevent memory leak / CPU burn at high QPS)
	if len(clients) > 1000 {
		topClients = make(map[string]*ClientStat)
		for _, c := range clients[:1000] { topClients[c.Name] = &ClientStat{Allow: c.Allow, Block: c.Block} }
	}
	if len(allowed) > 1000 {
		topAllowedDomains = make(map[string]int)
		for _, a := range allowed[:1000] { topAllowedDomains[a.Name] = a.Count }
	}
	if len(blocked) > 1000 {
		topBlockedDomains = make(map[string]int)
		for _, b := range blocked[:1000] { topBlockedDomains[b.Name] = b.Count }
	}

	// Slice for frontend fast rendering (Top 5 / 10)
	if len(clients) > 5 { clients = clients[:5] }
	if len(allowed) > 5 { allowed = allowed[:5] }
	if len(blocked) > 10 { blocked = blocked[:10] }

	return c.JSON(fiber.Map{
		"top_clients":         clients,
		"top_allowed_domains": allowed,
		"top_blocked_domains": blocked,
	})
}

func streamLogs() {
	// Create file if not exist
	filePath := "/var/log/netshield/pdns-queries.log"
	
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

	localTopClientsAllow := make(map[string]int)
	localTopClientsBlock := make(map[string]int)
	localTopAllowedDomains := make(map[string]int)
	localTopBlockedDomains := make(map[string]int)
	localQueryTypeMap := make(map[string]int)
	var localAlerts []TelemetryAlert
	batchCount := 0

	flushBatch := func() {
		if batchCount == 0 { return }
		metricsMutex.Lock()
		for ip, count := range localTopClientsAllow {
			if topClients[ip] == nil { topClients[ip] = &ClientStat{} }
			topClients[ip].Allow += count
		}
		for ip, count := range localTopClientsBlock {
			if topClients[ip] == nil { topClients[ip] = &ClientStat{} }
			topClients[ip].Block += count
		}
		for dom, count := range localTopAllowedDomains { topAllowedDomains[dom] += count }
		for dom, count := range localTopBlockedDomains { topBlockedDomains[dom] += count }
		for qType, count := range localQueryTypeMap { queryTypeMap[qType] += count }
		for _, alert := range localAlerts {
			telemetryAlerts = append([]TelemetryAlert{alert}, telemetryAlerts...)
			if len(telemetryAlerts) > 10 { telemetryAlerts = telemetryAlerts[:10] }
		}
		metricsMutex.Unlock()

		// Reset local aggregate maps
		localTopClientsAllow = make(map[string]int)
		localTopClientsBlock = make(map[string]int)
		localTopAllowedDomains = make(map[string]int)
		localTopBlockedDomains = make(map[string]int)
		localQueryTypeMap = make(map[string]int)
		localAlerts = nil
		batchCount = 0
	}

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			flushBatch() // flush immediately on end-of-buffer wait

			// Auto Truncate log file to prevent disk bloat 
			// since we only keep statistics in memory
			if info, err := file.Stat(); err == nil && info.Size() > 5*1024*1024 { // 5MB Limit
				file.Truncate(0)
				file.Seek(0, 0)
				reader.Reset(file)
			}

			time.Sleep(100 * time.Millisecond)
			continue
		}

		line = strings.TrimSpace(line)
		if line == "" { continue }

		// Parse for Analytics
		var entry map[string]interface{}
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			action := ""
			if a, ok := entry["action"].(string); ok { action = a }
			
			var isAnomaly bool
			var typeName string = "OTHER"
			if qtype, ok := entry["type"].(float64); ok {
				qtypeInt := int(qtype)
				switch qtypeInt {
				case 1: typeName = "A"
				case 28: typeName = "AAAA"
				case 15: typeName = "MX"
				case 16: typeName = "TXT"
				case 255: typeName = "ANY"
				}

				if typeName == "ANY" || typeName == "TXT" { isAnomaly = true }

				ipStr, _ := entry["ip"].(string)
				domainStr, _ := entry["qname"].(string)

				if typeName == "ANY" {
					localAlerts = append(localAlerts, TelemetryAlert{
						Message: fmt.Sprintf("CRIT: POSSIBLE AMPLIFICATION ATTACK FROM %s (ANY Query)", ipStr),
						Level:   "CRIT",
						Time:    time.Now().Format("2006-01-02 15:04:05"),
					})
				}
				if typeName == "TXT" && len(domainStr) > 60 {
					localAlerts = append(localAlerts, TelemetryAlert{
						Message: fmt.Sprintf("WARN: ABNORMAL TXT LENGTH (DNS Tunneling suspected). Domain: %s | Client: %s", domainStr, ipStr),
						Level:   "WARN",
						Time:    time.Now().Format("2006-01-02 15:04:05"),
					})
				}
			}

			// Analytics Scaling Factor based on DNSDist 1% Sampling Rate
			scaleFactor := 1
			if action == "ALLOW" && !isAnomaly {
				scaleFactor = 100
			}

			localQueryTypeMap[typeName] += scaleFactor
			batchCount++

			if ip, ok := entry["ip"].(string); ok {
				if action == "ALLOW" {
					localTopClientsAllow[ip] += scaleFactor
				} else {
					localTopClientsBlock[ip] += 1
				}
			}
			if domain, ok := entry["qname"].(string); ok {
				if action == "ALLOW" {
					localTopAllowedDomains[domain] += scaleFactor
				} else {
					localTopBlockedDomains[domain] += 1
				}
			}

			if batchCount >= 50 {
				flushBatch()
			}
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
		Ping    int    `json:"ping"`
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
			// OS level ping
			var pingMs int = 0
			pingStart := time.Now()
			cmd := exec.Command("ping", "-c", "1", "-W", "1", domain)
			if cmd.Run() == nil {
				pingMs = int(time.Since(pingStart).Milliseconds())
			}

			mu.Lock()
			results = append(results, HealthResult{Domain: domain, Latency: latency, Ping: pingMs, Status: status})
			mu.Unlock()
		}(t.Domain)
	}

	wg.Wait()
	return c.JSON(fiber.Map{"health": results})
}

// Update OTA Logic
type PullRequest struct {
	Branch string `json:"branch"`
}

func CheckSysUpdate(c *fiber.Ctx) error {
	// Di skenario Appliance nyata, kita query branch GitHub
	// Sebagai MVP, kita sediakan dua branch keras: main & dev
	return c.JSON(fiber.Map{
		"current_version": "5.0-Appliance",
		"available_branches": []string{"main", "dev"},
	})
}

func PullSysUpdate(c *fiber.Ctx) error {
	var req PullRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request"})
	}

	if req.Branch == "" {
		req.Branch = "main"
	}

	// Tulis trigger file untuk dieksekusi Watchdog Host (ISO)
	os.WriteFile("/data/do-update", []byte(req.Branch), 0644)
	os.WriteFile("/data/update-status", []byte("Memulai OTA Update ke "+req.Branch+"..."), 0644)

	return c.JSON(fiber.Map{"status": "Update Triggered. Sistem akan memulai ulang dalam beberapa detik."})
}

func GetSysUpdateStatus(c *fiber.Ctx) error {
	data, err := ioutil.ReadFile("/data/update-status")
	if err != nil {
		return c.JSON(fiber.Map{"status": "Standby"})
	}
	return c.JSON(fiber.Map{"status": string(data)})
}

func GetSysUpdateLog(c *fiber.Ctx) error {
	data, err := ioutil.ReadFile("/data/ota_update.log")
	if err != nil {
		return c.JSON(fiber.Map{"log": "Tidak ada riwayat log OTA yang tersedia."})
	}
	return c.JSON(fiber.Map{"log": string(data)})
}

func GetIntelLog(c *fiber.Ctx) error {
	filterType := c.Query("type", "both")
	var grepPattern string
	if filterType == "axfr" {
		grepPattern = "xfr|subsystem=\"rpz\""
	} else if filterType == "rpz" {
		grepPattern = "\\[RPZ Worker\\]|\\[API\\] RPZ"
	} else {
		grepPattern = "xfr|subsystem=\"rpz\"|\\[RPZ Worker\\]|\\[API\\] RPZ"
	}

	cmd := exec.Command("sh", "-c", fmt.Sprintf("grep -iE '%s' /var/log/supervisor/pdns-err.log /var/log/supervisor/supervisord.log 2>/dev/null | tail -n 250", grepPattern))
	out, err := cmd.CombinedOutput()
	if err != nil || len(out) == 0 {
		out = []byte("Menunggu log aktivitas Threat Intelligence...\nLog saat ini kosong atau belum ada kejadian.")
	}
	return c.JSON(fiber.Map{"log": string(out)})
}

func ClearIntelLog(c *fiber.Ctx) error {
	exec.Command("sh", "-c", "truncate -s 0 /var/log/supervisor/pdns-err.log /var/log/supervisor/supervisord.log").Run()
	return c.JSON(fiber.Map{"status": "success", "message": "Logs cleared"})
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
	
	writeCustomRPZ()
	
	select { case forceSync <- true: default: }
	return c.JSON(fiber.Map{"message": "Custom Lists Updates Saved"})
}

func writeCustomRPZ() {
	var bl, wl string
	db.QueryRow("SELECT value FROM settings WHERE key = 'custom_blacklist'").Scan(&bl)
	db.QueryRow("SELECT value FROM settings WHERE key = 'custom_whitelist'").Scan(&wl)

	head := "$TTL 60\n@ IN SOA localhost. root.localhost. 1 60 60 60 60\n@ IN NS localhost.\n\n"
	
	blData := head
	for _, x := range strings.Split(bl, "\n") {
		x = strings.TrimSpace(x)
		if x != "" {
			blData += x + " IN CNAME .\n*." + x + " IN CNAME .\n"
		}
	}
	os.WriteFile("/etc/powerdns/custom_blacklist.zone", []byte(blData), 0644)

	wlData := head
	for _, x := range strings.Split(wl, "\n") {
		x = strings.TrimSpace(x)
		if x != "" {
			wlData += x + " IN CNAME rpz-passthru.\n*." + x + " IN CNAME rpz-passthru.\n"
		}
	}
	os.WriteFile("/etc/powerdns/custom_whitelist.zone", []byte(wlData), 0644)
	
	// Command PowerDNS to reload RPZ silently (without dropping packets)
	exec.Command("rec_control", "reload-zones").Run()
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
		"domain":      domain,
		"blocked":     isBlocked,
		"current_ips": strings.Split(result, "\n"),
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
	ticker := time.NewTicker(2 * time.Second)
	var lastCount float64
	for range ticker.C {
		out, err := exec.Command("dnsdist", "--config", "/etc/powerdns/dnsdist.conf", "-c", "127.0.0.1:5199", "-k", "odCw4adPMwaEYslkALNwp4K7UksD3av9TGpDeSge814=", "-e", "dumpStats()").Output()
		if err == nil {
			lines := strings.Split(string(out), "\n")
			var queries float64
			for _, l := range lines {
				if strings.HasPrefix(l, "queries ") {
					f := strings.Fields(l)
					if len(f) >= 2 {
						queries, _ = strconv.ParseFloat(f[1], 64)
					}
					break
				}
			}

			if lastCount > 0 {
				metricsMutex.Lock()
				liveQPS = (queries - lastCount) / 2.0
				if liveQPS < 0 { liveQPS = 0 }
				metricsMutex.Unlock()
			} else {
				metricsMutex.Lock()
				liveQPS = 0
				metricsMutex.Unlock()
			}
			lastCount = queries
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

// ══════════════════════════════════════════════════════════
// MODUL: Domain Prefetch Engine
// Mengambil ulang domain populer SEBELUM cache-nya kedaluwarsa
// ══════════════════════════════════════════════════════════

func prefetchWorker() {
	time.Sleep(60 * time.Second) // tunggu sistem stabil

	for {
		metricsMutex.RLock()
		// Kumpulkan top 200 domain yang paling sering diakses
		type domCount struct {
			Domain string
			Count  int
		}
		var sorted []domCount
		for dom, count := range topAllowedDomains {
			sorted = append(sorted, domCount{dom, count})
		}
		metricsMutex.RUnlock()

		sort.Slice(sorted, func(i, j int) bool { return sorted[i].Count > sorted[j].Count })

		limit := 200
		if len(sorted) < limit {
			limit = len(sorted)
		}

		// Lakukan prefetch menggunakan dig (memaksa PowerDNS me-refresh cache)
		for i := 0; i < limit; i++ {
			dom := strings.TrimSuffix(sorted[i].Domain, ".")
			if dom == "" { continue }
			exec.Command("dig", "@127.0.0.1", "-p", "5353", dom, "+short", "+time=1", "+tries=1").Run()
		}

		log.Printf("[Prefetch] Warmed %d top domains", limit)
		time.Sleep(120 * time.Second) // prefetch setiap 2 menit
	}
}

// ══════════════════════════════════════════════════════════
// MODUL: Upstream Health Scoring
// Mengukur latensi upstream resolvers dan mendeteksi degradasi
// ══════════════════════════════════════════════════════════

type UpstreamScore struct {
	IP      string  `json:"ip"`
	Latency float64 `json:"latency_ms"`
	Status  string  `json:"status"`
	Score   int     `json:"score"`
}

var (
	upstreamScores     []UpstreamScore
	upstreamScoreMutex sync.RWMutex
)

func upstreamScoringWorker() {
	for {
		var resolvers string
		db.QueryRow("SELECT value FROM settings WHERE key = 'upstream_resolvers'").Scan(&resolvers)

		var scores []UpstreamScore
		for _, ip := range strings.Split(resolvers, ",") {
			ip = strings.TrimSpace(ip)
			if ip == "" { continue }

			start := time.Now()
			cmd := exec.Command("dig", "@"+ip, "google.com", "+short", "+time=2", "+tries=1")
			err := cmd.Run()
			latency := time.Since(start).Seconds() * 1000

			score := 100
			status := "EXCELLENT"
			if err != nil {
				score = 0
				status = "UNREACHABLE"
				latency = 9999
			} else if latency > 100 {
				score = 30
				status = "SLOW"
			} else if latency > 50 {
				score = 60
				status = "FAIR"
			} else if latency > 20 {
				score = 80
				status = "GOOD"
			}

			scores = append(scores, UpstreamScore{
				IP:      ip,
				Latency: math.Round(latency*100) / 100,
				Status:  status,
				Score:   score,
			})
		}

		upstreamScoreMutex.Lock()
		upstreamScores = scores
		upstreamScoreMutex.Unlock()

		// Jika upstream terbaik berubah, reorder di forward_zones.txt
		if len(scores) > 1 {
			sort.Slice(scores, func(i, j int) bool { return scores[i].Score > scores[j].Score })
			var bestIPs []string
			for _, s := range scores {
				if s.Score > 0 { bestIPs = append(bestIPs, s.IP) }
			}
			if len(bestIPs) > 0 {
				var enabled string
				db.QueryRow("SELECT value FROM settings WHERE key = 'upstream_forwarding_enabled'").Scan(&enabled)
				if enabled == "true" {
					db.Exec("UPDATE settings SET value = ? WHERE key = 'upstream_resolvers'", strings.Join(bestIPs, ","))
					generateForwardersConfig()
					exec.Command("rec_control", "reload-zones").Run()
					log.Printf("[UpstreamScore] Reordered: %v", bestIPs)
				}
			}
		}

		time.Sleep(60 * time.Second) // scoring setiap 1 menit
	}
}

// ══════════════════════════════════════════════════════════
// API: Top Domains (untuk dasar optimasi & prefetch monitoring)
// ══════════════════════════════════════════════════════════

func GetTopDomains(c *fiber.Ctx) error {
	metricsMutex.RLock()
	defer metricsMutex.RUnlock()

	type DomEntry struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
	}

	var allowed, blocked []DomEntry
	for dom, count := range topAllowedDomains {
		allowed = append(allowed, DomEntry{dom, count})
	}
	for dom, count := range topBlockedDomains {
		blocked = append(blocked, DomEntry{dom, count})
	}

	sort.Slice(allowed, func(i, j int) bool { return allowed[i].Count > allowed[j].Count })
	sort.Slice(blocked, func(i, j int) bool { return blocked[i].Count > blocked[j].Count })

	if len(allowed) > 50 { allowed = allowed[:50] }
	if len(blocked) > 50 { blocked = blocked[:50] }

	return c.JSON(fiber.Map{
		"top_allowed": allowed,
		"top_blocked": blocked,
		"prefetch_pool_size": len(topAllowedDomains),
	})
}

// API: Upstream Health Scores
func GetUpstreamHealth(c *fiber.Ctx) error {
	upstreamScoreMutex.RLock()
	defer upstreamScoreMutex.RUnlock()
	return c.JSON(fiber.Map{"scores": upstreamScores})
}
