# Stage 1: Build the Go API
FROM golang:alpine AS backend-builder
WORKDIR /app
COPY go-api/ .
RUN go mod download && go build -o /app/netshield-api .

# Stage 2: Build the Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /app
COPY frontend/ .
RUN npm install && npm run build

# Stage 3: Compile XDP/eBPF filter (Ubuntu has better BPF header support)
FROM ubuntu:22.04 AS xdp-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    clang llvm libbpf-dev linux-headers-generic gcc-multilib \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /xdp
COPY xdp/dns_filter.c .
# Kompilasi ke eBPF bytecode (portable, berjalan di semua kernel 4.10+)
RUN clang -O2 -g -target bpf \
    -D__TARGET_ARCH_x86 \
    -I/usr/include/x86_64-linux-gnu \
    -c dns_filter.c -o dns_filter.o || \
    (echo "⚠️ XDP compilation failed, creating placeholder" && touch dns_filter.o)


# Final Stage: PowerDNS + Supervisord + XDP
FROM alpine:latest
RUN apk add --no-cache supervisor dnsdist pdns-recursor lua sqlite tzdata bind-tools numactl curl \
    iproute2 bpftool

ENV TZ=Asia/Jakarta
RUN cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime && \
    echo "Asia/Jakarta" > /etc/timezone

# Copy built artifacts
COPY --from=backend-builder /app/netshield-api /usr/local/bin/netshield-api
COPY --from=frontend-builder /app/dist /var/www/html/

# Copy XDP artifacts
COPY --from=xdp-builder /xdp/dns_filter.o /etc/xdp/dns_filter.o
COPY xdp/xdp_manager.sh /etc/xdp/xdp_manager.sh
RUN chmod +x /etc/xdp/xdp_manager.sh

# Copy configurations
COPY supervisord.conf /etc/supervisord.conf
COPY pdns_config/ /etc/powerdns/

# Setup directories
RUN mkdir -p /var/run/pdns-recursor /var/log/supervisor /data /etc/powerdns/tls /sys/fs/bpf && \
    chown recursor:recursor /var/run/pdns-recursor && \
    touch /etc/powerdns/forward_zones.txt /etc/powerdns/laman_labuh.lua /etc/powerdns/rpz_feeds.txt /etc/powerdns/allowed_ips.txt /etc/powerdns/rpz_compiled.zone /etc/powerdns/custom_blacklist.zone /etc/powerdns/custom_whitelist.zone

# Expose ports (DNS, HTTP Dashboard, DoT, DoH)
EXPOSE 53/udp 53/tcp 80/tcp 853/tcp 443/tcp

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
