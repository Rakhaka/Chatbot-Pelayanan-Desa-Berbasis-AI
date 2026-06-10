// index.js
require('dotenv').config();
const { startServer } = require('./src/server');
const { initializeBot } = require('./src/bot');

console.log('===================================================');
console.log('🏛️  Sistem Chatbot AI Desa & Web Management Dashboard');
console.log('===================================================');

// 1. Jalankan Web Dashboard Express & Socket.io Server
startServer();

// 2. Jalankan WhatsApp Client & Gemini AI Bot Engine
initializeBot();