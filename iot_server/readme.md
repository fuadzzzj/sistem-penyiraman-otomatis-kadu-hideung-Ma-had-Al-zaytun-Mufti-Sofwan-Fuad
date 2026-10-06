Berikut adalah file `README.md` yang lengkap dan rapi. Kamu bisa simpan sebagai file `README.md` di dalam folder proyekmu. Isinya mencakup semua langkah dari nol sampai sistem menyala di laptop lain.

***

# 🌱 SIRKADU - Sistem Irigasi Kadu Hideung Terpadu
**Dashboard Monitoring & Kontrol Otomatis Durian Kadu Hideung — Ma'had Al-Zaytun**

SIRKADU adalah sistem IoT berbasis web untuk memantau kelembapan tanah, mengontrol penyiraman otomatis/manual, memonitor level air toren, serta mendeteksi kesehatan pohon durian menggunakan AI (Drone/Kamera).

---

## 📋 Prasyarat (Yang Harus Disiapkan)

### 1. Hardware
*   **Laptop/PC** (Windows/Linux/Mac) sebagai Server.
*   **Raspberry Pi Pico** (atau mikrokontroler lain) sebagai Gateway/Node.
*   **Kabel USB** untuk menghubungkan Pico ke Laptop.
*   *(Opsional)* Kamera Web / Drone untuk fitur deteksi AI.

### 2. Software
*   **Python 3.8+** ([Download di sini](https://www.python.org/downloads/)).
    *   ⚠️ Saat install di Windows, **centang "Add Python to PATH"**.
*   **Code Editor** (VS Code disarankan).

---

## 🚀 Langkah Instalasi (Step-by-Step)

### Langkah 1: Siapkan Struktur Folder
Buat satu folder utama (misal: `sirkadu_project`), lalu susun file seperti ini:

```text
sirkadu_project/
│
├── server_pico.py       # Backend Python
├── app.js               # Logika Frontend
├── style.css            # Tampilan
├── sirkadu.db           # (Akan terbuat otomatis, jangan hapus)
│
├── templates/           # <-- BUAT FOLDER INI
│   └── index.html       # Pindahkan index.html ke sini
│
├── static/              # <-- BUAT FOLDER INI
│   ├── app.js           # Copy app.js ke sini juga (atau link langsung)
│   ├── style.css        # Copy style.css ke sini juga
│   ├── uploads/         # (Terbuat otomatis)
│   └── results/         # (Terbuat otomatis)
│
└── models/              # <-- BUAT FOLDER INI (Untuk AI)
    └── best.pt          # File model YOLO (jika ada)
```

> **Penting:** Flask membutuhkan `index.html` berada di dalam folder `templates`, dan file CSS/JS di dalam folder `static`.

### Langkah 2: Install Library Python
Buka Terminal / CMD / PowerShell di dalam folder proyek, lalu jalankan:

```bash
pip install flask pyserial
```

Jika ingin menggunakan fitur **Deteksi AI (Drone)**, install juga:
```bash
pip install ultralytics opencv-python
```
*(Catatan: Installasi ultralytics mungkin agak lama karena ukurannya besar).*

### Langkah 3: Cek Port Serial (PENTING!)
Colokkan Raspberry Pi Pico ke laptop. Cek port COM berapa yang terbaca.
*   **Windows:** Cek di Device Manager -> Ports (COM & LPT). Misal: `COM7`, `COM3`.
*   **Linux/Mac:** Biasanya `/dev/ttyACM0` atau `/dev/ttyUSB0`.

Buka file `server_pico.py`, cari baris paling atas:
```python
PORT="COM7"  # GANTI INI SESUAI PORT LAPTOP BARU
BAUD=115200
```
Ubah `"COM7"` sesuai dengan port yang terdeteksi di laptop baru tersebut.

### Langkah 4: Jalankan Server
Di terminal, jalankan perintah:

```bash
python server_pico.py
```

Tunggu sampai muncul tulisan hijau/putih:
```text
SIRKADU aktif di http://127.0.0.1:5000 | AI: ...
```

### Langkah 5: Buka Dashboard
Buka browser (Chrome/Edge/Firefox), ketik alamat:
👉 **http://127.0.0.1:5000**

---

## 🛠️ Panduan Fitur & Troubleshooting

### 1. Sidebar Ikut Scroll?
Jika sidebar ikut bergerak saat scroll, pastikan kamu sudah mengganti CSS `aside` di `style.css` menjadi `position: fixed` (sesuai perbaikan sebelumnya).

### 2. Serial Tidak Terhubung (SERIAL ERR)
*   Pastikan kabel USB tercolok kencang.
*   Pastikan Port di `server_pico.py` sudah benar.
*   Pastikan tidak ada aplikasi lain (seperti Arduino IDE atau Thonny) yang sedang membuka port tersebut. Port hanya bisa dipakai satu aplikasi.

### 3. Node Tidak Muncul di Dashboard
*   Pastikan Pi Pico sudah diprogram untuk mengirim data serial dengan format:
    *   Kelembapan: `TEL,NODE,ID_NODE,KELEMBAPAN,STATUS_VALVE` (Contoh: `TEL,NODE,NODE01,55,CLOSED`)
    *   Toren: `TEL,TOREN,JARAK_CM,STATUS_POMPA_TOREN,STATUS_POMPA_UTAMA`

### 4. Grafik Kosong
*   **Grafik Kelembapan:** Baru terisi setelah 5 menit pertama (karena sistem log setiap 300 detik).
*   **Grafik Penyiraman:** Baru terisi jika ada riwayat pompa ON lalu OFF.

### 5. Kamera / Drone Tidak Jalan
*   Browser hanya mengizinkan kamera jika diakses via `localhost` atau `HTTPS`.
*   Jangan akses lewat IP Address (misal `192.168.x.x`) kecuali pakai HTTPS.
*   Klik ikon "Gembok" di address bar browser -> Izinkan Kamera.

### 6. Cuaca Tidak Update
*   Pastikan laptop terhubung ke **Internet**. Sistem mengambil data cuaca dari API Open-Meteo.

---

## 📦 Mematikan Server
Untuk mematikan server, kembali ke Terminal/CMD tempat server berjalan, lalu tekan:
*   **Windows:** `Ctrl + C`
*   **Mac/Linux:** `Ctrl + C`

---

## 📝 Lisensi
Proyek ini dibuat untuk keperluan edukasi dan monitoring pertanian di Ma'had Al-Zaytun.

***

### Tips Tambahan untuk Kamu:
Kalau mau pindah ke laptop lain, cukup **Copy-Paste satu folder proyek utuh** (kecuali folder `__pycache__` kalau ada), lalu ulangi **Langkah 2** (install library) dan **Langkah 3** (cek port) di laptop baru itu. Database (`sirkadu.db`) akan ikut terbawa, jadi data riwayat tidak hilang.