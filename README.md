# Chatbot WhatsApp AI Desa Badau

Sistem Chatbot WhatsApp AI Desa + Web Management Dashboard.

## Fitur Utama

- Bot WhatsApp berbasis `whatsapp-web.js`.
- Jawaban AI menggunakan Google Gemini.
- Data desa tersimpan di `data/knowledge.json`.
- Dashboard admin untuk melihat status WhatsApp, scan QR, toggle auto-respon, dan update data desa lewat instruksi AI.
- Sinkronisasi status realtime dengan Socket.IO.
- Snapshot status saat dashboard reconnect agar UI tidak stuck di "Menghubungkan".

## Jalankan Lokal

```powershell
npm install
npm start
```

Buka:

```text
http://localhost:3000
```

Jika port 3000 bentrok:

```powershell
$env:PORT="3100"
npm start
```

## File Penting

- `index.js`: entry point.
- `src/server.js`: Express, API dashboard, Socket.IO.
- `src/bot.js`: WhatsApp client dan balasan Gemini.
- `src/state.js`: runtime state bot dan dashboard snapshot.
- `src/gemini.js`: konfigurasi Gemini dan helper error.
- `src/knowledge.js`: read/write `data/knowledge.json`.
- `public/js/app.js`: logic dashboard.
- `PRD.md`: dokumentasi lengkap konsep, arsitektur, risiko, dan checklist deploy.

## Catatan Production

Sebelum deploy, baca `PRD.md`. Jangan push `.env`, `.wwebjs_auth`, atau `.wwebjs_cache`. Backup `data/knowledge.json` dan session WhatsApp production sebelum update kode.
