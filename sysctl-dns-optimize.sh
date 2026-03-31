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
EOF

# Reload Konfigurasi
sysctl -p /etc/sysctl.d/99-netshield-dns.conf

echo "---------------------------------------------------------"
echo "✔ Optimization Applied Successfully!"
echo "Sangat disarankan menjalankan NetShield DNS menggunakan 'docker-compose up -d' agar ulimit file dapat ter-load."
