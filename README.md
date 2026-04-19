# NetShield DNS V5.0 — Carrier-Grade Edition 🛡️🚀

![Version](https://img.shields.io/badge/Version-V5.0_Carrier--Grade-blue)
![Throughput](https://img.shields.io/badge/Throughput-126k+_QPS-success)
![Architecture](https://img.shields.io/badge/Stack-DNSDist_%7C_PowerDNS_%7C_Go_%7C_React-orange)
![DoH](https://img.shields.io/badge/DoH%2FDoT-Ready-green)
![DDoS](https://img.shields.io/badge/DDoS_Protection-Active-red)

NetShield DNS adalah platform resolusi dan penyaringan DNS berskala operator telekomunikasi (*Carrier-Grade*) yang mampu menembus **126.906+ QPS** pada lingkungan *Baremetal*. Dirancang untuk memblokir jutaan ancaman internet, *malware*, dan daftar *Trust-Positif* Komdigi secara seketika tanpa mengorbankan kecepatan.

---

## 🏛️ Arsitektur 3-Lapis (Zero-Allocation Pipeline)

```
                    ┌─────────────────────────────────────────┐
                    │         LAYER 1: DNSDist (Port 53)      │
  Klien ──UDP──►    │  • PacketCache 10M entries (RAM)        │
                    │  • RRL DDoS Protection (1000 QPS/IP)    │
                    │  • Telemetry Sampling 1% (Async Lua)    │
                    │  • DoH/DoT Ready (Port 443/853)         │
                    └──────────────┬──────────────────────────┘
                                   │ 16 sockets (SO_REUSEPORT)
                    ┌──────────────▼──────────────────────────┐
                    │       LAYER 2: PowerDNS (Port 5353)     │
                    │  • RPZ Engine: 17 Juta Domain Komdigi   │
                    │  • Custom Blacklist/Whitelist (Hot-RPZ)  │
                    │  • Cache 10M + Stale Serving 5 menit    │
                    │  • Dynamic Upstream Forwarding           │
                    └──────────────┬──────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────────┐
                    │    LAYER 3: Internet / Upstream DNS      │
                    │  • Full Recursion (Default)              │
                    │  • Forwarding Mode: 1.1.1.1/8.8.8.8     │
                    │    (Dapat diaktifkan dari Panel Admin)   │
                    └─────────────────────────────────────────┘
```

---

## 🔥 Fitur Unggulan

### ⚡ Performa Ekstrem
- **126.906+ QPS** pada Baremetal (16 core, benchmark `dnsperf`)
- **10 Juta entri** PacketCache di DNSDist + PowerDNS
- **Stale Serving** 5 menit — cache tidak pernah kedaluwarsa mendadak
- **Kernel Tuning** otomatis: UDP buffer 16MB, busy polling, backlog 65k

### 🔒 Keamanan & Penyaringan
- **17 Juta Domain** Trust-Positif Komdigi (RPZ Engine C++)
- **GoBGP Route Reflector (RTBH)** — Dukungan *Dynamic Multi-Peers*, eBGP *Multihop*, Injeksi MD5, dan pembelokan logis *Next-Hop-Self* iBGP ke Server Laman Labuh tanpa _Null Route_.
- **Custom Blacklist/Whitelist** dengan Hot-Reload tanpa restart
- **Anti-DDoS RRL**: Throttle 1000 QPS/IP, blokir query ANY
- **SafeSearch** enforcement untuk Google, Bing, DuckDuckGo
- **DoH/DoT Ready** (DNS-over-HTTPS/TLS — tinggal pasang sertifikat)

### 📊 Monitoring & Telemetri
- **Dashboard Web** real-time dengan analitik (Go + React)
- **1% Async Sampling** — telemetri tanpa mengorbankan QPS
- **Anomaly Detection** (DNS Tunneling, Amplification Attack alerts)
- **Prometheus-Ready** endpoint `/metrics` (sambungkan ke Grafana)

### 🛠️ Operasional
- **Dynamic Upstream Forwarding** — aktifkan/nonaktifkan dari panel admin
- **Auto-Tuning** deploy script (deteksi CPU, RAM, NUMA otomatis)
- **Docker Host Networking** — eliminasi NAT overhead
- **Hot-Reload** konfigurasi tanpa downtime

---

## ⚙️ Instalasi Cepat

```bash
# Klon repositori
git clone https://github.com/hendrax5/DNS.git
cd DNS/netshield

# Deploy (termasuk auto-tuning hardware otomatis)
chmod +x deploy.sh
./deploy.sh
```

### Mengaktifkan DoH/DoT
```bash
# 1. Letakkan sertifikat TLS di dalam container
mkdir -p data/tls
cp /path/to/cert.pem data/tls/
cp /path/to/key.pem data/tls/

# 2. Uncomment baris DoH/DoT di pdns_config/dnsdist.conf
# 3. Rebuild: ./deploy.sh
```

### Mengaktifkan Upstream Forwarding
Buka **Dashboard → Settings → Upstream** → Aktifkan dan pilih resolver upstream (Cloudflare, Google, Quad9).

---

## 📈 Hasil Benchmark

| Metrik | Hasil |
|--------|-------|
| Queries Per Second | **126.906 QPS** |
| Packet Loss | **0.00%** |
| Average Latency | **0.771 ms** |
| Max Latency | **2.074 ms** |
| Latency StdDev | **2.443 ms** |
| CPU Cores | 16 |
| RAM | 12 GB |

```bash
# Reproduksi benchmark:
dnsperf -s <server-ip> -d query.txt -l 100
```

---

## 🗂️ Struktur Proyek

```
netshield/
├── go-api/             # Backend API (Golang + Fiber)
├── frontend/           # Dashboard UI (React + Vite)
├── pdns_config/        # Konfigurasi DNSDist + PowerDNS
│   ├── dnsdist.conf    # Frontend proxy (caching, RRL, DoH/DoT)
│   ├── recursor.conf   # PowerDNS tuning
│   └── laman_labuh.lua # RPZ policy loader
├── Dockerfile          # Multi-stage build
├── docker-compose.yml  # Host networking + sysctl
├── deploy.sh           # Auto-deploy + hardware tuning
└── data/               # Persistent database (SQLite)
```

---

## 💡 Panduan Troubleshooting

Jika Anda menemui kendala dalam penerapan di lapangan, silakan periksa hal-hal berikut:

### 1. RPZ / Pemblokir Aktif Namun Trafik *Membobol* (Tidak Terblokir)
- **Cek Jeda Waktu Sinkronisasi & *Cache* DNSDist**: 
  Setelah kontainer dinyalakan atau ditekan tombol *Sync*, sistem membutuhkan jeda ±15-20 detik untuk mengunduh dan menelan 1-7 Juta baris RPZ ke dalam memori. Jika Anda melakukan *query* di sela waktu tersebut, domain kotor akan lolos dan sayangnya akan **diingat oleh *PacketCache* DNSDist**. 
  - *Solusi:* Tunggu 20 detik pasca-deploy, dan jika Anda telanjur mengetes, silakan *flush dns* OS Anda.
- **Cek Status Domain Asli Kominfo**: 
  Seringkali pengguna mengetes `x.com` atau domain lama pembajakan yang ternyata **sudah dianggap legal dan dicabut** dari *blacklist* TrustPositif Kominfo. 
  - *Cara Validasi:* Jalankan `curl -s https://trustpositif.komdigi.go.id/assets/db/domains_isp | grep -E '^domainanda\.com$'`. Jika kosong, berarti situs tersebut memang tak diblokir. Gunakan domain pasti seperti `reddit.com` atau `vimeo.com` untuk uji coba lapangan.

### 2. TProxy Aktif Namun *Docker Build* Gagal (*Connection Refused*)
Jika Anda mengaktifkan TProxy (Transparent DNS) lewat `iptables -j REDIRECT`, semua laju kelonggaran *port 53* OS (*host*) akan langsung dibegal paksa ke dalam pelabuhan NetShield. Jika pada titik ini Anda melakukan `docker build`, wadah Docker tak akan mandapatkan akses resolusi DNS internasional dan *compiler* terhenti.
- *Solusi:* Skrip `deploy.sh` saat ini telah menyertakan pembilasan sirkuit NAT otomatis sebelum `build` dan dikerjakan melalui asuhan perantara `docker run` asli (*native*) merobohkan masalah fatal di OS Ubuntu modern. Selalu pastikan Anda menjalankan skrip rilis terbaru.

### 3. "KeyError: ContainerConfig" saat instalasi dengan docker-compose
- *Penyebab:* Cacat internal pada pustaka *Python docker-compose* versi lawas jika dihadapkan pada Docker Daemon Engine keluaran terbaru.
- *Solusi:* NetShield V5.0 telah membebaskan diri dari kukungan rantai *docker-compose* dan kini ditenagai secara absolut dan murni memanfaatkan `docker run` lewat *Deployer bash otomatis* yang terbukti tangguh segala platform.

### 4. Sesi BGP Mentok di State `Idle`/`Connecting` (Lencana Kuning di Panel)
Jika warna Lencana indikator *Peer* pada kontrol sentral Anda tak kunjung memancarkan warna hijau `Up` berjam-jam:
- **Pengecekan Pertama (Multihop Parameter):** Cek jarak *hop* *router* asal Komdigi. Jika statusnya adalah tipe *eBGP* dan melewati lebih dari satu sekat interkoneksi, parameter **EBGP Multihop Limit** mutlak hukumnya **wajib diisi dengan nilai > 0** (misal 2 atau 4) dari Dasbor, tanpa itu ia tak akan diperkenankan menyentuh *Neighbor*.
- **Pengecekan Kedua (L4 Stateful Firewall):** Verifikasi bahwa mesin *NetShield* secara mandiri mengizinkan pendaratan atau terbangnya trafik paket `TCP Port 179`. Jangan sampai ia terjebak pada rantai *Drop* bawaan sistem seperti UFW pada host.
- **Pengecekan Ketiga (MD5 Authentication Key):** Tanyakan kembail perihal mandat kunci sekuritas *(MD5 Secret)* ke tim pusat. Banyak insiden otentikasi luruh meradang semata disebabkan **typo minor** spasi ekstra (*trailing space*) pada enkripsi MD5.

---

*Dibangun dengan presisi untuk kecepatan dan keamanan absolut.* 🦅
