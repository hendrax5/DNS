#!/bin/bash
# NetShield V5.0 — Unified Deployment Script
# Semua dalam satu script: Git sync, hardware tuning, Docker build, XDP setup.
# Usage: ./deploy.sh

set -e

echo "════════════════════════════════════════════════════════════"
echo " 🚀 NetShield DNS V5.0 — Carrier-Grade Deployment"
echo "════════════════════════════════════════════════════════════"
echo ""

# ──────────────────────────────────────────────────────────
# STEP 1: Validasi Git Repository
# ──────────────────────────────────────────────────────────
if [ ! -d ".git" ] && [ ! -d "../.git" ]; then
    echo "[!] ERROR: Jalankan di dalam folder repository."
    exit 1
fi

# ──────────────────────────────────────────────────────────
# STEP 2: Cadangkan Database
# ──────────────────────────────────────────────────────────
echo "[1/7] Mencadangkan Database ..."
if [ -f "data/netshield.db" ]; then
    cp data/netshield.db /tmp/netshield.db.bak
    echo "  -> Dicadangkan ke /tmp/netshield.db.bak"
else
    echo "  -> Database belum ada (instalasi baru)"
fi

# ──────────────────────────────────────────────────────────
# STEP 3: Sinkronisasi Git
# ──────────────────────────────────────────────────────────
echo "[2/7] Menyelaraskan dari GitHub ..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch --all
git reset --hard origin/$CURRENT_BRANCH
git clean -fd --exclude="data/" --exclude=".env"

# ──────────────────────────────────────────────────────────
# STEP 4: Kembalikan Database
# ──────────────────────────────────────────────────────────
echo "[3/7] Mengembalikan Database ..."
if [ -f "/tmp/netshield.db.bak" ]; then
    mkdir -p data
    cp /tmp/netshield.db.bak data/netshield.db
    echo "  -> Database dikembalikan"
fi

# ──────────────────────────────────────────────────────────
# STEP 5: Auto-Tuning Hardware
# ──────────────────────────────────────────────────────────
echo "[4/7] Auto-Tuning Hardware ..."
CORES=$(nproc 2>/dev/null || echo 4)
RAM_MB=$(free -m | awk '/^Mem:/{print $2}' 2>/dev/null || echo 4096)

if [ "$RAM_MB" -gt 30000 ]; then CACHE_ENTRIES=10000000
elif [ "$RAM_MB" -gt 15000 ]; then CACHE_ENTRIES=5000000
elif [ "$RAM_MB" -gt 7000 ]; then CACHE_ENTRIES=2500000
elif [ "$RAM_MB" -gt 3000 ]; then CACHE_ENTRIES=1000000
else CACHE_ENTRIES=500000
fi

PDNS_THREADS=$(( CORES * 4 ))
if [ "$PDNS_THREADS" -lt 16 ]; then PDNS_THREADS=16; fi

echo "  -> Hardware: $CORES Cores | ${RAM_MB}MB RAM"
echo "  -> Config:   threads=$PDNS_THREADS, cache=$CACHE_ENTRIES"

sed -i "s/^threads=.*/threads=${PDNS_THREADS}/" pdns_config/recursor.conf
sed -i "s/^max-cache-entries=.*/max-cache-entries=${CACHE_ENTRIES}/" pdns_config/recursor.conf
sed -i "s/^max-packetcache-entries=.*/max-packetcache-entries=${CACHE_ENTRIES}/" pdns_config/recursor.conf

# ──────────────────────────────────────────────────────────
# STEP 6: Kernel Sysctl Tuning
# ──────────────────────────────────────────────────────────
echo "[5/7] Kernel Network Tuning ..."
if [ -w /proc/sys/net/core/rmem_max ]; then
    sysctl -w net.core.rmem_max=16777216 2>/dev/null || true
    sysctl -w net.core.rmem_default=8388608 2>/dev/null || true
    sysctl -w net.core.wmem_max=16777216 2>/dev/null || true
    sysctl -w net.core.wmem_default=8388608 2>/dev/null || true
    sysctl -w net.core.netdev_max_backlog=65536 2>/dev/null || true
    sysctl -w net.core.somaxconn=65536 2>/dev/null || true
    sysctl -w net.core.busy_read=50 2>/dev/null || true
    sysctl -w net.core.busy_poll=50 2>/dev/null || true
    echo "  -> Sysctl: UDP=16MB, backlog=65k, busy_poll=ON"

    # NUMA Detection
    if command -v numactl &> /dev/null; then
        NUMA_NODES=$(numactl --hardware 2>/dev/null | grep "available:" | awk '{print $2}')
        if [ "$NUMA_NODES" -gt 1 ] 2>/dev/null; then
            echo "  -> ⚠️  NUMA: $NUMA_NODES nodes (pertimbangkan CPU pinning)"
        fi
    fi
else
    echo "  -> Dilewati (tidak ada akses root)"
fi

# ──────────────────────────────────────────────────────────
# STEP 7: Docker Build & Launch
# ──────────────────────────────────────────────────────────
echo "[6/7] Build & Deploy Container ..."
if command -v docker-compose &> /dev/null; then
    DOCKER_CMD="docker-compose"
else
    DOCKER_CMD="docker compose"
fi

$DOCKER_CMD down 2>/dev/null || true
$DOCKER_CMD up -d --build netshield-dns

# Tunggu container siap
echo "  -> Menunggu container siap ..."
sleep 5

# ──────────────────────────────────────────────────────────
# STEP 8: XDP/eBPF Kernel Bypass (Opsional, Otomatis)
# ──────────────────────────────────────────────────────────
echo "[7/7] XDP/eBPF Kernel Bypass ..."

# Eksekusi setup XDP di level host (butuh clang & bpftool)
if [ -f "./xdp/setup_xdp_host.sh" ]; then
    echo "  -> Kompilasi & Loading XDP via kernel host..."
    if bash ./xdp/setup_xdp_host.sh > /tmp/xdp_deploy.log 2>&1; then
        echo "  -> ✅ XDP AKTIF! BPF Maps telah di-pin."
        echo "  -> Domain terblokir di-drop di level NIC (0 CPU cost)"
        XDP_STATUS="AKTIF ✅"
    else
        echo "  -> ⚠️  Kompilasi/Load XDP gagal."
        echo "  -> Cek /tmp/xdp_deploy.log untuk detail."
        echo "  -> Sistem tetap berjalan normal tanpa XDP."
        XDP_STATUS="Gagal"
    fi
else
    echo "  -> ⚠️  File setup_xdp_host.sh tidak ditemukan."
    XDP_STATUS="Tidak ditemukan"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " ✅ NetShield DNS V5.0 — Deployment Berhasil!"
echo "════════════════════════════════════════════════════════════"
echo " 🌐 Dashboard : http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo '<server-ip>')"
echo " 📊 DNS       : Port 53 (UDP/TCP)"
echo " 🔒 DoT/DoH   : Port 853/443 (aktifkan di dnsdist.conf)"
echo " ⚡ Branch     : $CURRENT_BRANCH"
echo " 🛡️  XDP       : $(echo $XDP_RESULT | grep -q 'XDP_OK' && echo 'AKTIF ✅' || echo 'Tidak aktif')"
echo "════════════════════════════════════════════════════════════"
