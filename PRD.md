# Product Requirements Document (PRD): Sistem Chatbot AI Desa & Web Management Dashboard

## 1. Project Overview
Membangun ulang sistem chatbot WhatsApp pelayanan desa dari arsitektur *rule-based* menjadi *AI-driven* menggunakan **Google Gemini API**. Sistem ini akan diintegrasikan dengan sebuah **Web Dashboard** sederhana untuk manajemen bot dan data, berjalan di dalam satu server (Node.js) yang sama.

## 2. Tech Stack
* **Backend:** Node.js, Express.js
* **WhatsApp Client:** `whatsapp-web.js`
* **AI Engine:** `@google/generative-ai` (Model: `gemini-1.5-flash`)
* **Real-time Comms:** `socket.io` (untuk mengirim QR Code ke web)
* **Frontend (Dashboard):** HTML, CSS (Tailwind CSS via CDN agar ringan), Vanilla JavaScript.
* **Authentication:** Session-based / Basic Auth (Hardcoded).

## 3. Aturan Refactoring Data (PENTING UNTUK AI AGENT)
Sistem lama menggunakan banyak file `.js` (di folder `FasilitasDesa`, `LayananAdmin`, `StrukturData`) yang mengekspor *string* teks berformat. 
* **Tugas AI:** Buat skrip migrasi atau struktur ulang agar semua teks dari file-file tersebut disatukan ke dalam satu file `knowledge.json` atau `context.txt`.
* **Alasan:** File ini akan dibaca secara sinkron oleh sistem dan disuntikkan sebagai *System Prompt* ke Gemini API. Membaca 1 file JSON/TXT jauh lebih ringan daripada me-*require* puluhan file `.js`.

## 4. Core Features & Requirements

### A. WhatsApp AI Bot (Engine)
* Menggunakan `LocalAuth` agar sesi tersimpan.
* Tangkap pesan masuk, abaikan pesan grup (`!chat.isGroup`).
* **Prompting Logic:** Gabungkan `knowledge.json` + `Waktu Server Saat Ini` + `Pesan User` -> Kirim ke Gemini API.
* Kembalikan respons Gemini ke user via WA.
* Sistem harus menangani *error* API (misal: "Sistem sedang sibuk, mohon tunggu sebentar") agar aplikasi tidak *crash*.

### B. Web Dashboard - Authentication
* Halaman login sederhana.
* **Kredensial Wajib (Hardcoded):**
    * Username: `chatbot_desa`
    * Password: `DesaBadau,.`
* Hanya user yang berhasil login yang bisa mengakses halaman utama dashboard.

### C. Web Dashboard - Sistem QR Code & Status
* Halaman utama harus menampilkan status bot (Online / Offline / Sedang Menunggu QR).
* Jika sesi belum ada, tangkap *event* `qr` dari `whatsapp-web.js`, ubah ke *base64 image*, dan kirim ke *frontend* via `socket.io` secara *real-time*.
* Admin tinggal *scan* QR dari layar HP/Laptop.

### D. Web Dashboard - Bot Control & Knowledge Manager
* **Toggle Switch:** Tombol untuk *Start / Stop* respon AI. Jika *Stop*, bot tidak membalas pesan apapun (agar admin manusia bisa mengambil alih).
* **Data Editor:** Sebuah *Textarea* besar yang memuat isi `knowledge.json` atau `context.txt`. Admin bisa mengedit jam buka, nama kades, atau layanan di sini. Saat klik "Simpan", timpa file lama. AI otomatis akan menggunakan data terbaru di *chat* berikutnya.

## 5. UI/UX & Styling Guidelines
Desain harus **Mobile-First** (responsif, elemen tidak tumpang tindih di layar HP), *clean*, ringan (tanpa banyak *library* eksternal), dan profesional khas layanan pemerintahan desa.

**Color Palette:**
* **Primary/Brand:** Emerald Green (`#10b981` / Tailwind `emerald-500`) - Memberikan kesan segar, identik dengan desa/pemerintahan.
* **Background:** Off-White/Light Gray (`#f8fafc` / Tailwind `slate-50`) - Bersih dan mudah dibaca.
* **Text/Typography:** Dark Slate (`#0f172a` / Tailwind `slate-900`) - Kontras tinggi untuk *readability*.
* **Card/Container:** Pure White (`#ffffff`) dengan *subtle shadow* (`shadow-sm`).
* **Accent/Warning:** Soft Red/Amber (untuk status Offline atau tombol Stop Bot).

## 6. Directory Structure Target (Untuk AI Agent)
Silakan bentuk struktur direktori sebersih ini:
```text
/project-root
│
├── /data
│   └── knowledge.json       # Hasil rangkuman seluruh data layanan & perangkat desa
│
├── /public
│   ├── index.html           # Halaman Dashboard (Login + Main Panel)
│   ├── css/style.css        # Custom CSS minor (mayoritas pakai Tailwind CDN)
│   └── js/app.js            # Frontend logic (Socket.io client, fetch API)
│
├── /src
│   ├── bot.js               # Logic whatsapp-web.js dan Gemini API
│   └── server.js            # Express.js server, Auth logic, Webhook/Routes
│
├── .env                     # Simpan GEMINI_API_KEY di sini
├── package.json
└── index.js                 # Entry point (menjalankan server.js dan bot.js)

7. Langkah Eksekusi (AI Agent Action Plan)
Inisialisasi proyek dan instalasi dependensi dasar (express, whatsapp-web.js, socket.io, @google/generative-ai, dotenv, qrcode).

Buat struktur folder sesuai panduan di atas.

Rangkum kode statis lama dari strukturPerangkat.js dll. menjadi data/knowledge.json.

Bangun src/server.js untuk melayani file statis, menangani Login hardcoded, dan menyediakan API internal untuk merubah data.

Bangun src/bot.js yang mengintegrasikan WA dan Gemini dengan System Prompt dinamis (menyertakan waktu real-time).

Sambungkan bot.js dan server.js menggunakan Socket.io untuk transmisi QR Code.

Bangun frontend menggunakan Tailwind CSS di /public.