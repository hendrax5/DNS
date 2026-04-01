#!/bin/bash
# NetShield Auto-Deploy & Update Script
# Usage: ./deploy.sh
# Memastikan deployment awal dan pembaruan berjalan mulus tanpa konflik Git.

set -e

echo "========================================================"
echo " 🚀 NetShield DNS - Auto Deployment & Update Script"
echo "========================================================"
echo ""

# 1. Cek apakah di dalam direktori Git
if [ ! -d ".git" ] && [ ! -d "../.git" ]; then
    echo "[!] Kesalahan: Skrip ini harus dijalankan di dalam dari folder repository Github."
    exit 1
fi

echo "[1/4] Mencadangkan Konfigurasi Database Production ..."
if [ -f "data/netshield.db" ]; then
    cp data/netshield.db /tmp/netshield.db.bak
    echo "  -> Database aman dicadangkan ke /tmp/netshield.db.bak"
else
    echo "  -> Database belum ada (kemungkinan instalasi baru), dilewati."
fi

# 2. Sinkronisasi dengan Github (Tanpa Konflik)
echo "[2/4] Menyelaraskan Kode dari GitHub (Force Update) ..."
git fetch --all
git reset --hard origin/main

# Membuang file untracked yang tidak perlu agar bersih (Kecuali folder data dan environment)
git clean -fd --exclude="data/" --exclude=".env"

# 3. Kembalikan Database yang dicadangkan
echo "[3/4] Mengembalikan Konfigurasi Database Production ..."
if [ -f "/tmp/netshield.db.bak" ]; then
    mkdir -p data
    cp /tmp/netshield.db.bak data/netshield.db
    echo "  -> Database berhasil dikembalikan."
fi

# 4. Tuning Otomatis Sesuai Spesifikasi Server
echo "[4/5] Menganalisa Spesifikasi Hardware untuk Auto-Tuning..."
CORES=$(nproc 2>/dev/null || echo 2)
RAM_MB=$(free -m | awk '/^Mem:/{print $2}' 2>/dev/null || echo 4096)

if [ "$RAM_MB" -gt 30000 ]; then CACHE_ENTRIES=10000000
elif [ "$RAM_MB" -gt 15000 ]; then CACHE_ENTRIES=5000000
elif [ "$RAM_MB" -gt 7000 ]; then CACHE_ENTRIES=2500000
elif [ "$RAM_MB" -gt 3000 ]; then CACHE_ENTRIES=1000000
else CACHE_ENTRIES=500000
fi

# Multiplier: PowerDNS limits concurrent UDP socket wait-states per thread.
# Best practice is 4x to 8x the physical core count for Recursor UDP.
PDNS_THREADS=$(( CORES * 4 ))
if [ "$PDNS_THREADS" -lt 16 ]; then
    PDNS_THREADS=16  # Minimum 16 threads for high QoS burst handling
fi

echo "  -> Hardware: $CORES CPU Cores | ${RAM_MB}MB RAM"
echo "  -> DNS Config: threads=$PDNS_THREADS, cache_entries=$CACHE_ENTRIES"

sed -i "s/^threads=.*/threads=${PDNS_THREADS}/" pdns_config/recursor.conf
sed -i "s/^max-cache-entries=.*/max-cache-entries=${CACHE_ENTRIES}/" pdns_config/recursor.conf
sed -i "s/^max-packetcache-entries=.*/max-packetcache-entries=${CACHE_ENTRIES}/" pdns_config/recursor.conf

# 5. Melakukan Build Ulang Container Docker
echo "[5/5] Membangun ulang dan menyalakan Node NetShield..."
if command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
else
    DOCKER_CMD="docker compose"
fi

$DOCKER_CMD down
$DOCKER_CMD up -d --build netshield-dns

echo ""
echo "========================================================"
echo " ✅ Selesai! NetShield DNS berhasil diperbarui & berjalan."
echo " 🌐 Akses Dashboard Administrator Anda di port 80."
echo "========================================================"
