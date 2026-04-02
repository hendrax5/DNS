#!/bin/bash
# NetShield V5.0 Auto-Deploy & Optimization Script
# Usage: ./deploy.sh
# Termasuk: Auto-Tuning Hardware, Kernel Sysctl, NUMA, dan Docker Build.

set -e

echo "════════════════════════════════════════════════════════════"
echo " 🚀 NetShield DNS V5.0 - Carrier-Grade Deployment Script"
echo "════════════════════════════════════════════════════════════"
echo ""

# 1. Cek apakah di dalam direktori Git
if [ ! -d ".git" ] && [ ! -d "../.git" ]; then
    echo "[!] Kesalahan: Skrip ini harus dijalankan di dalam folder repository Github."
    exit 1
fi

echo "[1/6] Mencadangkan Database Production ..."
if [ -f "data/netshield.db" ]; then
    cp data/netshield.db /tmp/netshield.db.bak
    echo "  -> Database aman dicadangkan ke /tmp/netshield.db.bak"
else
    echo "  -> Database belum ada (instalasi baru), dilewati."
fi

# 2. Sinkronisasi dengan Github
echo "[2/6] Menyelaraskan Kode dari GitHub ..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch --all
git reset --hard origin/$CURRENT_BRANCH
git clean -fd --exclude="data/" --exclude=".env"

# 3. Kembalikan Database
echo "[3/6] Mengembalikan Database Production ..."
if [ -f "/tmp/netshield.db.bak" ]; then
    mkdir -p data
    cp /tmp/netshield.db.bak data/netshield.db
    echo "  -> Database berhasil dikembalikan."
fi

# 4. Auto-Tuning Hardware
echo "[4/6] Menganalisa Hardware untuk Auto-Tuning ..."
CORES=$(nproc 2>/dev/null || echo 4)
RAM_MB=$(free -m | awk '/^Mem:/{print $2}' 2>/dev/null || echo 4096)

if [ "$RAM_MB" -gt 30000 ]; then CACHE_ENTRIES=10000000
elif [ "$RAM_MB" -gt 15000 ]; then CACHE_ENTRIES=5000000
elif [ "$RAM_MB" -gt 7000 ]; then CACHE_ENTRIES=2500000
elif [ "$RAM_MB" -gt 3000 ]; then CACHE_ENTRIES=1000000
else CACHE_ENTRIES=500000
fi

PDNS_THREADS=$(( CORES * 4 ))
if [ "$PDNS_THREADS" -lt 16 ]; then
    PDNS_THREADS=16
fi

echo "  -> Hardware: $CORES CPU Cores | ${RAM_MB}MB RAM"
echo "  -> DNS Config: threads=$PDNS_THREADS, cache=$CACHE_ENTRIES"

sed -i "s/^threads=.*/threads=${PDNS_THREADS}/" pdns_config/recursor.conf
sed -i "s/^max-cache-entries=.*/max-cache-entries=${CACHE_ENTRIES}/" pdns_config/recursor.conf
sed -i "s/^max-packetcache-entries=.*/max-packetcache-entries=${CACHE_ENTRIES}/" pdns_config/recursor.conf

# 5. Kernel Sysctl Tuning (Baremetal Only)
echo "[5/6] Menerapkan Kernel Network Tuning ..."
if [ -w /proc/sys/net/core/rmem_max ]; then
    # UDP Buffer Enlargement (16MB)
    sysctl -w net.core.rmem_max=16777216 2>/dev/null || true
    sysctl -w net.core.rmem_default=8388608 2>/dev/null || true
    sysctl -w net.core.wmem_max=16777216 2>/dev/null || true
    sysctl -w net.core.wmem_default=8388608 2>/dev/null || true
    
    # Network Backlog
    sysctl -w net.core.netdev_max_backlog=65536 2>/dev/null || true
    sysctl -w net.core.somaxconn=65536 2>/dev/null || true
    
    # Busy Polling (Eliminasi interrupt latency ~2-5μs per paket)
    sysctl -w net.core.busy_read=50 2>/dev/null || true
    sysctl -w net.core.busy_poll=50 2>/dev/null || true
    
    echo "  -> Kernel sysctl: UDP buffers=16MB, backlog=65k, busy_poll=ON"
    
    # NUMA Detection
    if command -v numactl &> /dev/null; then
        NUMA_NODES=$(numactl --hardware 2>/dev/null | grep "available:" | awk '{print $2}')
        if [ "$NUMA_NODES" -gt 1 ] 2>/dev/null; then
            echo "  -> ⚠️  NUMA: $NUMA_NODES nodes terdeteksi. Pertimbangkan:"
            echo "     numactl --cpunodebind=0 --membind=0 untuk pin proses DNS"
        else
            echo "  -> NUMA: Single node (optimal)"
        fi
    fi
else
    echo "  -> Dilewati (tidak ada akses root / dalam Docker)"
fi

# 6. Docker Build & Launch
echo "[6/6] Membangun ulang dan menyalakan NetShield ..."
if command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
else
    DOCKER_CMD="docker compose"
fi

$DOCKER_CMD down 2>/dev/null || true
$DOCKER_CMD up -d --build netshield-dns

echo ""
echo "════════════════════════════════════════════════════════════"
echo " ✅ NetShield DNS V5.0 — Deployment Berhasil!"
echo " 🌐 Dashboard: http://<server-ip>"
echo " 📊 DNS:       Port 53 (UDP/TCP)"
echo " 🔒 DoT:       Port 853 (Aktifkan di dnsdist.conf + TLS)"
echo " 🔒 DoH:       Port 443 (Aktifkan di dnsdist.conf + TLS)"
echo "════════════════════════════════════════════════════════════"
