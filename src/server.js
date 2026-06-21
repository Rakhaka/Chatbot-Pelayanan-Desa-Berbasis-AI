require('dotenv').config();
const express = require('express');
const session = require('express-session');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const state = require('./state');
const {
    GEMINI_MODEL,
    DATA_PARSER_SYSTEM_INSTRUCTION,
    getGenAI,
    extractJsonFromGeminiResponse
} = require('./gemini');
const { readKnowledgeText, writeKnowledgeJson } = require('./knowledge');
const { logoutAndRestart } = require('./bot');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

state.io = io;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'desa-badau-secret-key-gemini-chatbot',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    return res.status(401).json({ error: 'Unauthorized. Silakan login terlebih dahulu.' });
}

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/auth-status', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'chatbot_desa' && password === 'DesaBadau,.') {
        req.session.authenticated = true;
        return res.json({ success: true });
    }
    return res.status(400).json({ success: false, error: 'Username atau Password salah.' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Gagal logout.' });
        }
        res.clearCookie('connect.sid');
        return res.json({ success: true });
    });
});

app.post('/api/logout-wa', requireAuth, async (req, res) => {
    try {
        await logoutAndRestart();
        res.json({ success: true, message: 'Proses logout WhatsApp sedang berjalan.' });
    } catch (err) {
        console.error('Error saat logout WhatsApp:', err);
        res.status(500).json({ error: 'Gagal melakukan logout WhatsApp.' });
    }
});

app.get('/api/status', requireAuth, (req, res) => {
    res.json({
        status: state.botStatus,
        qr: state.qrCode,
        aiEnabled: state.aiEnabled
    });
});

app.post('/api/toggle-bot', requireAuth, (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Field "enabled" harus bertipe boolean.' });
    }
    state.setAiEnabled(enabled);
    res.json({ success: true, aiEnabled: state.aiEnabled });
});

app.post('/api/knowledge/ai-update', requireAuth, async (req, res) => {
    const { command } = req.body;

    if (!command || typeof command !== 'string' || !command.trim()) {
        return res.status(400).json({ error: 'Perintah pembaruan tidak boleh kosong.' });
    }

    const genAI = getGenAI();
    if (!genAI) {
        return res.status(503).json({ error: 'GEMINI_API_KEY belum dikonfigurasi di server.' });
    }

    try {
        const currentJson = readKnowledgeText();
        if (currentJson === '(Data desa belum tersedia)') {
            return res.status(404).json({ error: 'File data/knowledge.json tidak ditemukan.' });
        }

        const model = genAI.getGenerativeModel({
            model: GEMINI_MODEL,
            systemInstruction: DATA_PARSER_SYSTEM_INSTRUCTION
        });

        const prompt = `DATA JSON DESA SAAT INI:
${currentJson}

PERINTAH ADMIN:
${command.trim()}

Perbarui data JSON di atas sesuai perintah admin. Keluarkan HANYA JSON hasil akhir yang sudah diperbarui.`;

        const result = await model.generateContent(prompt);
        const updatedData = extractJsonFromGeminiResponse(result.response.text());

        if (!updatedData || typeof updatedData !== 'object' || Array.isArray(updatedData)) {
            return res.status(422).json({ error: 'Respons AI bukan objek JSON yang valid.' });
        }

        writeKnowledgeJson(updatedData);
        res.json({ success: true });
    } catch (err) {
        console.error('Error saat eksekusi AI update knowledge:', err);
        const msg = err.message || String(err);

        if (msg.includes('tidak ditemukan')) {
            return res.status(404).json({ error: msg });
        }
        if (msg.includes('JSON')) {
            return res.status(422).json({ error: 'AI mengembalikan format JSON yang tidak valid. Coba ulangi dengan perintah yang lebih jelas.' });
        }
        if (msg.includes('429') || msg.includes('quota')) {
            return res.status(429).json({ error: 'Kuota Gemini API habis. Coba lagi nanti.' });
        }
        res.status(500).json({ error: 'Gagal memproses pembaruan data via AI.' });
    }
});

io.on('connection', (socket) => {
    socket.emit('bot_status', {
        status: state.botStatus,
        qr: state.qrCode
    });
    socket.emit('ai_toggle', {
        enabled: state.aiEnabled
    });
});

function startServer() {
    return new Promise((resolve, reject) => {
        const PORT = process.env.PORT || 3000;
        server.listen(PORT, () => {
            console.log(`🚀 Web Dashboard server berjalan di http://localhost:${PORT}`);
            
            // Heartbeat: Sinkronisasi status Socket.IO ke frontend secara berkala setiap 5 detik
            setInterval(() => {
                if (state.io) {
                    state.io.emit('bot_status', {
                        status: state.botStatus,
                        qr: state.qrCode
                    });
                }
            }, 5000);

            resolve({ server, io });
        });
        server.on('error', (err) => {
            reject(err);
        });
    });
}

module.exports = { startServer };
