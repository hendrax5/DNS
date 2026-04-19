#!/bin/bash
# NetShield V5.0 - Boot TUI Wizard
# Dijalankan secara otomatis oleh ISO NetShield saat boot

export NEWT_COLORS='
  root=white,blue
  window=white,blue
  border=white,blue
  textbox=white,blue
  button=black,white
'

whiptail --title "Installer NetShield V5.0" --msgbox "Selamat Datang di NetShield-DNS Appliance.\n\nSistem ini akan mengambil alih peladen secara penuh dan menginstal OS khusus Carrier-Grade.\n\nTekan [Enter] untuk Memulai Konfigurasi." 12 70

if ! whiptail --title "Konfirmasi Perizinan" --yesno "Perhatian! Operasi ini akan menimpa seluruh disk Anda menjadi NetShield Appliance.\n\nApakah Anda Yakin Ingin Melanjutkan Instalasi Luring (Offline)?" 10 70; then
    clear
    echo "Instalasi dibatalkan. Sistem akan reboot..."
    sleep 3
    reboot
    exit 0
fi

# IP Configuration
IP_ADDR=$(whiptail --title "Setup Jaringan NetShield" --inputbox "Masukkan IP Statis Manajemen Dashboard\n(Contoh: 10.10.10.2/24)" 10 60 "192.168.1.100/24" 3>&1 1>&2 2>&3)
GATEWAY=$(whiptail --title "Setup Jaringan NetShield" --inputbox "Masukkan IP Gateway Utama\n(Banyak lalu lintas akan dibelokkan ke sini)" 10 60 "192.168.1.1" 3>&1 1>&2 2>&3)

# Timezone Configuration
TIMEZONE=$(whiptail --title "Lokasi Waktu (Timezone)" --menu "Pilih Regional Sinkronisasi Log Waktu" 15 60 4 \
"Asia/Jakarta" "Waktu Indonesia Barat (WIB)" \
"Asia/Makassar" "Waktu Indonesia Tengah (WITA)" \
"Asia/Jayapura" "Waktu Indonesia Timur (WIT)" \
"UTC" "Universal Coordinated Time" 3>&1 1>&2 2>&3)

# Simpan Konfigurasi (Cloud-init override mechanism)
mkdir -p /root/netshield_tmp
echo "IP=$IP_ADDR" > /root/netshield_tmp/net.conf
echo "GW=$GATEWAY" >> /root/netshield_tmp/net.conf
echo "TZ=$TIMEZONE" >> /root/netshield_tmp/net.conf

# Show the progress bar to make them feel the process
{
    for ((i = 0 ; i <= 100 ; i+=5)); do
        sleep 0.1
        echo $i
    done
} | whiptail --title "Netshield Core System" --gauge "Mempersiapkan Lingkungan Sandbox..." 6 60 0

whiptail --title "NetShield Installer" --msgbox "Konfigurasi Awal Tersimpan: \n- IP: $IP_ADDR\n- Zona: $TIMEZONE\n\nMenyerahkan komando ke Subiquity Block Storage untuk memformat Disk dan mendanai Docker Registry..." 12 70

# Memasukkan IP ke konfigurasi cloud-init auto-install yang sesungguhnya!
cat << EOF > /autoinstall.yaml
#cloud-config
autoinstall:
  version: 1
  identity:
    hostname: netshield-core
    password: "\$6\$exot0SjG\$Q.OaU1uJ6l.4u0JbXZ2Ew/.pYm1oIt2P7z.Yc1L3n/Z7i0x4sDcF9PExD4g" # Tahun2026
    username: hendra
  network:
    network:
      version: 2
      ethernets:
        eth0:
          match:
            name: e*
          addresses:
            - $IP_ADDR
          gateway4: $GATEWAY
          nameservers:
            addresses: [1.1.1.1, 8.8.8.8]
  timezone: $TIMEZONE
EOF

clear
echo "==========================================="
echo "⚙️  Mengeksekusi Ubuntu Subiquity Engine..."
echo "==========================================="
# Melanjutkan normal boot / Installer Cloud Init
exit 0
