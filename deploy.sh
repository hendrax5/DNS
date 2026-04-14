#!/bin/bash
# NetShield DNS - Deployment & QPS Tuning Script
# Eksekusi dengan: sudo bash deploy.sh

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_header() {
    clear
    echo "==========================================================="
    echo "⚡ NETSHIELD DNS - CARRIER CLASS TUNING & DEPLOYMENT ⚡"
    echo "==========================================================="
}

do_install() {
    echo ""
    echo ">>> MEMULAI INSTALASI BARU & OS TUNING"
    echo "-----------------------------------------------------------"
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
        if ! grep -q "for i=1,16 do" "$DNSDIST_CONF"; then
            echo " -> Menyuntikkan multi-threading Lua Loop ke dnsdist.conf"
            sed -i "/setLocal('0.0.0.0:53', {reusePort=true})/d" "$DNSDIST_CONF"
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

    do_docker_rebuild
}

do_upgrade() {
    echo ""
    echo ">>> MEMULAI UPGRADE (GIT PULL & REDEPLOY)"
    echo "-----------------------------------------------------------"
    cd "$DIR" || exit
    echo "[1/2] Menarik pembaruan dari repositori (git pull)..."
    git pull origin main
    echo " ✅ Repositori diperbarui."
    echo ""
    do_docker_rebuild
}

do_docker_rebuild() {
    echo "🧹 Membersihkan aturan NAT/TProxy sementara agar kontainer Docker bisa mengakses internet / DNS eksternal..."
    iptables -t nat -D PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 53 2>/dev/null
    iptables -t nat -D PREROUTING -p tcp --dport 53 -j REDIRECT --to-ports 53 2>/dev/null
    iptables -t nat -D OUTPUT -p udp --dport 53 -j REDIRECT --to-ports 53 2>/dev/null
    iptables -t nat -D OUTPUT -p tcp --dport 53 -j REDIRECT --to-ports 53 2>/dev/null

    echo "[Docker] Melakukan Rebuild Image DNS dengan Mode Jaringan Host (Mencegah Error DNS)..."
    cd "$DIR" || exit
    
    # Bangun image secara manual dengan network host untuk menghindari gagal resolusi apt/go mod
    if ! docker build --network=host -t netshield-dns-image --no-cache . ; then
        echo " ❌ FATAL ERROR: Gagal mem-build image Docker! (Cek log di atas)"
        exit 1
    fi
    
    if command -v docker-compose &> /dev/null; then
        docker-compose up -d --force-recreate netshield-dns
    elif docker compose version &> /dev/null; then
        docker compose up -d --force-recreate netshield-dns
    else
        echo " ❌ ERROR: Command docker / docker-compose tidak ditemukan di sistem!"
        exit 1
    fi
}

show_post_deploy() {
    echo ""
    echo "==========================================================="
    echo "🎯 ALL TUNING & DEPLOYMENT COMPLETED!"
    echo "Sistem DNS Anda sekarang telah dirombak untuk menerima ratusan ribu QPS."
    echo "Sebelum menjalankan 'dnsperf' dengan -c 1600, pastikan Anda mereset ulimit:"
    echo "    ulimit -n 1000000"
    echo "    dnsperf -s 10.168.1.2 -d query.txt -l 100 -T 16 -c 1600 -q 50000"
    echo "==========================================================="

    echo ""
    echo "📦 SOURCE CODE STATUS (GitHub)"
    echo "-----------------------------------------------------------"
    cd "$DIR" || exit
    git branch --show-current | xargs echo -n " > Branch Aktif       : "
    echo ""
    git log -1 --format=" > Update Terakhir    : %h - %s"
    git log -1 --format=" > Waktu Update       : %cr"
    echo "-----------------------------------------------------------"
    echo ""

    read -p "❓ Ingin mengubah password login Admin Web (hendra@servicex.id)? (y/n): " change_pass
    if [[ "$change_pass" == "y" || "$change_pass" == "Y" ]]; then
        read -sp "   Masukkan Password Baru: " newpass
        echo ""
        echo " ⏱️ Menunggu layanan API siap..."
        sleep 3
        docker exec netshield-v2 curl -s -X POST -H "Content-Type: application/json" -d "{\"password\":\"$newpass\"}" http://127.0.0.1/api/cli-change-password > /dev/null
        echo " ✅ Password berhasil diperbarui! Silakan gunakan password baru untuk login."
    fi

    echo ""
    read -p "❓ Ingin mengaktifkan mode TProxy (Transparent DNS) secara langsung? (y/n): " toggle_tproxy
    if [[ "$toggle_tproxy" == "y" || "$toggle_tproxy" == "Y" ]]; then
        echo " ⏱️ Mengirim instruksi IPtables ke mesin isolasi..."
        sleep 2
        docker exec netshield-v2 curl -s -X POST -H "Content-Type: application/json" -d "{\"tproxy\":true}" http://127.0.0.1/api/cli-toggle-tproxy > /dev/null
        echo " ✅ TProxy berhasil diaktifkan dengan rute NAT IPtables."
    else
        docker exec netshield-v2 curl -s -X POST -H "Content-Type: application/json" -d "{\"tproxy\":false}" http://127.0.0.1/api/cli-toggle-tproxy > /dev/null
    fi

    echo ""
    echo " 🔍 Memeriksa Status Layanan NetShield..."
    sleep 3
    # Menarik status tproxy dari database kontainer
    tproxy_status=$(docker exec netshield-v2 sqlite3 /data/netshield.db "SELECT value FROM settings WHERE key='tproxy_enabled';" 2>/dev/null)
    
    if [[ "$tproxy_status" == "true" ]]; then
        echo " ✅ TPROXY VALIDASI : AKTIF (Transparent DNS Siap Menerima Trafik NAT)"
    else
        echo " ❌ TPROXY VALIDASI : NONAKTIF"
    fi

    echo ""
    echo "🎉 DEPLOYMENT SELESAI"
    echo "==========================================================="
}

show_header
echo "Pilih mode eksekusi:"
echo "  [1] Install Baru (Sysctl Tuning, DNSDist Patch, & Full Rebuild)"
echo "  [2] Upgrade / Redeploy (Git Pull Git & Full Rebuild)"
echo "  [0] Keluar"
echo "-----------------------------------------------------------"
read -p "Masukkan pilihan Anda (1/2/0): " mode

case $mode in
    1)
        do_install
        show_post_deploy
        ;;
    2)
        do_upgrade
        show_post_deploy
        ;;
    0)
        echo "Membatalkan."
        exit 0
        ;;
    *)
        echo "Pilihan tidak valid."
        exit 1
        ;;
esac
