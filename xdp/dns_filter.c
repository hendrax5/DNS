// NetShield XDP DNS Filter — Kernel-Level Packet Interception
// 100% Self-Contained + Legacy Map Format (kompatibel semua kernel 4.10+)
// Kompilasi: clang -O2 -target bpf -c dns_filter.c -o dns_filter.o

// ══════════════════════════════════════════════════════════
// TIPE DATA KERNEL
// ══════════════════════════════════════════════════════════
typedef unsigned char      __u8;
typedef unsigned short     __u16;
typedef unsigned int       __u32;
typedef unsigned long long __u64;
typedef __u16 __be16;
typedef __u32 __be32;
typedef int   __s32;

// ══════════════════════════════════════════════════════════
// KONSTANTA BPF
// ══════════════════════════════════════════════════════════
enum xdp_action {
    XDP_ABORTED = 0, XDP_DROP, XDP_PASS, XDP_TX, XDP_REDIRECT,
};

#define BPF_MAP_TYPE_HASH  1
#define BPF_MAP_TYPE_ARRAY 2

// BPF Helper IDs
static void *(*bpf_map_lookup_elem)(void *map, const void *key) = (void *)1;

#define SEC(name) __attribute__((section(name), used))

static __u16 bpf_htons(__u16 x) { return __builtin_bswap16(x); }
static __u16 bpf_ntohs(__u16 x) { return __builtin_bswap16(x); }

// ══════════════════════════════════════════════════════════
// STRUKTUR PAKET JARINGAN
// ══════════════════════════════════════════════════════════
#define ETH_P_IP    0x0800
#define ETH_ALEN    6
#define IPPROTO_UDP 17

struct ethhdr {
    unsigned char h_dest[ETH_ALEN];
    unsigned char h_source[ETH_ALEN];
    __be16 h_proto;
} __attribute__((packed));

struct iphdr {
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
    __u8 ihl:4, version:4;
#else
    __u8 version:4, ihl:4;
#endif
    __u8  tos;
    __be16 tot_len;
    __be16 id;
    __be16 frag_off;
    __u8  ttl;
    __u8  protocol;
    __u16 check;
    __be32 saddr;
    __be32 daddr;
} __attribute__((packed));

struct udphdr {
    __be16 source;
    __be16 dest;
    __be16 len;
    __be16 check;
} __attribute__((packed));

struct xdp_md {
    __u32 data;
    __u32 data_end;
    __u32 data_meta;
    __u32 ingress_ifindex;
    __u32 rx_queue_index;
};

// ══════════════════════════════════════════════════════════
// BPF MAPS (LEGACY FORMAT — kompatibel semua iproute2)
// ══════════════════════════════════════════════════════════
struct bpf_map_def {
    unsigned int type;
    unsigned int key_size;
    unsigned int value_size;
    unsigned int max_entries;
    unsigned int map_flags;
};

#define DNS_PORT 53

// Map: FNV-1a hash domain → 1 (blocked). 20 juta entri.
struct bpf_map_def SEC("maps") blocked_domains = {
    .type        = BPF_MAP_TYPE_HASH,
    .key_size    = sizeof(__u64),
    .value_size  = sizeof(__u8),
    .max_entries = 20000000,
    .map_flags   = 0,
};

// Map: Statistik counter (3 entries: pass, blocked, total)
struct bpf_map_def SEC("maps") xdp_stats = {
    .type        = BPF_MAP_TYPE_ARRAY,
    .key_size    = sizeof(__u32),
    .value_size  = sizeof(__u64),
    .max_entries = 3,
    .map_flags   = 0,
};

#define STAT_PASS    0
#define STAT_BLOCKED 1
#define STAT_TOTAL   2

static __attribute__((always_inline)) void update_stat(__u32 idx) {
    __u64 *val = bpf_map_lookup_elem(&xdp_stats, &idx);
    if (val) __sync_fetch_and_add(val, 1);
}

