#!/bin/bash
# NetShield V5.0 - Appliance ISO Builder
# Eksekusi dengan: sudo bash build-iso.sh

set -e

if [ "$EUID" -ne 0 ]; then 
  echo "Mohon jalankan dengan sudo!"
  exit 1
fi

echo "==================================================="
echo "💿 NETSHIELD V5.0 - APPLIANCE ISO BUILDER"
echo "==================================================="

WORKDIR="netshield-iso-work"
ISO_URL="https://releases.ubuntu.com/22.04/ubuntu-22.04.4-live-server-amd64.iso"
ISO_NAME="ubuntu-base.iso"

# 1. Install Dependencies
echo "[1/6] Memasang utilitas pembuat ISO..."
apt-get update -y
apt-get install -y xorriso squashfs-tools mtools fdisk genisoimage dialog

rm -rf "$WORKDIR"
mkdir -p "$WORKDIR/iso" "$WORKDIR/custom-root" "$WORKDIR/extracted-iso"

# 2. Download ISO
if [ ! -f "$ISO_NAME" ]; then
    echo "[2/6] Mengunduh Ubuntu Server Minimal (ini memakan waktu)..."
    wget -O "$ISO_NAME" "$ISO_URL"
fi

# 3. Ekstraksi ISO
echo "[3/6] Membongkar ISO dan SquashFS..."
mount -o loop "$ISO_NAME" "$WORKDIR/iso"
rsync -a "$WORKDIR/iso/" "$WORKDIR/extracted-iso/"
umount "$WORKDIR/iso"

# 4. Baking NetShield & Docker Image
echo "[4/6] Menyuntikkan Kode NetShield & Docker Offline Image..."
# Export image docker lokal (Jika ada, agar offline ready)
if docker images | grep -q "netshield-dns-image"; then
    echo " -> Menemukan Image lokal, melakukan Docker Save..."
    mkdir -p "$WORKDIR/extracted-iso/netshield-offline"
    docker save netshield-dns-image:latest > "$WORKDIR/extracted-iso/netshield-offline/netshield-image.tar"
fi

# Copy Repository Bawaan
cp -r ../ "$WORKDIR/extracted-iso/netshield-offline/source-code"

# Copy TUI Wizard
cp tui-wizard.sh "$WORKDIR/extracted-iso/netshield-offline/"
chmod +x "$WORKDIR/extracted-iso/netshield-offline/tui-wizard.sh"

# Injeksi eksekusi otomatis saat boot
echo " -> Menginjeksi autostart installer layar biru pada TTY1..."
# Kita menggunakan modify GRUB parameters untuk langsung menjalankan tui wizard
sed -i 's/quiet splash/quiet splash autoinstall/g' "$WORKDIR/extracted-iso/boot/grub/grub.cfg" || true

# 5. Kustomisasi Cloud-Init untuk menelan TUI Wizard kita
cat << 'EOF' > "$WORKDIR/extracted-iso/nocloud/user-data"
#cloud-config
autoinstall:
  version: 1
  interactive-sections:
    - network
    - storage
    - timezone
  early-commands:
    # Memaksa TTY1 untuk pindah haluan ke TUI Wizard Netshield
    - systemctl stop getty@tty1.service
    - /cdrom/netshield-offline/tui-wizard.sh
  late-commands:
    - cp -r /cdrom/netshield-offline/source-code /target/opt/netshield
    - chroot /target bash -c "cd /opt/netshield && bash deploy.sh"
    - cat /cdrom/netshield-offline/netshield-image.tar | chroot /target docker load
EOF

touch "$WORKDIR/extracted-iso/nocloud/meta-data"

# 6. Repackage ISO
echo "[5/6] Mengemas ulang menjadi ISO NetShield-Appliance..."
cd "$WORKDIR/extracted-iso"
xorriso -as mkisofs -r \
  -V "NETSHIELD_V5" \
  -J -l -b isolinux/isolinux.bin -c isolinux/boot.cat \
  -no-emul-boot -boot-load-size 4 -boot-info-table \
  -eltorito-alt-boot -e boot/grub/efi.img -no-emul-boot \
  -isohybrid-gpt-basdat -isohybrid-apm-hfsplus \
  -o ../../NetShield-V5-Appliance-amd64.iso .

cd ../../
rm -rf "$WORKDIR"

echo ""
echo "✅ PEMBUATAN SELESAI!"
echo "File ISO tersedia di: NetShield-V5-Appliance-amd64.iso"
echo "Bakar menggunakan Rufus/BalenaEtcher ke USB Flashdisk."
