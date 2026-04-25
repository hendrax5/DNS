#!/bin/bash
# NetShield DNS - Kernel Performance Optimization Script
# Dijalankan di level OS Host Docker (bukan di dalam container) untuk mendongkrak Limit UDP Buffer dan TCP Connections

echo "Applying Production NetShield DNS Kernel Optimization..."

# Network tuning for high-throughput DNS handling
cat <<EOF > /etc/sysctl.d/99-netshield-dns.conf
# Tingkatkan Buffer UDP / TCP Global
net.core.rmem_max=16777216
net.core.wmem_max=16777216
net.core.rmem_default=262144
net.core.wmem_default=262144
net.core.optmem_max=65536
net.ipv4.udp_mem=16777216 16777216 16777216

# Panjang antrian Backlog untuk mitigasi Burst Query (DDoS)
net.core.netdev_max_backlog=100000

# Pengoptimalan TCP untuk Management Interface & TCP Fallback
net.ipv4.tcp_max_syn_backlog=30000
net.ipv4.tcp_max_tw_buckets=2000000
net.ipv4.tcp_tw_reuse=1
net.ipv4.tcp_fin_timeout=10
net.ipv4.ip_local_port_range=1024 65000

# Tingkatkan limit conntrack agar tidak DROP saat koneksi masif
net.netfilter.nf_conntrack_max=2000000

# File Descriptors Limit
fs.file-max=2097152

# Low Latency Polling (Bypass IRQ Wait / Kurangi Syscall Overhead)
net.core.busy_poll=50
net.core.busy_read=50
EOF

# Reload Konfigurasi
sysctl -p /etc/sysctl.d/99-netshield-dns.conf

# Ekstraksi: Force TSC Clocksource di Hard-Level OS via GRUB
if [ -f "/etc/default/grub" ]; then
    echo "Memeriksa parameter booting GRUB untuk optimasi TSC Clocksource & Virtualisasi (KVM)..."
    if ! grep -q "tsc=reliable" /etc/default/grub; then
        echo "⚙️ Memasang TSC Clocksource & KVM Optimizations ke GRUB_CMDLINE_LINUX_DEFAULT..."
        sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT="/GRUB_CMDLINE_LINUX_DEFAULT="tsc=reliable clocksource=tsc mitigations=off processor.max_cstate=1 intel_idle.max_cstate=0 pcie_aspm=off /' /etc/default/grub
        
        if command -v update-grub &> /dev/null; then
            update-grub
            echo "✅ GRUB berhasil diupdate (Debian/Ubuntu)! TSC akan aktif setelah SERVER REBOOT."
        elif command -v grub2-mkconfig &> /dev/null && [ -f /boot/grub2/grub.cfg ]; then
            grub2-mkconfig -o /boot/grub2/grub.cfg
            echo "✅ GRUB berhasil diupdate (RHEL/CentOS)! TSC akan aktif setelah SERVER REBOOT."
        elif command -v grub-mkconfig &> /dev/null && [ -f /boot/grub/grub.cfg ]; then
            grub-mkconfig -o /boot/grub/grub.cfg
            echo "✅ GRUB berhasil diupdate (Arch/Generic Linux)! TSC akan aktif setelah SERVER REBOOT."
        else
            echo "⚠️ GRUB updater tidak ditemukan. Jalankan manual pembaruan bootloader Anda."
        fi
    else
        echo "✅ TSC Clocksource sudah terpasang di GRUB."
    fi
fi

# Ekstraksi: Tuning Interupsi Kartu Jaringan (NIC) secara Dinamis
MAIN_IFACE=$(ip -o route get to 8.8.8.8 | awk '{print $5}' | head -n 1)
if [ -n "$MAIN_IFACE" ]; then
    echo "⚙️ Menerapkan Zero-Latency NIC Tuning (rx-usecs 0) pada Network Interface: $MAIN_IFACE"
    if command -v ethtool &> /dev/null; then
        ethtool -C "$MAIN_IFACE" rx-usecs 0 2>/dev/null
        echo "✅ NIC Interrupt Tweak selesai."
    else
        echo "⚠️ Etool Tool tidak di-install. Mengabaikan tuning NIC."
    fi
fi

echo "---------------------------------------------------------"
echo "✔ Optimization Applied Successfully!"
echo "Sangat disarankan menjalankan NetShield DNS menggunakan 'docker-compose up -d' agar ulimit file dapat ter-load."
