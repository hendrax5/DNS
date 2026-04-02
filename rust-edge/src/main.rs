use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::fs::{OpenOptions, read_to_string};
use tokio::io::AsyncWriteExt;
use std::time::{SystemTime, UNIX_EPOCH};
use std::net::SocketAddr;
use std::collections::HashSet;

#[tokio::main(flavor = "multi_thread", worker_threads = 16)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 [RUST-EDGE] V4.0 Carrier-Grade Telemetry Proxy Starting...");

    // Pemuatan ACL IP 
    let mut acl_ips = HashSet::new();
    if let Ok(acl_data) = read_to_string("/etc/powerdns/allowed_ips.txt").await {
        for line in acl_data.lines() {
            let line = line.trim();
            if !line.is_empty() && !line.starts_with('#') {
                acl_ips.insert(line.to_string());
            }
        }
    }
    let acl_ips = Arc::new(acl_ips);

    let local_addr = "0.0.0.0:53";
    let target_addr = "127.0.0.1:5353";

    let socket = Arc::new(UdpSocket::bind(local_addr).await?);
    println!("🎯 [RUST-EDGE] Listening actively on {}", local_addr);
    println!("🔰 [RUST-EDGE] Target Resolver: {}", target_addr);

    // Buka file log dalam mode Append Async
    let log_file = Arc::new(tokio::sync::Mutex::new(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open("/var/log/netshield/pdns-queries.log")
            .await?
    ));

    let mut buf = [0u8; 1500];

    // Loop Induk (Event-Loop Non-Blocking)
    loop {
        let (len, peer) = socket.recv_from(&mut buf).await?;
        let packet = buf[..len].to_vec();
        
        let acl_view = acl_ips.clone();
        let sock_view = socket.clone();
        let log_view = log_file.clone();

        // Spawn Asynchronous Task (Zero Blocking) untuk setiap paket UDP
        tokio::spawn(async move {
            let mut qname = String::new();
            let mut qtype = 0;

            // Raw Parsing Kecepatan Cahaya (Byte 12 -> Name)
            if len > 12 {
                let mut idx = 12;
                while idx < len {
                    let label_len = packet[idx] as usize;
                    if label_len == 0 { 
                        if idx + 2 < len { qtype = ((packet[idx+1] as u16) << 8) | (packet[idx+2] as u16); }
                        break; 
                    }
                    if label_len >= 64 || idx + 1 + label_len > len { break; }
                    
                    if !qname.is_empty() { qname.push('.'); }
                    if let Ok(s) = std::str::from_utf8(&packet[idx+1..idx+1+label_len]) {
                        qname.push_str(s);
                    }
                    idx += 1 + label_len;
                }
            }

            // Tembok Pertahanan 1: Cek IP ACL (Ganti Lua)
            let peer_ip = peer.ip().to_string();
            if !acl_view.is_empty() && !acl_view.contains(&peer_ip) {
                // Drop or Refused
                let mut resp = packet.clone();
                resp[2] |= 0x80; // QR Response
                resp[3] |= 0x05; // Refused
                let _ = sock_view.send_to(&resp, &peer).await;
                return;
            }

            // Tembok Pertahanan 2: Pukul ke PowerDNS Belakang (Port 5353) menggunakan Ephemeral Socket
            if let Ok(relay) = UdpSocket::bind("0.0.0.0:0").await {
                if relay.send_to(&packet, target_addr).await.is_ok() {
                    let mut rel_buf = [0u8; 1500];
                    // Timeout 2 detik
                    if let Ok(Ok((rlen, _))) = tokio::time::timeout(std::time::Duration::from_secs(2), relay.recv_from(&mut rel_buf)).await {
                        let answer = &rel_buf[..rlen];
                        
                        // Cek RCODE PowerDNS
                        let rcode = answer[3] & 0x0F;
                        let action = if rcode == 3 || rcode == 5 { "RPZ_BLOCKED" } else { "ALLOW" };

                        // Sampling Log 1/20 untuk ALLOW (Seperti Lua v3.0)
                        let mut should_log = true;
                        let is_anomaly = qtype == 255 || qtype == 16;
                        
                        if action == "ALLOW" && !is_anomaly {
                            // Pseudo-random sampling
                            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
                            if now % 100 > 5 {
                                should_log = false; // 95% Chance to skip writing disk
                            }
                        }

                        // Tulis Log Telemetri Asinkron
                        if should_log {
                            let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                            let json_log = format!("{{\"time\":{}, \"ip\":\"{}\", \"qname\":\"{}\", \"type\":{}, \"action\":\"{}\"}}\n", 
                                epoch, peer_ip, qname, qtype, action);
                            if let Ok(mut handle) = log_view.try_lock() {
                                let _ = handle.write_all(json_log.as_bytes()).await;
                            }
                        }

                        // Lempar balik ke Klien Asli
                        let _ = sock_view.send_to(answer, &peer).await;
                    }
                }
            }
        });
    }
}
