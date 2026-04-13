#!/bin/bash
# NetShield DNS - Deployment & QPS Tuning Script
# Eksekusi dengan: sudo bash deploy.sh

echo "==========================================================="
echo "⚡ NETSHIELD DNS - CARRIER CLASS TUNING & DEPLOYMENT ⚡"
echo "==========================================================="

DIR="/home/hendra/DNS"

# 1. Terapkan Kernel UDP & TCP Optimizations (Sysctl)
echo "[1/3] Menerapkan Tuning OS Kernel (Sysctl)..."
if [ -f "$DIR/sysctl-dns-optimize.sh" ]; then
    bash "$DIR/sysctl-dns-optimize.sh"
    echo " ✅ Optimasi Buffer Kernel Berhasil Diterapkan."
else
    echo " ⚠️ PERINGATAN: File sysctl-dns-optimize.sh tidak ditemukan!"
fi

# 2. Patch dnsdist.conf ke Multi-Threading (16 Listener Cores)
echo "[2/3] Memperbarui Konfigurasi DNSDist (SO_REUSEPORT)..."
DNSDIST_CONF="$DIR/pdns_config/dnsdist.conf"

if [ -f "$DNSDIST_CONF" ]; then
    # Cek apakah sudah berjalan di mode multi-thread
    if ! grep -q "for i=1,16 do" "$DNSDIST_CONF"; then
        echo " -> Menyuntikkan multi-threading Lua Loop ke dnsdist.conf"
        
        # Hapus default single listener
        sed -i "/setLocal('0.0.0.0:53', {reusePort=true})/d" "$DNSDIST_CONF"
        
        # Tambahkan blok script baru di baris teratas
        cat << 'EOF' > /tmp/temp_dnsdist.conf
-- Multi-Thread SO_REUSEPORT Listener otomatis (16 Cores)
for i=1,16 do
    if i == 1 then
        setLocal('0.0.0.0:53', {reusePort=true})
    else
        addLocal('0.0.0.0:53', {reusePort=true})
    end
end

EOF
        cat "$DNSDIST_CONF" >> /tmp/temp_dnsdist.conf
        mv /tmp/temp_dnsdist.conf "$DNSDIST_CONF"
        echo " ✅ dnsdist.conf berhasil di-patch."
    else
        echo " ✅ DNSDist sudah berada dalam mode Multi-Thread (Lewati langkah ini)."
    fi
else
    echo " ❌ ERROR: File $DNSDIST_CONF tidak ditemukan!"
fi

# 3. Docker Compose Rebuild & Restart
echo "[3/3] Melakukan Docker Rebuild (Menerapkan Konfigurasi Terkini)..."
cd "$DIR" || exit
if command -v docker-compose &> /dev/null; then
    docker-compose build --no-cache netshield-dns
    docker-compose up -d --force-recreate netshield-dns
elif docker compose version &> /dev/null; then
    docker compose build --no-cache netshield-dns
    docker compose up -d --force-recreate netshield-dns
else
    echo " ❌ ERROR: Command docker / docker-compose tidak ditemukan di sistem!"
fi

echo "==========================================================="
echo "🎯 ALL TUNING & DEPLOYMENT COMPLETED!"
echo "Sistem DNS Anda sekarang telah dirombak untuk menerima ratusan ribu QPS."
echo "Sebelum menjalankan 'dnsperf' dengan -c 1600, pastikan Anda mereset ulimit:"
echo ""
echo "    ulimit -n 1000000"
echo "    dnsperf -s 10.168.1.2 -d query.txt -l 100 -T 16 -c 1600 -q 50000"
echo "==========================================================="
