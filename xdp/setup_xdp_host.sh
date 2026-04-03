#!/bin/bash
# NetShield XDP Setup — Compile di host dengan vmlinux.h
set -e
echo "[XDP] Generating vmlinux.h dari kernel $(uname -r)..."
bpftool btf dump file /sys/kernel/btf/vmlinux format c > /tmp/vmlinux.h

echo "[XDP] Menulis dns_xdp.c (flat loop, verifier-friendly)..."
cat > /tmp/dns_xdp.c << 'EOF'
#include "vmlinux.h"

#define SEC(name) __attribute__((section(name), used))
#define __uint(name, val) int (*name)[val]
#define __type(name, val) typeof(val) *name
#define BPF_MAP_TYPE_HASH 1
#define BPF_MAP_TYPE_ARRAY 2

static void *(*bpf_map_lookup_elem)(void *map, const void *key) = (void *)1;
static __u16 bpf_htons(__u16 x) { return __builtin_bswap16(x); }
static __u16 bpf_ntohs(__u16 x) { return __builtin_bswap16(x); }

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 20000000);
    __type(key, __u64);
    __type(value, __u8);
} blocked_domains SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 3);
    __type(key, __u32);
    __type(value, __u64);
} xdp_stats SEC(".maps");

static __attribute__((always_inline)) void update_stat(__u32 idx) {
    __u64 *v = bpf_map_lookup_elem(&xdp_stats, &idx);
    if (v) __sync_fetch_and_add(v, 1);
}

SEC("xdp")
int xdp_dns_filter(struct xdp_md *ctx) {
    void *data = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;
    update_stat(2);

    // Parse ETH
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return 2;
    if (eth->h_proto != bpf_htons(0x0800)) return 2;

    // Parse IP
    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end) return 2;
    if (ip->protocol != 17) return 2;

    // Parse UDP
    struct udphdr *udp = (void *)((unsigned char *)ip + (ip->ihl * 4));
    if ((void *)(udp + 1) > data_end) return 2;
    if (udp->dest != bpf_htons(53)) return 2;

    // DNS header (12 bytes)
    unsigned char *dns = (unsigned char *)(udp + 1);
    if ((void *)(dns + 12) > data_end) return 2;
    if (dns[2] & 0x80) return 2;

    // Hash raw QNAME bytes (wire format) dengan 1 flat loop
    // Wire format: \x06google\x03com\x00
    // Hash SEMUA byte termasuk length prefix (kecuali null terminator)
    unsigned char *ptr = dns + 12;
    __u64 hash = 0xcbf29ce484222325ULL;
    int len = 0;

    #pragma unroll
    for (int i = 0; i < 128; i++) {
        if ((void *)(ptr + 1) > data_end) return 2;
        unsigned char b = *ptr;
        if (b == 0) break;
        if (b >= 'A' && b <= 'Z') b += 32;
        hash ^= (__u64)b;
        hash *= 0x100000001b3ULL;
        ptr++;
        len++;
    }

    if (len == 0) return 2;

    // Lookup
    __u8 *bl = bpf_map_lookup_elem(&blocked_domains, &hash);
    if (!bl) { update_stat(0); return 2; }

    // BLOCKED
    update_stat(1);
    dns[2] |= 0x80;
    dns[3] = (dns[3] & 0xF0) | 0x05;

    // Swap ETH
    unsigned char tm[6];
    __builtin_memcpy(tm, eth->h_dest, 6);
    __builtin_memcpy(eth->h_dest, eth->h_source, 6);
    __builtin_memcpy(eth->h_source, tm, 6);

    // Swap IP
    __be32 ti = ip->saddr; ip->saddr = ip->daddr; ip->daddr = ti;

    // Swap UDP ports
    __be16 tp = udp->source; udp->source = udp->dest; udp->dest = tp;

    // IP checksum
    ip->check = 0; udp->check = 0;
    unsigned int cs = 0;
    unsigned short *i16 = (unsigned short *)ip;
    #pragma unroll
    for (int k = 0; k < 10; k++) {
        if ((void *)(i16 + k + 1) > data_end) return 2;
        cs += bpf_ntohs(i16[k]);
    }
    cs = (cs >> 16) + (cs & 0xFFFF);
    cs += (cs >> 16);
    ip->check = bpf_htons(~cs & 0xFFFF);

    return 3; // XDP_TX
}

char _license[] SEC("license") = "GPL";
EOF

echo "[XDP] Compiling..."
cd /tmp && clang -O2 -g -target bpf -c dns_xdp.c -o dns_xdp.o || { echo "[XDP] ❌ Compile failed!"; exit 1; }

echo "[XDP] Loading pada enp2s0..."
ip link set dev enp2s0 xdp off 2>/dev/null || true
ip link set dev enp2s0 xdpgeneric obj /tmp/dns_xdp.o sec xdp && {
    echo "[XDP] ✅ XDP AKTIF!"
    echo "[XDP] Memasangi BPF Maps (Pinning)..."
    rm -f /sys/fs/bpf/blocked_domains /sys/fs/bpf/xdp_stats
    bpftool map pin name blocked_domains /sys/fs/bpf/blocked_domains
    bpftool map pin name xdp_stats /sys/fs/bpf/xdp_stats
} || {
    echo "[XDP] ❌ XDP gagal dimuat"
    exit 1
}
ip link show enp2s0 | head -2
