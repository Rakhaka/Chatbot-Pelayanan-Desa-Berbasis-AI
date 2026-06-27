# PRD dan Dokumentasi Sistem: Chatbot WhatsApp AI Desa Badau

Dokumen ini menjelaskan kondisi terbaru project Chatbot WhatsApp AI Desa Badau dan Web Management Dashboard. Dokumen ini dipakai sebagai catatan konsep, spesifikasi teknis, alur sistem, catatan risiko, dan checklist sebelum deploy ke hosting/VPS.

## 1. Ringkasan Project

Project ini adalah sistem layanan informasi desa berbasis WhatsApp yang memakai AI Gemini untuk menjawab pertanyaan warga. Sistem berjalan dalam satu aplikasi Node.js yang berisi dua bagian utama:

1. WhatsApp AI Bot
   - Terhubung ke WhatsApp melalui `whatsapp-web.js`.
   - Menyimpan sesi login WhatsApp dengan `LocalAuth` di folder `.wwebjs_auth`.
   - Membaca pesan warga, mengambil data desa dari `data/knowledge.json`, lalu meminta Gemini membuat jawaban.
   - Mengirim jawaban kembali ke WhatsApp.

2. Web Management Dashboard
   - Dashboard admin berbasis Express, Socket.IO, HTML, Tailwind CDN, dan Vanilla JavaScript.
   - Menampilkan status koneksi WhatsApp: `offline`, `loading`, `qr`, `online`.
   - Menampilkan QR WhatsApp jika sesi belum aktif.
   - Menyediakan toggle auto-respon AI.
   - Menyediakan fitur AI-driven update untuk memperbarui `knowledge.json` memakai instruksi bahasa natural.

Tujuan utama sistem adalah membantu perangkat desa memberi jawaban cepat terkait layanan administrasi, perangkat desa, data penduduk, fasilitas desa, lokasi kantor desa, dan informasi umum Desa Badau.

## 2. Kondisi Implementasi Saat Ini

Fitur yang sudah ada:

- Server Express dan dashboard web berjalan dari `src/server.js`.
- Bot WhatsApp berjalan dari `src/bot.js`.
- Entry point utama ada di `index.js`.
- State runtime disimpan di singleton `src/state.js`.
- Gemini helper ada di `src/gemini.js`.
- Knowledge base disimpan di `data/knowledge.json`.
- Dashboard frontend ada di `public/index.html`, `public/js/app.js`, dan `public/css/style.css`.
- Socket.IO dipakai untuk sinkronisasi status realtime ke dashboard.
- Dashboard juga fetch `/api/status` saat socket connect/reconnect, sehingga UI tidak hanya bergantung pada event lama.
- Bot sudah punya fallback untuk pesan sapaan pendek seperti `P`, `halo`, `hai`, `ping`, dan `assalamualaikum`.
- Error Gemini `RECITATION` dikenali dan tidak dianggap sebagai crash WhatsApp/server.

## 3. Tech Stack

- Runtime: Node.js
- Backend: Express.js
- Session dashboard: `express-session`
- Realtime dashboard: Socket.IO
- WhatsApp client: `whatsapp-web.js`
- WhatsApp auth: `LocalAuth`
- AI: `@google/generative-ai`
- QR generation: `qrcode`, `qrcode-terminal`
- Frontend: HTML, Tailwind CSS CDN, Font Awesome CDN, Vanilla JavaScript
- Data utama: JSON file lokal di `data/knowledge.json`

## 4. Struktur Direktori

```text
project-root/
  data/
    knowledge.json          Data utama desa yang dibaca bot

  public/
    index.html              Dashboard login dan panel admin
    css/style.css           CSS tambahan kecil
    js/app.js               Logic dashboard, socket, fetch API, UI state

  src/
    bot.js                  WhatsApp client, lifecycle, Gemini reply
    server.js               Express server, route API, Socket.IO
    state.js                Runtime state dan snapshot status
    gemini.js               Konfigurasi Gemini dan helper error
    knowledge.js            Read/write knowledge.json

  .env                      Konfigurasi lokal, jangan dipush jika berisi secret
  index.js                  Entry point utama
  package.json              Dependency dan script
  PRD.md                    Dokumentasi spesifikasi project
  README.md                 Ringkasan cepat project
```

## 5. Alur Runtime Utama

