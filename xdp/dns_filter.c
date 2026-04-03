// NetShield XDP DNS Filter — Kernel-Level Packet Interception
// Domain terblokir di-DROP di level NIC, SEBELUM kernel network stack.
//
// Kompilasi: clang -O2 -target bpf -c dns_filter.c -o dns_filter.o

#include <linux/bpf.h>
#include <linux/if_ether.h>
#include <linux/ip.h>
#include <linux/udp.h>
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>

#define DNS_PORT 53
#define MAX_QNAME_LEN 253

// BPF Map: FNV-1a hash domain → 1 (blocked)
// Kapasitas: 20 juta domain
struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 20000000);
    __type(key, __u64);
    __type(value, __u8);
} blocked_domains SEC(".maps");

// Statistik counter
struct {
    __uint(type, BPF_MAP_TYPE_ARRAY);
    __uint(max_entries, 3);
    __type(key, __u32);
    __type(value, __u64);
} xdp_stats SEC(".maps");

#define STAT_PASS    0
#define STAT_BLOCKED 1
#define STAT_TOTAL   2

static __always_inline void update_stat(__u32 idx) {
    __u64 *val = bpf_map_lookup_elem(&xdp_stats, &idx);
    if (val) __sync_fetch_and_add(val, 1);
}

// FNV-1a hash (sama dengan implementasi di Go API)
static __always_inline __u64 fnv1a_byte(__u64 hash, unsigned char c) {
    if (c >= 'A' && c <= 'Z') c += 32; // lowercase
    hash ^= c;
    hash *= 0x100000001b3ULL;
    return hash;
}

SEC("xdp")
int xdp_dns_filter(struct xdp_md *ctx) {
    void *data     = (void *)(long)ctx->data;
    void *data_end = (void *)(long)ctx->data_end;

    update_stat(STAT_TOTAL);

    // === Parse Ethernet ===
    struct ethhdr *eth = data;
    if ((void *)(eth + 1) > data_end) return XDP_PASS;
    if (eth->h_proto != bpf_htons(ETH_P_IP)) return XDP_PASS;

    // === Parse IPv4 ===
    struct iphdr *ip = (void *)(eth + 1);
    if ((void *)(ip + 1) > data_end) return XDP_PASS;
    if (ip->protocol != IPPROTO_UDP) return XDP_PASS;

    // === Parse UDP ===
    struct udphdr *udp = (void *)ip + (ip->ihl * 4);
    if ((void *)(udp + 1) > data_end) return XDP_PASS;
    if (udp->dest != bpf_htons(DNS_PORT)) return XDP_PASS;

    // === Parse DNS Header (12 bytes) ===
    unsigned char *dns = (unsigned char *)(udp + 1);
    if ((void *)(dns + 12) > data_end) return XDP_PASS;

    // Bit QR harus 0 (ini kueri, bukan respons)
    if (dns[2] & 0x80) return XDP_PASS;

    // === Extract QNAME & Compute FNV-1a Hash ===
    unsigned char *qname = dns + 12;
    __u64 hash = 0xcbf29ce484222325ULL; // FNV offset basis
    int name_len = 0;
    int first_label = 1;

    // Loop maks 32 label (cukup untuk domain manapun)
    #pragma unroll
    for (int i = 0; i < 32; i++) {
        if ((void *)(qname + 1) > data_end) return XDP_PASS;
        unsigned char label_len = *qname;

        if (label_len == 0) break;        // end of QNAME
        if (label_len > 63) return XDP_PASS; // compression pointer / invalid

        // Tambahkan titik pemisah (kecuali label pertama)
        if (!first_label) {
            hash = fnv1a_byte(hash, '.');
            name_len++;
        }
        first_label = 0;

        qname++; // lewati byte panjang label

        // Hash setiap byte dalam label (maks 63 byte per label)
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

    // === Lookup di BPF Map ===
    __u8 *blocked = bpf_map_lookup_elem(&blocked_domains, &hash);
    if (!blocked) {
        update_stat(STAT_PASS);
        return XDP_PASS; // Domain bersih → lanjut ke DNSDist
    }

    // === BLOCKED! Balas langsung dari NIC ===
    update_stat(STAT_BLOCKED);

    // 1. Set QR=1 (respons), RCODE=5 (REFUSED)
    dns[2] |= 0x80;                  // QR = 1
    dns[3] = (dns[3] & 0xF0) | 0x05; // RCODE = REFUSED

    // 2. Swap Ethernet MAC
    unsigned char tmp_mac[ETH_ALEN];
    __builtin_memcpy(tmp_mac, eth->h_dest, ETH_ALEN);
    __builtin_memcpy(eth->h_dest, eth->h_source, ETH_ALEN);
    __builtin_memcpy(eth->h_source, tmp_mac, ETH_ALEN);

    // 3. Swap IP addresses
    __be32 tmp_ip = ip->saddr;
    ip->saddr = ip->daddr;
    ip->daddr = tmp_ip;

    // 4. Swap UDP ports
    __be16 tmp_port = udp->source;
    udp->source = udp->dest;
    udp->dest = tmp_port;

    // 5. Recalc IP checksum
    ip->check = 0;
    udp->check = 0; // UDP checksum optional untuk IPv4
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

    // XDP_TX: Pantulkan paket kembali melalui NIC yang sama!
    // Biaya CPU = 0. Paket tidak pernah menyentuh userspace.
    return XDP_TX;
}

char _license[] SEC("license") = "GPL";