// FNV-1a hash byte (identik dengan Go API)
static __attribute__((always_inline)) __u64 fnv1a_byte(__u64 hash, unsigned char c) {
    if (c >= 'A' && c <= 'Z') c += 32;
    hash ^= c;
    hash *= 0x100000001b3ULL;
    return hash;
}

// ══════════════════════════════════════════════════════════
// PROGRAM XDP UTAMA
// ══════════════════════════════════════════════════════════
SEC("xdp")
int xdp_dns_filter(struct xdp_md *ctx) {
    void *data     = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;

    update_stat(STAT_TOTAL);

    // Parse Ethernet
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return XDP_PASS;
    if (eth->h_proto != bpf_htons(ETH_P_IP)) return XDP_PASS;

    // Parse IPv4
    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end) return XDP_PASS;
    if (ip->protocol != IPPROTO_UDP) return XDP_PASS;

    // Parse UDP
    struct udphdr *udp = (void *)ip + (ip->ihl * 4);
    if ((void *)(udp + 1) > data_end) return XDP_PASS;
    if (udp->dest != bpf_htons(DNS_PORT)) return XDP_PASS;

    // Parse DNS Header (12 bytes)
    unsigned char *dns = (unsigned char *)(udp + 1);
    if ((void *)(dns + 12) > data_end) return XDP_PASS;
    if (dns[2] & 0x80) return XDP_PASS; // Ini respons, bukan kueri

    // Extract QNAME & Compute FNV-1a Hash
    unsigned char *qname = dns + 12;
    __u64 hash = 0xcbf29ce484222325ULL;
    int name_len = 0;
    int first_label = 1;

    #pragma unroll
    for (int i = 0; i < 32; i++) {
        if ((void *)(qname + 1) > data_end) return XDP_PASS;
        unsigned char label_len = *qname;

        if (label_len == 0) break;
        if (label_len > 63) return XDP_PASS;

        if (!first_label) {
            hash = fnv1a_byte(hash, '.');
            name_len++;
        }
        first_label = 0;
        qname++;

        #pragma unroll
        for (int j = 0; j < 63; j++) {
            if (j >= label_len) break;
            if ((void *)(qname + 1) > data_end) return XDP_PASS;
            hash = fnv1a_byte(hash, *qname);
            qname++;
            name_len++;
        }
    }

    if (name_len == 0) return XDP_PASS;

    // Lookup di BPF Map
    __u8 *blocked = bpf_map_lookup_elem(&blocked_domains, &hash);
    if (!blocked) {
        update_stat(STAT_PASS);
        return XDP_PASS;
    }

    // ═══ BLOCKED! Balas langsung dari NIC ═══
    update_stat(STAT_BLOCKED);

    // Set QR=1 (respons), RCODE=5 (REFUSED)
    dns[2] |= 0x80;
    dns[3] = (dns[3] & 0xF0) | 0x05;

    // Swap Ethernet MAC
    unsigned char tmp_mac[ETH_ALEN];
    __builtin_memcpy(tmp_mac, eth->h_dest, ETH_ALEN);
    __builtin_memcpy(eth->h_dest, eth->h_source, ETH_ALEN);
    __builtin_memcpy(eth->h_source, tmp_mac, ETH_ALEN);

    // Swap IP
    __be32 tmp_ip = ip->saddr;
    ip->saddr = ip->daddr;
    ip->daddr = tmp_ip;

    // Swap UDP ports
    __be16 tmp_port = udp->source;
    udp->source = udp->dest;
    udp->dest = tmp_port;

    // Recalc IP checksum
    ip->check = 0;
    udp->check = 0;
    unsigned int csum = 0;
    unsigned short *ip16 = (unsigned short *)ip;
    #pragma unroll
    for (int k = 0; k < 10; k++) {
        if ((void *)(ip16 + k + 1) > data_end) return XDP_PASS;
        csum += bpf_ntohs(ip16[k]);
    }
    csum = (csum >> 16) + (csum & 0xFFFF);
    csum += (csum >> 16);
    ip->check = bpf_htons(~csum & 0xFFFF);

    return XDP_TX;
}

char _license[] SEC("license") = "GPL";
