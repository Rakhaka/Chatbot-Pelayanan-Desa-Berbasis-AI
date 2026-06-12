// index.js
require('dotenv').config();
const { startServer } = require('./src/server');
const { initializeBot } = require('./src/bot');

console.log('===================================================');
console.log('🏛️  Sistem Chatbot AI Desa & Web Management Dashboard');
console.log('===================================================');

// 1. Jalankan Web Dashboard Express & Socket.io Server
async function main() {
    try {
        await startServer();
        // 2. Jalankan WhatsApp Client & Gemini AI Bot Engine (di latar belakang setelah server aktif)
        initializeBot();
    } catch (err) {
        console.error('❌ Gagal mengaktifkan server utama:', err);
        process.exit(1);
    }
}

main();