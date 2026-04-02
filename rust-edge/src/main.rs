use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::io::AsyncWriteExt;
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use std::collections::HashSet;
use tokio::sync::RwLock;
use rusqlite::Connection;
use tokio::fs::OpenOptions;
use socket2::{Socket, Domain, Type, Protocol};
use std::net::SocketAddr;

#[derive(Default, Clone)]
struct PolicyData {
    pub blacklist: HashSet<String>,
    pub whitelist: HashSet<String>,
    pub acl_ips: HashSet<String>,
}

fn create_reuseport_socket(addr: SocketAddr) -> std::io::Result<std::net::UdpSocket> {
    let socket = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))?;
    socket.set_reuse_port(true)?;
    socket.set_reuse_address(true)?;
    socket.set_nonblocking(true)?;
    socket.bind(&addr.into())?;
    Ok(socket.into())
}

#[tokio::main(flavor = "multi_thread", worker_threads = 16)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🚀 [RUST-EDGE] V4.2 Carrier-Grade Multiplex Proxy Starting...");

    let policy = Arc::new(RwLock::new(PolicyData::default()));

    let policy_cloned = policy.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(10));
        loop {
            interval.tick().await;
            
            let mut new_policy = PolicyData::default();
            let mut valid_fetch = false;
            
            // Scope Sinkron (Blokade khusus untuk Non-Send Rusqlite Iterator)
            {
                if let Ok(conn) = Connection::open("/data/netshield.db") {
                    if let Ok(mut stmt) = conn.prepare("SELECT key, value FROM settings WHERE key IN ('custom_blacklist', 'custom_whitelist', 'acl_ips')") {
                        if let Ok(mut rows) = stmt.query([]) {
                            valid_fetch = true;
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
                        }
                    }
                }
            } // Semua variabel memori rusqlite MATI di titik ini.

            // Aman melakukan await karena tidak ada "Non-Send" future tersisa
            if valid_fetch {
                *policy_cloned.write().await = new_policy;
            }
        }
    });

    let local_addr: SocketAddr = "0.0.0.0:53".parse().unwrap();
    let target_addr: SocketAddr = "127.0.0.1:5353".parse().unwrap();

    let log_file = Arc::new(tokio::sync::Mutex::new(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open("/var/log/netshield/pdns-queries.log")
            .await?
    ));

    // Spawn 16 Identical Symmetric Listeners utilizing Linux SO_REUSEPORT
    for thread_id in 1..=16 {
        let std_sock = create_reuseport_socket(local_addr).expect("Gagal mengikat port 53 dengan SO_REUSEPORT");
        let socket = Arc::new(UdpSocket::from_std(std_sock).unwrap());
        
        let log_view = log_file.clone();
        let current_policy = policy.clone();
        
        println!("🎯 [RUST-EDGE] Socket Listener {} Active (Balanced via OS Kernel)", thread_id);

        tokio::spawn(async move {
            let mut buf = [0u8; 1500];
            loop {
                // Because each thread has its own socket listening on 53, there is zero lock contention
                if let Ok((len, peer)) = socket.recv_from(&mut buf).await {
                    let packet = buf[..len].to_vec();
                    let sock_view = socket.clone();
                    let log_instance = log_view.clone();
                    let master_policy = current_policy.clone();

                    // Tangani per klien di latar hijau tokio
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

                        let (is_wl, is_bl) = {
                            let p = master_policy.read().await;
                            // BYPASS ACL DEMI TEST DOCKER NAT
                            (p.whitelist.contains(&qname), p.blacklist.contains(&qname))
                        };

                        if !is_wl && is_bl {
                            let mut resp = packet.clone();
                            resp[2] |= 0x80;
                            resp[3] |= 0x05;
                            let _ = sock_view.send_to(&resp, &peer).await;
                            
                            let epoch = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                            let peer_ip = peer.ip().to_string();
                            let json_log = format!("{{\"time\":{}, \"ip\":\"{}\", \"qname\":\"{}\", \"type\":{}, \"action\":\"{}\"}}\n", 
                                            epoch, peer_ip, qname, qtype, "STATIC_BLOCKED");
                            if let Ok(mut handle) = log_instance.try_lock() {
                                let _ = handle.write_all(json_log.as_bytes()).await;
                            }
                            return;
                        }

                        // Kirim Backend
                        if let Ok(relay) = UdpSocket::bind("0.0.0.0:0").await {
                            if relay.send_to(&packet, target_addr).await.is_ok() {
                                let mut rel_buf = [0u8; 1500];
                                if let Ok(Ok((rlen, _))) = tokio::time::timeout(Duration::from_millis(1500), relay.recv_from(&mut rel_buf)).await {
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
                                        if let Ok(mut handle) = log_instance.try_lock() {
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
        });
    }

    // Blokir Main Thread agar tidak pernah terbenam
    let mut idle_trap = tokio::signal::ctrl_c();
    let _ = idle_trap.await;
    println!("🔌 Shutting down Edge...");
    Ok(())
}
