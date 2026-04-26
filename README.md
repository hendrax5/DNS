# NetShield DNS V6.0 — Carrier-Grade Edition 🛡️🚀

![Version](https://img.shields.io/badge/Version-V6.0_Pass--Through-blue)
![Throughput](https://img.shields.io/badge/Throughput-150k+_QPS-success)
![Architecture](https://img.shields.io/badge/Stack-DNSDist_%7C_Unbound_%7C_PowerDNS_%7C_Go-orange)
![Deployment](https://img.shields.io/badge/Deploy-ISO_Appliance_%7C_Docker-purple)
![Zero_Allocation](https://img.shields.io/badge/Bloom_Filter-Zero_Copy_mmap-red)

NetShield DNS V6.0 adalah platform resolusi dan penyaringan DNS berskala operator telekomunikasi (*Carrier-Grade*). Edisi "Pass-Through Architecture" ini didesain khusus untuk ISP berskala masif dengan mengimplementasikan lompatan performa: **Edge Bloom Filter berbasis `mmap` C-FFI**. 

Dengan arsitektur ini, >95% pencarian domain bersih akan *membelah seketika* memintas mesin RPZ dan diteruskan langsung menuju *Resolver Murni* berkinerja tinggi, menghasilkan latensi hampir 0ms tanpa ada jejak CPU overhead.

---

## 🏛️ Arsitektur Pass-Through Baru (V6.0)

```
                            ┌──────────────────────────────────────────────┐
                            │          LAYER 1: DNSDist (Port 53)          │
          Klien ──UDP──►    │  • 16-Core SO_REUSEPORT Listener             │
                            │  • RRL Anti-DDoS (1000 QPS/IP)               │
                            │  • FFI Bloom Filter Router (32MB Mmap)       │
                            └───────┬──────────────────────────────┬───────┘
                                    │                              │
[Domain Bersih / Aman (95%)]        │                              │ [Domain Mencurigakan / Terblokir]
   Tembus Bloom Filter (Bypass)     │                              │ Positif di Mmap Bloom
                                    ▼                              ▼
                 ┌──────────────────────────────────┐      ┌──────────────────────────────┐
                 │    LAYER 2A: Unbound Resolver    │      │LAYER 2B: PowerDNS Recursor   │
                 │      (Pure Fast Resolution)      │      │       (RPZ Engine)           │
                 │                                  │      │                              │
                 │  • Dedicated 16-Threads          │      │  • 17 Juta Entry Komdigi     │
                 │  • 1GB RRSet Cache               │      │  • Custom BL / WL            │
                 │  • Serve-Expired (Stale)         │      │  • Zero-Load (Tidur bila URL │
                 │  • Prefetch Optimization         │      │    bersih)                   │
                 └──────────────────────────────────┘      └──────────────────────────────┘
```

---

## 🔥 Fitur Unggulan V6.0

### ⚡ Pass-Through Bloom Filter Engine (The Game Changer)
- **Zero-Copy Memory Map (mmap):** Pengecekan blokir 17 juta domain Komdigi divisualisasikan dalam struktur Bit-Array 32MB di dalam kernel memori. DNSDist (LuaJIT FFI) melakukan tes 9 bit (k=9) secepat kilat.
- **Graceful Pure-Lua Fallback:** Bila sistem atau struktur OS gagal menjalankan eksekusi modul C-bindings, sistem secara siluman mundur ke algoritma pemrosesan string Murni Lua 5.4 untuk memastikan operasi DNS tanpa pantang surut.
- **Offload Backend Otomatis:** PowerDNS tak akan pernah mengeksekusi trafik Google, Facebook, atau perbankan. Semuanya direkues secara murni dan secepat kilat oleh Unbound.

### 🛡️ Keamanan & Integrasi Komdigi (Appliance ISO)
- **17 Juta Domain** Trust-Positif Komdigi *up-to-date* + Custom Lists.
- **GoBGP Route Reflector (RTBH):** Integrasi Border Gateway Protocol langsung ke jaringan ISP (Mikrotik/Juniper) memblokir anomali IP.
- **Auto ISO-Builder & TUI Wizard:** NetShield kini dapat dirakit dan dicetak sepenuhnya secara otomatis menjadi format **Installer ISO Bootable** mandiri (*Appliance* siap pakai).
- **Over-The-Air (OTA) Updates Dynamic:** Terdapat mekanisme penarik kode otomatis lewat *Dashboard* yang transparan—memetakan repositori aktif (*Current Tracking Branch*) langsung ke *syslog* internal tanpa campur tangan terminal lagi!

### ⚙️ Hardware Tuning
- Otomatisasi **THP (Transparent HugePages)** level Kernel dipasok secara instan setiap deployment.
- Pemisahan isolatif soket proses (`dnsdist -> unbound` port `5354`, `dnsdist -> pdns` port `5353`).
- **XDP/eBPF Packet Acceleration** yang mendongkrak dropping paket DoS langsung di batas NIC sebelum menjamah lapisan NetFilter Docker.

---

## 🛠️ Modul Instalasi (Cara Peluncuran)

### Opsi A: Deployment Server Tunggal
Untuk memancarkan pembaruan terkini dan menata kontainer dari kode aslinya:
```bash
git clone https://github.com/hendrax5/DNS.git
cd DNS
sudo bash deploy.sh
```

### Opsi B: Membangun Distro / Appliance Bootable Sendiri (.ISO)
Dilengkapi installer antarmuka terminal interaktif *ncurses/TUI Wizard*:
```bash
cd DNS/iso-builder
sudo bash build-iso.sh
```
File *.iso* instalasi yang memuat OS + NetShield Offline siap ditanam di rak *Baremetal/VMware*.

---

## 🗂️ Direktori & Fungsi Utama

- `deploy.sh` : Eksekutor pembaruan, inisiasi Docker, sysctl tuning.
- `go-api/` : RestAPI Pusat Kendali (Bloom Sync RCU Swap, BGP API, Authentication).
- `pdns_config/main.lua` : Otak cerdas pengarah FFI Bloom Filter dan Load-balancer traffic bersih/kotor.
- `pdns_config/unbound.conf` : Resolver kencang terkalibrasi khusus menelan *cache* masif.
- `iso-builder/tui-wizard.sh` : Skrip pra-instalasi CLI *user-friendly* dalam pembuatan `.iso`.
- `frontend/` : Dasbor React GUI Administratif.

---

## 💡 Panduan Troubleshooting

1. **Bug RCU Hot-Swap Gagal Mmap?**
   Pembaruan daftar hitam ditarik namun DNS seolah mati/stuck memulihkan konfigurasi? Ini telah teratasi di **V6.0 OTA Script**: perintah `-e reload_bloom()` diarahkan mulus tanpa down-time. Jika Anda menduga file rusak, cek eksistensi *file mmap* terisolasi: `ls -lh data/bloom.bin`.
2. **Update OTA Kembali ke Awal (Mentok Main Branch)?**
   Hal ini sudah difaktorkan. Selalu pastikan Anda memeriksa hasil audit skenario pada *log build*: `tail -f data/ota_update.log` setiap mengeksekusi Pembaruan Sistem via Dasbor atau OTA.
3. **Mengarahkan Trafik (Force Forwarding)**
   Bagi Mikrotik:
   `add action=dst-nat chain=dstnat dst-port=53 protocol=udp to-addresses=<IP_NETSHIELD> to-ports=53`
4. **Memeriksa Isi Direktori dan File Pemblokiran di Docker**
   Jika ingin memastikan daftar hitam, whitelist, atau RPZ feed benar-benar telah dimasukkan ke dalam mesin DNS, Anda dapat masuk ke dalam container shell:
   ```bash
   # Masuk ke environment shell alpine
   docker exec -it netshield-v2 sh
   
   # Berpindah ke folder utama
   cd /etc/powerdns
   
   # Memeriksa eksistensi hasil kompilasi
   ls -la
   
   # Mencari domain spesifik di dalam antrean pemblokiran
   grep "pornhub.com" rpz_compiled.zone
   ```

---
*NetShield V6.0 — Mengawal Privasi Tanpa Mengorbankan Latensi Mutlak.* 🦅
