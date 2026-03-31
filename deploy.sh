#!/bin/bash
# ==============================================================
# NETSHIELD DNS ENTERPRISE V2.0 - ONE-CLICK DEPLOYMENT SCRIPT
# ==============================================================

echo "Memulai Deployment NetShield DNS secara otomatis..."
echo "--------------------------------------------------------------"

# 1. Eksekusi Optimasi Sistem (Hanya berjalan mulus di Linux/Root)
echo "[1/3] Menerapkan parameter Performa OS & Jaringan..."
chmod +x sysctl-dns-optimize.sh
sudo ./sysctl-dns-optimize.sh || echo "⚠️ Peringatan: Gagal menerapkan sysctl (Abaikan jika menggunakan Windows/Mac)."
echo ""

# 2. Menghentikan Docker Stack lama jika ada
echo "[2/3] Membersihkan container lama..."
docker-compose down
echo ""

# 3. Membangun dan menyalakan server
echo "[3/3] Membangun (Build) dan Menjalankan NetShield Container..."
docker-compose up -d --build

echo ""
echo "=============================================================="
echo "🚀 DEPLOYMENT SELESAI & SUKSES!"
echo "Panel Observabilitas UI : http://localhost"
echo "Layanan DNS Server      : IP-Server:53 (UDP & TCP Terbuka)"
echo "=============================================================="
