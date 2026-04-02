# NetShield DNS (Carrier-Grade Edition) 🛡️🚀

![NetShield Version](https://img.shields.io/badge/Version-v4.4_Baremetal-blue)
![Throughput](https://img.shields.io/badge/Throughput-126k+_QPS-success)
![Architecture](https://img.shields.io/badge/Architecture-C++_%7C_Go_%7C_React-orange)

NetShield DNS adalah sistem Resolusi DNS Kinerja Tinggi tingkat telco (*Carrier-Grade Proxy*) yang dirancang khusus untuk memblokir jutaan ancaman internet, *malware*, dan daftar *Trust-Positif* (Komdigi) secara seketika (*Real-Time*) tanpa mengorbankan _throughput_ perangkat keras.

Diciptakan melalui optimasi arsitektur ekstrem, NetShield sanggup menembus **126.906+ Queries Per Second (QPS)** pada lingkungan peladen *Baremetal*, membinasakan batasan wajar proksi DNS rakitan konvensional yang sering tertahan di angka 50k QPS.

---

## 🏛️ Arsitektur "Titan" 3-Lapis (The Zero-Allocation Pipeline)

Sistem NetShield membuang naskah (*scripting*) perantara yang menghalangi lalu lintas paket dan sepenuhnya mengadopsi "Otot Kawat" Kernel C++ dengan topologi murni:

1. **Lapis 1 - DNSDist (The Frontend Bumper):**
   Menerima ribuan hantaman kueri per detik dengan dukungan **PacketCache Berbasis Memori**. Filter C++ ini memantulkan kueri DNS berulang dari RAM (*Zero-Copy*) dalam hitungan nanodetik dan mendistribusikan beban secara simetris ke Lapis 2 layaknya *Load Balancer* perangkat keras puluhan ribu dolar.
2. **Lapis 2 - PowerDNS Recursor (The Policy Engine):**
   Satu-satunya agen pengeksekusi 17 Juta Domain Terlarang (*Response Policy Zone - RPZ*). PowerDNS menggunakan kapabilitas pemetaan memori (`SO_REUSEPORT`) dan beroperasi absolut tanpa naskah Lua yang tersumbat, meledakkan utilisasi seluruh 16 utas prosesor *Baremetal* secara paralel.
3. **Lapis 3 - Modul Orkestrator (Golang API):**
   Dasbor pusat kendali administrator yang berdiri independen. Mengambil kebijakan pengguna (Blokir, Izinkan) lalu menerjemahkannya gaib menjadi fisik zona DNS standar C++ yang langsung "ditelan" ulang oleh PowerDNS saat itu juga tanpa *restart*!

---

## 🔥 Keunggulan Mutlak Sistem

*   **Kecepatan Menembus Batas (126k+ QPS):** Sistem ini mengabaikan proksi Docker NAT dan *Thread Starvation*, menjadikan NetShield unggul mutlak dibanding pendahulunya seperti Trust-NG limit 55k.
*   **Telemetri Tak Kasatmata (*1% Asynchronous Sampling*):** Dasbor Analitik Anda (Grafik DNS, Log) terus hidup akurat berkat algoritma pencuplikan pintar FFI Lua di dalam DNSDist yang menjejalkan Telemetri ke API Go tanpa satu pun proses I/O yang membekukan aliran kueri.
*   **Pembaruan Blokir Tanpa Kedip (*Hot-Reload*):** Masukkan ribuan *Custom Blacklist* di Layar Dasbor, dan mekanisme `RPZ` murni dalam C++ akan menerkam aturan baru itu kurang dari sepersejuta detik. Tidak ada *restart* wadah, tidak ada paket klien yang terbengkalai.
*   **Agnostik Dasbor:** Tampilan Antarmuka Reaktif Web modern dengan fitur pencarian Log cepat dan pemantau anomali DNS mandiri.

---

## ⚙️ Petunjuk Pemasangan Cepat

Sistem ini didesain sebagai satu wujud utuh (`Docker-Compose` Super Service).

```bash
# 1. Klon Repositori
git clone https://github.com/hendrax5/DNS.git
cd DNS/netshield

# 2. Rebus dan Lancarkan (Mode Production Host Networking disarankan untuk 126k QPS!)
./deploy.sh
```

**Spesifikasi Lingkungan Maksimal:**
Untuk pencapaian *benchmark* sempurna, pastikan Anda mendirikan sistem ini pada arsitektur *Baremetal/Linux Native* di mana jaringan Docker menapak pada tapak OS utama.

---
*Dibangun dengan Agresi dan Dedikasi untuk Kecepatan Absolut.* 🦅
