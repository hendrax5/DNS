#!/bin/bash
# High-Performance Netshield SO_REUSEPORT Benchmark Simulator
# Skrip ini membelah 1 mesin dnsperf menjadi belasan tembakan siluman (Multi-Socket) 
# agar Kernel OS melihatnya sebagai IP/Port yang berbeda dan membagikannya rata ke-16 Core CPU.

IP=${1:-103.162.17.181}
FILE=${2:-query.txt}
TIME=${3:-60}
THREADS=${4:-16}

echo "=========================================================="
echo "⚡ NETSHIELD DNS 90K+ CARRIER-GRADE BENCHMARK SIMULATOR ⚡"
echo "=========================================================="
echo "[+] Target IP  : $IP"
echo "[+] Domain List: $FILE"
echo "[+] Duration   : $TIME Seconds"
echo "[+] Mock Users : $THREADS Mesin Virtual dnsperf (Paralel Socket)"
echo "----------------------------------------------------------"

# Cek apakah dnsperf terinstal
if ! command -v dnsperf &> /dev/null; then
    echo "[!] Kesalahan Darurat: Aplikasi 'dnsperf' tidak ditemukan di sistem ini!"
    exit 1
fi

if [ ! -f "$FILE" ]; then
    echo "[!] Kesalahan: File log '$FILE' tidak ditemukan!"
    exit 1
fi

echo "[*] Menembakkan $THREADS rudal dnsperf secara simultan untuk menabrak batas Kernel..."
echo "[*] Mohon tunggu selama $TIME detik..."

# Hapus log usang
rm -f dnsperf_sim_*.log

# Fork N buah proses dnsperf ke latar belakang
for i in $(seq 1 $THREADS); do
    dnsperf -s "$IP" -d "$FILE" -l "$TIME" > "dnsperf_sim_${i}.log" 2>&1 &
done

# Tunggu seluruh proses selesai
wait

echo "[*] Seluruh rudal telah mendarat. Sedang merekapitulasi total QPS gabungan 16 Core..."

TOTAL_QPS=0
TOTAL_SENT=0
TOTAL_COMP=0

for i in $(seq 1 $THREADS); do
    if [ -f "dnsperf_sim_${i}.log" ]; then
        # Ambil metrik tiap log file
        QPS=$(grep "Queries per second:" "dnsperf_sim_${i}.log" | awk '{print $4}' | awk '{printf "%.0f\n", $1}')
        SENT=$(grep "Queries sent:" "dnsperf_sim_${i}.log" | awk '{print $3}')
        COMP=$(grep "Queries completed:" "dnsperf_sim_${i}.log" | awk '{print $3}')
        
        # Jumlahkan (Menggunakan perhitungan bash basic untuk bilangan bulat)
        if [ ! -z "$QPS" ]; then
            TOTAL_QPS=$((TOTAL_QPS + QPS))
            TOTAL_SENT=$((TOTAL_SENT + SENT))
            TOTAL_COMP=$((TOTAL_COMP + COMP))
        fi
    fi
done

# Hitung Persentase Hilang
PERCENT_COMPLETE=100
if [ "$TOTAL_SENT" -gt 0 ]; then
    PERCENT_COMPLETE=$(( TOTAL_COMP * 100 / TOTAL_SENT ))
fi

echo ""
echo "=========================================================================="
echo "🎯 FINAL MACHINE METRICS (16-CORE SO_REUSEPORT KERNEL LOAD BALANCING)"
echo "=========================================================================="
echo "🌍 Total Trafik Terkirim  : $TOTAL_SENT Kueri"
echo "✅ Total Trafik Berhasil  : $TOTAL_COMP Kueri ($PERCENT_COMPLETE%)"
echo "🚀 CARRIER-GRADE QPS      : $TOTAL_QPS QPS"
echo "=========================================================================="
echo ""
echo "[*] QPS di atas adalah daya murni mesin jika dihantam oleh ribuan pelanggan ISP secara bersamaan."
echo "[INFO] Log tiap mesin tersimpan di dnsperf_sim_1.log s.d dnsperf_sim_$THREADS.log"