1. `index.js` membaca `.env`.
2. `startServer()` menjalankan Express dan Socket.IO.
3. `initializeBot(io)` menjalankan WhatsApp client.
4. Bot mengubah state via `state.setBotStatus(...)`.
5. `state.js` broadcast event `bot_status` ke dashboard.
6. Dashboard menerima status melalui Socket.IO.
7. Saat socket connect/reconnect, dashboard juga memanggil `/api/status` untuk mengambil snapshot terbaru.
8. Pesan WhatsApp masuk diproses di `client.on("message")`.
9. Bot membaca `knowledge.json`, menyusun system instruction, lalu memanggil Gemini.
10. Jawaban Gemini dikirim balik ke WhatsApp.

## 6. Lifecycle WhatsApp Bot

Status yang dipakai dashboard:

- `offline`: Bot belum aktif, terputus, atau gagal init.
- `loading`: Bot sedang init, auth, atau reconnect.
- `qr`: Bot membutuhkan scan QR WhatsApp.
- `online`: WhatsApp client siap dan event `ready` sudah diterima.

Event penting di `whatsapp-web.js`:

- `qr`: QR dibuat, dikonversi ke base64, dikirim ke dashboard.
- `loading_screen`: status loading jika client belum siap.
- `authenticated`: sesi WhatsApp berhasil dibaca, menunggu ready.
- `ready`: status menjadi online.
- `auth_failure`: status offline, sesi dibersihkan, restart dijadwalkan.
- `disconnected`: status offline, client dihancurkan secara aman, restart dijadwalkan.

Catatan penting:

- Saat ini client dibuat sebagai satu instance global di `src/bot.js`.
- Ada guard `isInitializing`, `isInitialized`, dan `isRestarting` untuk mencegah init paralel.
- Untuk jangka panjang, reconnect akan lebih kuat jika client dibuat ulang dengan factory function setiap restart, bukan reuse instance yang pernah `destroy()`.

## 7. Alur Dashboard

Dashboard melakukan:

- Cek sesi login lewat `/api/auth-status`.
- Login lewat `/api/login`.
- Logout lewat `/api/logout`.
- Mengambil snapshot bot lewat `/api/status`.
- Toggle AI lewat `/api/toggle-bot`.
- Update knowledge lewat `/api/knowledge/ai-update`.
- Mendengar event Socket.IO:
  - `bot_status`
  - `ai_toggle`

Perbaikan penting yang sudah diterapkan:

- Backend punya `state.getSnapshot()` sebagai sumber status resmi.
- `/api/status`, socket connect, dan heartbeat membaca snapshot yang sama.
- Frontend memanggil `/api/status` saat socket `connect`, sehingga refresh tab, buka ulang dashboard, atau reconnect socket tidak mudah stuck di "Menghubungkan".
- Frontend menormalisasi status backend seperti `ready`, `authenticated`, `disconnected`, `auth_failure`, dan `logout`.

## 8. Alur AI dan Knowledge Base

Data desa disimpan di:

```text
data/knowledge.json
```

Bot membaca file tersebut setiap ada pesan masuk melalui `readKnowledgeText()`. Isi JSON dimasukkan ke system instruction Gemini bersama waktu lokal Asia/Jakarta.

Keuntungan pendekatan ini:

- Data terbaru langsung dipakai tanpa restart server.
- Struktur sederhana dan mudah dipahami.
- Cocok untuk project kecil/menengah.

Kekurangan saat ini:

- File dibaca sinkron setiap pesan masuk.
- Jika traffic tinggi, lebih baik memakai cache in-memory dengan invalidation saat `knowledge.json` diupdate.
- Beberapa isi `knowledge.json` masih mengandung teks mojibake/encoding rusak dari sumber lama. Ini perlu dibersihkan agar prompt lebih bersih dan jawaban Gemini lebih stabil.

## 9. Fitur AI-Driven Data Update

Admin dapat mengetik perintah seperti:

```text
Ubah jam layanan kantor desa menjadi Senin sampai Jumat pukul 08.00 sampai 15.30 WIB.
```

Server akan:

1. Membaca `knowledge.json`.
2. Mengirim JSON saat ini dan perintah admin ke Gemini.
3. Meminta Gemini mengembalikan JSON final.
4. Parse JSON.
5. Menulis ulang `data/knowledge.json`.

Risiko:

- Jika Gemini mengembalikan JSON tidak valid, update gagal.
- Jika dua admin update bersamaan, write file bisa saling timpa.
- Belum ada backup otomatis sebelum write.

Rekomendasi sebelum production:

- Buat backup file sebelum overwrite, misalnya `data/backups/knowledge-YYYYMMDD-HHmmss.json`.
- Tambahkan validasi schema minimal.
- Tambahkan log audit perubahan admin.

