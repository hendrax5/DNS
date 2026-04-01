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

# 4. Melakukan Build Ulang Container Docker
echo "[4/4] Membangun ulang dan menyalakan Node NetShield ..."
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
