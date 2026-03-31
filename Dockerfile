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

# Final Stage: PowerDNS + Supervisord Alpine base
FROM alpine:latest
RUN apk add --no-cache supervisor pdns-recursor lua sqlite tzdata bind-tools

ENV TZ=Asia/Jakarta
RUN cp /usr/share/zoneinfo/Asia/Jakarta /etc/localtime && \
    echo "Asia/Jakarta" > /etc/timezone

# Copy built artifacts
COPY --from=backend-builder /app/netshield-api /usr/local/bin/netshield-api
COPY --from=frontend-builder /app/dist /var/www/html/

# Copy configurations
COPY supervisord.conf /etc/supervisord.conf
COPY pdns_config/ /etc/powerdns/

# Setup directories
RUN mkdir -p /var/run/pdns-recursor /var/log/supervisor /data && \
    chown recursor:recursor /var/run/pdns-recursor && \
    touch /etc/powerdns/forward_zones.txt /etc/powerdns/laman_labuh.lua

# Expose ports
EXPOSE 53/udp 53/tcp 80/tcp

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