## 10. Performa dan Cache

Kondisi saat ini cukup ringan untuk penggunaan awal desa, tetapi ada beberapa hal yang perlu diperhatikan sebelum hosting production.

Yang sudah ringan:

- Frontend memakai Vanilla JS, bukan framework berat.
- Dashboard hanya satu halaman.
- Data utama satu file JSON.
- Chat history dibatasi `MAX_HISTORY_LENGTH = 8`.
- Gemini call diberi timeout 20 detik.

Yang perlu ditingkatkan:

1. Static asset cache
   - `express.static` belum diberi cache policy eksplisit.
   - Untuk production, `public/css`, `public/js`, dan asset statis bisa diberi `maxAge`.
   - HTML sebaiknya tidak dicache terlalu lama agar update dashboard cepat terlihat.

2. CDN dependency
   - Tailwind CDN dan Font Awesome CDN membuat dashboard bergantung pada internet client/browser.
   - Untuk production yang lebih stabil, build Tailwind lokal dan host CSS sendiri.

3. Knowledge cache
   - Saat ini `knowledge.json` dibaca sinkron setiap pesan.
   - Untuk traffic kecil masih aman.
   - Untuk traffic lebih tinggi, cache JSON/text di memory dan refresh setelah AI update.

4. Session store
   - `express-session` default MemoryStore tidak ideal untuk production.
   - Untuk satu proses kecil masih bisa jalan, tetapi tidak tahan restart dan tidak cocok untuk multi-instance.
   - Rekomendasi: gunakan Redis/session file store/database store.

5. Socket heartbeat
   - Heartbeat status tiap 5 detik membantu dashboard tetap sinkron.
   - Untuk banyak dashboard client, bisa diganti emit hanya saat status berubah plus snapshot saat reconnect.

## 11. Keamanan

Kondisi saat ini:

- Username dan password dashboard masih hardcoded di `src/server.js`.
- Session secret masih hardcoded.
- Cookie `secure` masih `false`.
- Socket.IO CORS masih `origin: "*"` .
- `.env` dipakai untuk `GEMINI_API_KEY` dan `PORT`.

Wajib sebelum production:

- Pindahkan username, password, dan session secret ke `.env`.
- Pakai HTTPS di hosting.
- Set cookie secure jika HTTPS aktif.
- Batasi CORS ke domain dashboard.
- Pastikan `.env`, `.wwebjs_auth`, dan `.wwebjs_cache` tidak dipush ke GitHub.
- Jangan pernah reset atau hapus `.wwebjs_auth` production kecuali memang ingin login ulang WhatsApp.

## 12. Reliability dan Error Handling

Yang sudah ada:

- Guard untuk beberapa error Puppeteer non-fatal.
- Retry Gemini maksimal 2 percobaan.
- Timeout Gemini 20 detik.
- Fallback untuk sapaan pendek.
- Fallback untuk error Gemini `RECITATION`.
- Dashboard tidak crash jika socket reconnect.

Yang perlu ditingkatkan:

- `process.on("unhandledRejection")` saat ini hanya log untuk error non-Puppeteer dan tidak memulihkan kondisi bot.
- Reconnect WhatsApp masih memakai instance client global.
- Belum ada health endpoint seperti `/health`.
- Belum ada structured logger.
- Belum ada monitoring memory/CPU/Chromium process.

Rekomendasi:

- Tambahkan `/health` yang mengembalikan status server, botStatus, aiEnabled, uptime.
- Gunakan PM2 untuk auto restart dan log.
- Simpan log penting ke file saat production.
- Pertimbangkan refactor client WhatsApp menjadi factory per restart.

## 13. Catatan Kualitas Kode

Temuan yang masih perlu diperbaiki bertahap:

- Beberapa file menampilkan mojibake pada log atau teks lama jika dibaca terminal tertentu.
- `README.md` sebelumnya belum menjelaskan project.
- `package.json` belum punya script `dev`, `check`, atau test sungguhan.
- Tidak ada automated test.
- Tidak ada lint/format config.
- `knowledge.json` berisi teks panjang yang sebagian encoding-nya rusak.
- Hardcoded credential belum aman untuk production.
- AI update knowledge belum membuat backup.

Jangan lakukan refactor besar sekaligus. Urutan peningkatan yang disarankan:

