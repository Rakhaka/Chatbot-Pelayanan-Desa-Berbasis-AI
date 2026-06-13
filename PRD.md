# Product Requirements Document (PRD): Sistem Chatbot AI Desa & Web Management Dashboard

## 1. Project Overview
Membangun ulang sistem chatbot WhatsApp pelayanan desa dari arsitektur *rule-based* menjadi *AI-driven* menggunakan **Google Gemini API**. Sistem ini akan diintegrasikan dengan sebuah **Web Dashboard** sederhana untuk manajemen bot dan data, berjalan di dalam satu server (Node.js) yang sama.

## 2. Tech Stack
* **Backend:** Node.js, Express.js
* **WhatsApp Client:** `whatsapp-web.js`
* **AI Engine:** `@google/generative-ai` (Bisa menggunakan berbagai versi model seperti `gemini-1.5-flash` / `gemini-3.1-flash-lite`)
* **Real-time Comms:** `socket.io` (Telah dilengkapi *Heartbeat Sync* 5-detik untuk mencegah UI stuck)
* **Frontend (Dashboard):** HTML, CSS (Tailwind CSS via CDN agar ringan), Vanilla JavaScript.
* **Authentication:** `express-session` dengan Basic Auth (Hardcoded).

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

### D. Web Dashboard - Bot Control & AI-Driven Knowledge Manager
* **Toggle Switch:** Tombol untuk *Start / Stop* respon AI. Jika *Stop*, bot tidak membalas pesan apapun (agar admin manusia bisa mengambil alih).
* **AI-Driven Data Update:** Berbeda dengan konsep editor text biasa, admin kini cukup mengetik instruksi dalam bahasa manusia (contoh: "Ubah nama kepala desa menjadi Bapak Irawan"). Gemini API akan memproses dan merestrukturisasi JSON secara otomatis (`knowledge.json`) di balik layar. AI Chatbot seketika akan menggunakan versi data terbaru ini pada percakapan dengan warga.

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
│   ├── server.js            # Express.js server, Auth logic, Webhook/Routes
│   ├── state.js             # Event Emitter untuk state (botStatus, dll)
│   ├── gemini.js            # Konfigurasi model dan fungsi utilitas Gemini
│   └── knowledge.js         # Pengelola Read/Write file data/knowledge.json
│
├── .env                     # Simpan GEMINI_API_KEY di sini
├── package.json
└── index.js                 # Entry point (menjalankan server.js dan bot.js bersamaan)

## 7. Status Saat Ini (Current State)
Seluruh fitur yang direncanakan telah berhasil dibangun dan diintegrasikan:
1. Sesi WhatsApp stabil dengan sistem Auto-Reconnect dari `whatsapp-web.js`.
2. Express Server & Socket.io tersinkronisasi mulus dengan lifecycle WhatsApp berkat implementasi `state.js` sebagai jembatan *event-emitter*.
3. Kendala UI Web Dashboard yang sebelumnya sering "*stuck*" telah dituntaskan menggunakan mekanisme *Heartbeat Sinkronisasi 5-detik* pada `server.js`.
4. Fitur *Toggle Auto-Respon* dan *AI-Driven Data Update* sukses beroperasi menggunakan `gemini.js`, memungkinkan pembaruan basis data desa yang instan, responsif, dan semudah memberikan perintah biasa.