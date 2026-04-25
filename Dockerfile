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

# Stage 3: Compile XDP/eBPF filter (self-contained, no system headers needed)
FROM ubuntu:22.04 AS xdp-builder
RUN apt-get update && apt-get install -y --no-install-recommends clang llvm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /xdp
COPY xdp/dns_filter.c .
RUN clang -O2 -target bpf -c dns_filter.c -o dns_filter.o && \
    echo "✅ XDP compiled successfully" || \
    (echo "⚠️ XDP compilation failed" && touch dns_filter.o)

# Stage 4: Compile DNSDist Lua Native C Extension
FROM alpine:latest AS lua-c-builder
RUN apk add --no-cache gcc musl-dev lua5.4-dev
WORKDIR /c-ext
COPY pdns_config/bloom_native.c .
RUN gcc -O3 -shared -fPIC -I/usr/include/lua5.4 -o bloom_native.so bloom_native.c


# Final Stage: PowerDNS + Supervisord + XDP + GoBGP
FROM alpine:latest
RUN apk add --no-cache supervisor dnsdist unbound pdns-recursor lua sqlite tzdata bind-tools numactl curl \
    iproute2 bpftool && \
    curl -sL https://github.com/osrg/gobgp/releases/download/v3.31.0/gobgp_3.31.0_linux_amd64.tar.gz -o gobgp.tar.gz && \
    tar -xzf gobgp.tar.gz && \
    mv gobgpd /usr/local/bin/ && \
    mv gobgp /usr/local/bin/ && \
    rm gobgp.tar.gz && \
    touch /etc/gobgpd.toml

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
COPY --from=lua-c-builder /c-ext/bloom_native.so /etc/powerdns/bloom_native.so

# Setup directories
RUN mkdir -p /var/run/pdns-recursor /var/run/unbound /var/log/supervisor /data /etc/powerdns/tls /sys/fs/bpf && \
    mkdir -p /etc/unbound && \
    touch /etc/powerdns/forward_zones.txt /etc/powerdns/laman_labuh.lua /etc/powerdns/rpz_feeds.txt /etc/powerdns/allowed_ips.txt /etc/powerdns/rpz_compiled.zone /etc/powerdns/custom_blacklist.zone /etc/powerdns/custom_whitelist.zone && \
    chown recursor:recursor /var/run/pdns-recursor && chown unbound:unbound /etc/unbound /var/run/unbound

# Expose ports (DNS, HTTP Dashboard, DoT, DoH)
EXPOSE 53/udp 53/tcp 80/tcp 853/tcp 443/tcp

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