1. Rapikan dokumentasi dan deploy checklist.
2. Pindahkan credential ke `.env`.
3. Tambahkan static cache policy ringan.
4. Tambahkan backup sebelum write `knowledge.json`.
5. Tambahkan `/health`.
6. Bersihkan encoding `knowledge.json`.
7. Refactor WhatsApp client factory untuk reconnect lebih kuat.
8. Tambahkan script `check` dan test minimal.

## 14. Environment Variables

Contoh `.env`:

```env
PORT=3000
GEMINI_API_KEY=isi_api_key_gemini
GEMINI_MODEL=gemini-3.1-flash-lite

# Direkomendasikan untuk production berikutnya:
ADMIN_USERNAME=chatbot_desa
ADMIN_PASSWORD=ubah_password_ini
SESSION_SECRET=isi_secret_panjang_random
```

Catatan:

- `GEMINI_MODEL` saat ini default di kode adalah `gemini-3.1-flash-lite`.
- Pastikan model tersebut tersedia untuk API key yang dipakai.
- Jika model tidak tersedia, gunakan model Gemini yang valid di akun tersebut.

## 15. Cara Menjalankan Lokal

Install dependency:

```powershell
npm install
```

Jalankan:

```powershell
npm start
```

Buka dashboard:

```text
http://localhost:3000
```

Jika port 3000 bentrok:

```powershell
$env:PORT="3100"
npm start
```

Lalu buka:

```text
http://localhost:3100
```

Login default saat ini:

```text
username: chatbot_desa
password: DesaBadau,.
```

## 16. Checklist Test Lokal

Sebelum deploy:

- Jalankan `node --check` untuk file JS utama.
- Jalankan `npm start`.
- Pastikan dashboard bisa dibuka.
- Login dashboard.
- Pastikan status WhatsApp muncul.
- Scan QR jika belum ada sesi.
- Kirim pesan WhatsApp `P`; bot harus membalas sapaan.
- Kirim pertanyaan layanan administrasi.
- Toggle auto-respon off, pastikan bot tidak membalas.
- Toggle auto-respon on, pastikan bot membalas lagi.
- Refresh dashboard, pastikan status tidak stuck.
- Tutup tab dashboard lalu buka lagi.
- Simulasikan reconnect socket/browser.
- Test AI-driven update dengan perintah kecil.
- Pastikan `knowledge.json` berubah sesuai perintah.
- Pastikan server tidak crash saat Gemini error/quota/timeout.

## 17. Checklist Deploy Manual ke Hosting/VPS

Jangan deploy otomatis dari Codex. Langkah manual yang disarankan:

1. Backup project production.
2. Backup `.wwebjs_auth` production.
3. Backup `data/knowledge.json` production.
4. Pull/copy kode terbaru ke hosting.
5. Jalankan `npm install --omit=dev` jika perlu.
6. Pastikan `.env` production benar.
7. Pastikan port aplikasi sesuai reverse proxy.
8. Jalankan dengan PM2:

```bash
pm2 start index.js --name chatbot-desa
```

9. Cek log:

```bash
pm2 logs chatbot-desa
```

10. Buka dashboard.
11. Pastikan status WhatsApp online.
12. Test chat WhatsApp.
13. Test refresh dashboard.
14. Jangan hapus `.wwebjs_auth` production kecuali ingin scan ulang QR.

## 18. Hal yang Tidak Boleh Dilakukan Sembarangan

- Jangan push `.env`.
- Jangan push `.wwebjs_auth`.
- Jangan reset session WhatsApp production tanpa rencana.
- Jangan hapus `data/knowledge.json`.
- Jangan deploy tanpa backup.
- Jangan refactor besar tepat sebelum demo/production.
- Jangan menjalankan dua instance bot dengan session WhatsApp yang sama.

## 19. Roadmap Peningkatan

Prioritas tinggi:

- Pindahkan credential dashboard ke `.env`.
- Tambahkan backup otomatis `knowledge.json`.
- Tambahkan `/health`.
- Tambahkan cache policy static asset.
- Bersihkan encoding data knowledge.

Prioritas menengah:

- Build Tailwind lokal agar tidak bergantung CDN.
- Tambahkan rate limit login.
- Tambahkan audit log untuk perubahan knowledge.
- Tambahkan cache in-memory untuk knowledge.
- Tambahkan script `npm run check`.

Prioritas lanjut:

- Refactor WhatsApp client menjadi factory per restart.
- Simpan session dashboard di Redis atau store persistent.
- Tambahkan role admin.
- Tambahkan halaman preview/edit manual knowledge.
- Tambahkan monitoring PM2/uptime.
