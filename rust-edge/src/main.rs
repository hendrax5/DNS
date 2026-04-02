use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::io::AsyncWriteExt;
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use std::collections::HashSet;
use tokio::sync::RwLock;
use rusqlite::Connection;
use tokio::fs::OpenOptions;

#[derive(Default, Clone)]
struct PolicyData {
    pub blacklist: HashSet<String>,
    pub whitelist: HashSet<String>,
    pub acl_ips: HashSet<String>,
}

#[tokio::main(flavor = "multi_thread", worker_threads = 16)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 [RUST-EDGE] V4.1 Dynamic Sync Proxy Starting...");

    // Tembok Kebijakan Tertanam Dalam Memori (RwLock untuk kecepatan tinggi)
    let policy = Arc::new(RwLock::new(PolicyData::default()));

    // Menugaskan Pekerja Latar Belakang (Sync Database)
    let policy_cloned = policy.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            if let Ok(conn) = Connection::open("/data/netshield.db") {
                let mut stmt = conn.prepare("SELECT key, value FROM settings WHERE key IN ('custom_blacklist', 'custom_whitelist', 'acl_ips')").unwrap_or_else(|_| panic!("Failed DB"));
                let mut rows = stmt.query([]).unwrap();
                
                let mut new_policy = PolicyData::default();
                
                while let Ok(Some(row)) = rows.next() {
                    let key: String = row.get(0).unwrap_or_default();
                    let val: String = row.get(1).unwrap_or_default();
                    
                    let parts = val.split(|c| c == '\n' || c == ',' || c == ' ');
                    for part in parts {
                        let p = part.trim();
                        if !p.is_empty() {
                            match key.as_str() {
                                "custom_blacklist" => { new_policy.blacklist.insert(p.to_string()); }
                                "custom_whitelist" => { new_policy.whitelist.insert(p.to_string()); }
                                "acl_ips" => { new_policy.acl_ips.insert(p.to_string()); }
                                _ => {}
                            }
                        }
                    }
                }
                
                // Pertukaran Memori Atomik tanpa menjeda DNS Server (Lock Write sangat singkat)
                *policy_cloned.write().await = new_policy;
            }
        }
    });

    let local_addr = "0.0.0.0:53";
    let target_addr = "127.0.0.1:5353";

    let socket = Arc::new(UdpSocket::bind(local_addr).await?);
    println!("🎯 [RUST-EDGE] Binded 0.0.0.0:53. Connected to /data/netshield.db.");

    // Buka file log dalam mode Append Async
    let log_file = Arc::new(tokio::sync::Mutex::new(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open("/var/log/netshield/pdns-queries.log")
            .await?
    ));

    let mut buf = [0u8; 1500];

    loop {
        let (len, peer) = socket.recv_from(&mut buf).await?;
        let packet = buf[..len].to_vec();
        
        let sock_view = socket.clone();
        let log_view = log_file.clone();
        let current_policy = policy.clone(); // Arcs cloning is cheap

        // Lepaskan paket ke dalam kolam pekerja tokio
        tokio::spawn(async move {
            let mut qname = String::new();
            let mut qtype = 0;

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

            // Dapatkan salinan data kebijakan saat ini (Read Lock cepat)
            let (is_wl, is_bl) = {
                let p = current_policy.read().await;
                // peer_ip dicocokkan (Commented due to Docker NAT)
                // let peer_ip = peer.ip().to_string();
                // if !p.acl_ips.is_empty() && !p.acl_ips.contains(&peer_ip) { drop... }
                
                (p.whitelist.contains(&qname), p.blacklist.contains(&qname))
            };

            // Logika Penyaringan Keras:
            if !is_wl && is_bl {
                // Tembak mati paket ini! Balas Klien dengan NXDOMAIN / REFUSED (3 / 5)
                let mut resp = packet.clone();
                resp[2] |= 0x80; // Set flag QR (Response)
                resp[3] |= 0x05; // Set RCODE = REFUSED (5)
                
                let _ = sock_view.send_to(&resp, &peer).await;
                
                // Logging asinkron untuk Dashboard
                let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                let peer_ip = peer.ip().to_string();
                let json_log = format!("{{\"time\":{}, \"ip\":\"{}\", \"qname\":\"{}\", \"type\":{}, \"action\":\"{}\"}}\n", 
                                epoch, peer_ip, qname, qtype, "STATIC_BLOCKED");
                if let Ok(mut handle) = log_view.try_lock() {
                    let _ = handle.write_all(json_log.as_bytes()).await;
                }
                return;
            }

            // Jika Aman atau masuk Whitelist, Lempar ke PowerDNS (Port 5353) untuk AXFR Resolution
            if let Ok(relay) = UdpSocket::bind("0.0.0.0:0").await {
                if relay.send_to(&packet, target_addr).await.is_ok() {
                    let mut rel_buf = [0u8; 1500];
                    if let Ok(Ok((rlen, _))) = tokio::time::timeout(Duration::from_secs(2), relay.recv_from(&mut rel_buf)).await {
                        let answer = &rel_buf[..rlen];
                        
                        let rcode = answer[3] & 0x0F;
                        let action = if rcode == 3 || rcode == 5 { "RPZ_BLOCKED" } else { "ALLOW" };

                        let is_anomaly = qtype == 255 || qtype == 16;
                        let mut should_log = true;
                        
                        if action == "ALLOW" && !is_anomaly {
                            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
                            if now % 100 > 5 { should_log = false; }
                        }

                        if should_log {
                            let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                            let peer_ip = peer.ip().to_string();
                            let json_log = format!("{{\"time\":{}, \"ip\":\"{}\", \"qname\":\"{}\", \"type\":{}, \"action\":\"{}\"}}\n", 
                                epoch, peer_ip, qname, qtype, action);
                            if let Ok(mut handle) = log_view.try_lock() {
                                let _ = handle.write_all(json_log.as_bytes()).await;
                            }
                        }

                        let _ = sock_view.send_to(answer, &peer).await;
                    }
                }
            }
        });
    }
}
