#!/bin/bash
# NetShield XDP Manager — Load/Unload/Sync XDP DNS Filter
# Usage: xdp_manager.sh {load|unload|sync|stats}

set -e

XDP_OBJ="/etc/xdp/dns_filter.o"
BPF_MAP_PIN="/sys/fs/bpf/blocked_domains"
DOMAIN_HASH_TOOL="/usr/local/bin/xdp_hash"

# Deteksi interface utama secara otomatis
detect_iface() {
    IFACE=$(ip route show default 2>/dev/null | awk '{print $5}' | head -1)
    if [ -z "$IFACE" ]; then
        # Fallback: cari interface non-lo pertama yang UP
        IFACE=$(ip -o link show up | grep -v "lo:" | awk -F': ' '{print $2}' | head -1)
    fi
    echo "$IFACE"
}

case "$1" in
    load)
        IFACE=$(detect_iface)
        if [ -z "$IFACE" ]; then
            echo "[XDP] ERROR: Tidak dapat mendeteksi network interface"
            exit 1
        fi

        if [ ! -f "$XDP_OBJ" ]; then
            echo "[XDP] ERROR: $XDP_OBJ tidak ditemukan. Kompilasi gagal?"
            exit 1
        fi

        echo "[XDP] Loading XDP filter pada interface: $IFACE"

        # Pastikan BPF filesystem ter-mount
        mount -t bpf bpf /sys/fs/bpf 2>/dev/null || true

        # Load XDP program (mode SKB untuk kompatibilitas KVM + Baremetal)
        ip link set dev "$IFACE" xdpgeneric obj "$XDP_OBJ" sec xdp 2>/dev/null || \
        ip link set dev "$IFACE" xdp obj "$XDP_OBJ" sec xdp 2>/dev/null || {
            echo "[XDP] WARNING: XDP load gagal. Sistem tetap berjalan tanpa XDP."
            echo "[XDP] Kemungkinan kernel terlalu lama atau interface tidak mendukung."
            exit 0
        }

        # Pin BPF map agar bisa diakses dari userspace
        bpftool map pin name blocked_domains "$BPF_MAP_PIN" 2>/dev/null || true

        echo "[XDP] ✅ XDP filter aktif pada $IFACE"
        ;;

    unload)
        IFACE=$(detect_iface)
        if [ -n "$IFACE" ]; then
            ip link set dev "$IFACE" xdp off 2>/dev/null || true
            rm -f "$BPF_MAP_PIN" 2>/dev/null || true
            echo "[XDP] Filter dihapus dari $IFACE"
        fi
        ;;

    sync)
        # Dipanggil oleh Go API untuk menyinkronkan domain ke BPF map
        # Input: file berisi hash domain (satu per baris, format hex 16 karakter)
        HASH_FILE="${2:-/tmp/xdp_hashes.txt}"
        if [ ! -f "$BPF_MAP_PIN" ]; then
            echo "[XDP] BPF map belum di-pin. XDP mungkin tidak aktif."
            exit 0
        fi

        if [ ! -f "$HASH_FILE" ]; then
            echo "[XDP] Hash file tidak ditemukan: $HASH_FILE"
            exit 0
        fi

        # Flush existing map dan isi ulang
        COUNT=0
        while IFS= read -r hash_hex; do
            if [ -n "$hash_hex" ]; then
                # Convert hex string ke bytes untuk bpftool
                bpftool map update pinned "$BPF_MAP_PIN" \
                    key hex $hash_hex \
                    value hex 01 2>/dev/null || true
                COUNT=$((COUNT + 1))
            fi
        done < "$HASH_FILE"

        echo "[XDP] Synced $COUNT domain hashes ke BPF map"
        ;;

    stats)
        if [ ! -f "$BPF_MAP_PIN" ]; then
            echo '{"xdp_active": false}'
            exit 0
        fi

        # Baca statistik dari xdp_stats map
        TOTAL=$(bpftool map lookup pinned /sys/fs/bpf/xdp_stats key 0x02 0x00 0x00 0x00 2>/dev/null | grep -o '"value":.*' | head -1 || echo '"value": 0')
        BLOCKED=$(bpftool map lookup pinned /sys/fs/bpf/xdp_stats key 0x01 0x00 0x00 0x00 2>/dev/null | grep -o '"value":.*' | head -1 || echo '"value": 0')
        PASSED=$(bpftool map lookup pinned /sys/fs/bpf/xdp_stats key 0x00 0x00 0x00 0x00 2>/dev/null | grep -o '"value":.*' | head -1 || echo '"value": 0')

        echo "{\"xdp_active\": true, \"total\": $TOTAL, \"blocked\": $BLOCKED, \"passed\": $PASSED}"
        ;;

    *)
        echo "Usage: $0 {load|unload|sync <hash_file>|stats}"
        exit 1
        ;;
esac
