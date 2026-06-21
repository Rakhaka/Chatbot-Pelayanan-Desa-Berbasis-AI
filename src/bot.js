const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const state = require("./state");
const { GEMINI_MODEL, getGenAI, describeGeminiError } = require("./gemini");
const { readKnowledgeText } = require("./knowledge");

const BROWSER_CLOSE_TIMEOUT_MS = 15000;
const BROWSER_POLL_INTERVAL_MS = 200;

// =====================================================================
// Guard: Tangkap error Puppeteer non-fatal agar Express server tidak mati
// =====================================================================
const PUPPETEER_ERROR_PATTERNS = [
    "Target closed",
    "Session closed",
    "Protocol error",
    "Navigation failed because browser has disconnected",
    "detached Frame",
    "Execution context was destroyed"
];

function isPuppeteerError(err) {
    const msg = err?.message || String(err);
    return PUPPETEER_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

process.on("uncaughtException", (err) => {
    if (isPuppeteerError(err)) {
        console.warn("[Bot] ⚠️ Puppeteer error non-fatal (diabaikan):", err.message);
        return;
    }
    console.error("[Bot] ❌ Uncaught Exception FATAL:", err);
    process.exit(1);
});

process.on("unhandledRejection", (reason) => {
    if (isPuppeteerError(reason)) {
        console.warn("[Bot] ⚠️ Unhandled rejection non-fatal (diabaikan):", reason.message);
        return;
    }
    console.error("[Bot] ❌ Unhandled Rejection:", reason);
});

if (getGenAI()) {
    console.log(`[Bot] 🤖 Model Gemini aktif: ${GEMINI_MODEL}`);
} else {
    console.warn("⚠️ PERINGATAN: GEMINI_API_KEY tidak ditemukan di file .env!");
}

function cleanSessionFolder() {
    const authPath = path.resolve(__dirname, "../.wwebjs_auth");
    if (!fs.existsSync(authPath)) return;

    console.log("[Bot] 🧹 Menghapus folder sesi lama...");
    try {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log("[Bot] ✅ Folder sesi lama berhasil dihapus.");
    } catch (err) {
        console.error("[Bot] ❌ Gagal menghapus folder sesi:", err);
    }
}

// =====================================================================
// Chat History (Short-Term Memory) & Initialization Guards
// =====================================================================
const chatHistories = new Map();
const MAX_HISTORY_LENGTH = 8; // Batasi ingatan maksimal 8 pesan (4 tanya-jawab) untuk hemat RAM & Token

let isInitializing = false;
let isInitialized = false;
let isRestarting = false;
let io = null;

// State Management
let currentBotStatus = 'INITIALIZING';
let lastQR = '';

// KEY CHANGE: client sekarang `let` dan dimulai null.
// Instance baru dibuat setiap kali restart via createClient().
let client = null;

// Puppeteer args TANPA --single-process (penyebab bottleneck performa)
const PUPPETEER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding'
];

// =====================================================================
// Factory: Buat instance Client baru dengan semua event handler
// =====================================================================
function createClient() {
    const newClient = new Client({
        authStrategy: new LocalAuth({
            clientId: "mannx-bot",
            dataPath: "./.wwebjs_auth"
        }),
        puppeteer: {
            headless: true,
            args: PUPPETEER_ARGS,
        },
    });

    // --- Event: QR Code ---
    newClient.on("qr", (qr) => {
        console.log("[Bot] 📱 Scan QR Code berikut dengan WhatsApp HP Anda:");
        qrcodeTerminal.generate(qr, { small: true });
        QRCode.toDataURL(qr, (err, url) => {
            if (err) {
                console.error("[Bot] Gagal membuat QR base64:", err);
                return;
            }
            currentBotStatus = 'qr';
            lastQR = url;
            state.setBotStatus("qr", url);
            if (io) io.emit('bot_status', { status: currentBotStatus, qr: lastQR });
        });
    });

    // --- Event: Loading Screen ---
    newClient.on("loading_screen", (percent, message) => {
        console.log(`[Bot] ⌛ Memuat WhatsApp... ${percent}% - ${message}`);
        currentBotStatus = 'loading';
        if (state.botStatus !== "loading") state.setBotStatus("loading");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
    });

    // --- Event: Authenticated ---
    newClient.on("authenticated", () => {
        console.log("[Bot] 🔐 Autentikasi berhasil. Menunggu WhatsApp siap...");
        currentBotStatus = 'loading';
        state.setBotStatus("loading");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
    });

    // --- Event: Ready ---
    newClient.on("ready", () => {
        isRestarting = false;
        isInitializing = false;
        isInitialized = true;
        console.log("[Bot] ✅ WhatsApp Client siap! Bot aktif dan siap membalas pesan.");
        currentBotStatus = 'online';
        state.setBotStatus("online");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
    });

    // --- Event: Auth Failure ---
    newClient.on("auth_failure", async (msg) => {
        console.error("[Bot] ❌ Gagal autentikasi WhatsApp:", msg);
        currentBotStatus = 'offline';
        state.setBotStatus("offline");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
        cleanSessionFolder();

        if (isRestarting) return;
        isRestarting = true;

        await destroyClientSafely();
        console.log("[Bot] 🔄 Mencoba inisialisasi ulang setelah auth gagal dalam 5 detik...");
        scheduleRestart(5000);
    });

    // --- Event: Disconnected ---
    newClient.on("disconnected", async (reason) => {
        console.log(`[Bot] ⚠️ WhatsApp Client terputus. Alasan: ${reason}`);
        currentBotStatus = 'offline';
        state.setBotStatus("offline");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });

        if (isRestarting) {
            console.log("[Bot] Restart sudah dalam proses, melewati permintaan restart baru.");
            return;
        }
        isRestarting = true;

        await destroyClientSafely();

        if (reason === "LOGOUT") {
            console.log("[Bot] 🚪 Pengguna logout. Membersihkan sesi dan generate QR baru...");
            cleanSessionFolder();
            scheduleRestart(4000);
        } else {
            console.log("[Bot] 🔄 Mencoba reconnect dalam 10 detik...");
            scheduleRestart(10000);
        }
    });

    // --- Event: Message ---
    newClient.on("message", async (message) => {
        try {
            if (message.isGroup || message.from.includes("@g.us")) return;
            if (message.from === "status@broadcast") return;

            if (!state.aiEnabled) {
                console.log(`[Bot] Auto-respon mati. Melewati pesan dari ${message.from}`);
                return;
            }

            const body = message.body ? message.body.trim() : "";
            if (!body) return;

            console.log(`[Bot] 💬 Pesan dari ${message.from}: "${body}"`);

            // Tambahkan pesan user ke riwayat
            addMessageToHistory(message.from, "user", body);

            const knowledgeText = readKnowledgeText();
            const currentLocalTime = new Date().toLocaleString("id-ID", {
                timeZone: "Asia/Jakarta",
                weekday: "long", year: "numeric", month: "long", day: "numeric",
                hour: "2-digit", minute: "2-digit", second: "2-digit"
            });

            const genAI = getGenAI();
            if (!genAI) {
                await message.reply("Mohon maaf, sistem AI belum dikonfigurasi. Silakan hubungi Kantor Desa.");
                return;
            }

            const dynamicSystemInstruction = `Anda adalah staf pelayanan digital resmi Kantor Desa Badau yang cerdas, ramah, dan sangat praktis. 

Aturan Ketat Gaya Komunikasi di WhatsApp:
1. JANGAN PERNAH menggunakan kalimat robot seperti: "Berdasarkan data yang kami miliki", "Menurut basis data", "Berdasarkan knowledge.json", atau "Maaf, informasi tidak spesifik". Warga tidak perlu tahu Anda membaca file data!
2. Jawablah secara LANGSUNG (To The Point), santun, dan natural seperti manusia/staf desa asli yang sedang mengetik pesan. Gunakan panggilan "Bapak/Ibu/Kakak" agar hangat namun tetap sopan.
3. Jika warga bertanya posisi/lokasi Kantor Desa, langsung jawab bahwa lokasinya di Kecamatan Badau, lalu berikan link Google Maps resmi ini: https://maps.app.goo.gl/uXvYgqA8p9wEwPrC9 (Pastikan link ini selalu keluar saat ditanya lokasi/alamat).
4. Jika warga bertanya nama Kepala Desa (Kades), langsung sebutkan namanya dengan jelas di awal kalimat tanpa basa-basi formal yang panjang.
5. Jika ada informasi yang BENAR-BENAR tidak ada di data desa (seperti jam kerja yang belum tertulis), jangan jawab "Tidak ada data spesifik". Berpikirlah fleksibel! Jawab dengan estimasi umum kantor pemerintah atau arahkan dengan ramah, contoh: "Untuk jam operasional Kantor Desa Badau biasanya buka setiap hari Senin - Jumat pukul 08.00 s/d 16.00 WIB. Namun untuk memastikan layanan spesifik yang Kakak perlukan, Kakak bisa langsung datang ke kantor atau nanti kami bantu sambungkan ke kepala urusan terkait ya!"

Waktu Sistem Saat Ini: ${currentLocalTime}

Gunakan data internal Desa Badau ini sebagai panduan utama Anda:
${knowledgeText}`;

            const model = genAI.getGenerativeModel({
                model: GEMINI_MODEL,
                systemInstruction: dynamicSystemInstruction
            });

            let replyText = null;
            let lastError = null;
            const MAX_RETRIES = 2;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                    const chatHistory = chatHistories.get(message.from) || [];
                    const result = await Promise.race([
                        model.generateContent({
                            contents: chatHistory,
                            generationConfig: {
                                maxOutputTokens: 1000,
                                temperature: 0.3
                            }
                        }),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error("Gemini API timeout")), 20000)
                        )
                    ]);
                    replyText = result.response.text().trim();
                    if (replyText) break;
                } catch (err) {
                    lastError = err;
                    console.warn(`[Bot] ⚠️ Percobaan Gemini ke-${attempt} gagal: ${describeGeminiError(err)}`);
                    if (attempt < MAX_RETRIES) {
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                    }
                }
            }

            if (replyText) {
                // Tambahkan balasan model ke riwayat
                addMessageToHistory(message.from, "model", replyText);
                await message.reply(replyText);
                console.log(`[Bot] ✅ Balasan terkirim ke ${message.from}`);
            } else {
                const errorDetail = describeGeminiError(lastError);
                console.error("[Bot] ❌ Semua percobaan Gemini gagal:", errorDetail);
                if (lastError?.message?.includes("fetch failed") || lastError?.message?.includes("timeout")) {
                    await message.reply("Mohon maaf, jaringan internet di server chatbot sedang tidak stabil. Silakan coba kirim pertanyaan Anda kembali dalam beberapa saat.");
                } else if (lastError?.message?.includes("429") || lastError?.message?.includes("quota")) {
                    await message.reply("Mohon maaf, kuota layanan AI hari ini sudah habis. Silakan coba lagi besok atau hubungi Kantor Desa secara langsung.");
                } else {
                    await message.reply("Mohon maaf, sistem AI sedang mengalami gangguan teknis. Silakan coba kembali atau hubungi Kantor Desa secara langsung.");
                }
            }
        } catch (err) {
            console.error("[Bot] ❌ Error tak terduga saat memproses pesan:", err.message);
            if (!isPuppeteerError(err)) {
                try {
                    await message.reply("Mohon maaf, terjadi gangguan sementara. Silakan coba kembali beberapa saat lagi.");
                } catch (_) { /* abaikan jika frame sudah detached */ }
            }
        }
    });

    return newClient;
}

// =====================================================================
// Initialization & Lifecycle
// =====================================================================
async function initializeClient() {
    if (isInitializing) {
        console.warn("[Bot] ⚠️ WhatsApp Client sedang dalam proses inisialisasi. Mengabaikan...");
        return false;
    }
    if (isInitialized) {
        console.warn("[Bot] ⚠️ WhatsApp Client sudah aktif. Mengabaikan...");
        return false;
    }

    isInitializing = true;
    try {
        // Buat instance Client BARU setiap kali inisialisasi
        client = createClient();
        await client.initialize();
        isInitialized = true;
        isInitializing = false;
        return true;
    } catch (err) {
        isInitializing = false;
        isInitialized = false;
        throw err;
    }
}

async function closeBrowserPages(browser) {
    if (!browser?.pages) return;
    const pages = await browser.pages().catch(() => []);
    await Promise.allSettled(pages.map((page) => page.close().catch(() => {})));
}

async function waitForBrowserDisconnect(browser, timeoutMs = BROWSER_CLOSE_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    while (browser?.isConnected?.() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, BROWSER_POLL_INTERVAL_MS));
    }
    return !browser?.isConnected?.();
}

async function destroyClientSafely() {
    isInitializing = false;
    isInitialized = false;

    if (!client) return;

    // Simpan referensi lalu null-kan agar tidak ada race condition
    const clientToDestroy = client;
    client = null;

    const browser = clientToDestroy.pupBrowser;

    try {
        if (browser?.isConnected?.()) {
            await closeBrowserPages(browser);
        }

        await Promise.race([
            clientToDestroy.destroy(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("client.destroy() timeout")), BROWSER_CLOSE_TIMEOUT_MS)
            )
        ]);
    } catch (err) {
        console.warn("[Bot] destroy() gagal atau timeout:", err?.message || err);
        try {
            if (clientToDestroy.pupBrowser?.isConnected?.()) {
                await clientToDestroy.pupBrowser.close();
            }
        } catch (_) { /* abaikan error penutupan paksa */ }
    }

    const finalBrowser = clientToDestroy.pupBrowser;
    const disconnected = await waitForBrowserDisconnect(finalBrowser);
    if (!disconnected && finalBrowser?.isConnected?.()) {
        console.warn("[Bot] Browser masih terhubung — memaksa close() akhir.");
        try { await finalBrowser.close(); } catch (_) {}
        await waitForBrowserDisconnect(finalBrowser, 5000);
    }
}

function scheduleRestart(delayMs) {
    setTimeout(() => restartBot(), delayMs);
}

function restartBot() {
    console.log("[Bot] 🔄 Memulai ulang koneksi WhatsApp...");
    currentBotStatus = 'loading';
    state.setBotStatus("loading");
    if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
    initializeClient().catch((err) => {
        if (err.message?.includes("already running")) {
            console.warn("[Bot] ⚠️ Browser masih berjalan dari sesi lama. Menunggu 15 detik lagi...");
            isRestarting = true;
            scheduleRestart(15000);
            return;
        }
        if (err.message?.includes("ERR_NAME_NOT_RESOLVED")) {
            console.warn("[Bot] ⚠️ Tidak ada koneksi internet ke WhatsApp. Coba lagi dalam 15 detik...");
            isRestarting = true;
            scheduleRestart(15000);
            return;
        }
        console.error("[Bot] ❌ Gagal restart:", err.message);
        currentBotStatus = 'offline';
        state.setBotStatus("offline");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
        isRestarting = false;
    });
}

// =====================================================================
// Chat History Helper Functions
// =====================================================================
function addMessageToHistory(userId, role, text) {
    if (!chatHistories.has(userId)) {
        chatHistories.set(userId, []);
    }
    const history = chatHistories.get(userId);
    history.push({ role, parts: [{ text }] });

    // Gabungkan pesan berurutan dengan role sama & pastikan riwayat dimulai dengan 'user'
    const sanitized = [];
    for (const msg of history) {
        if (sanitized.length === 0) {
            if (msg.role === "user") {
                sanitized.push({ role: msg.role, parts: [{ text: msg.parts[0].text }] });
            }
            continue;
        }
        const lastMsg = sanitized[sanitized.length - 1];
        if (lastMsg.role === msg.role) {
            lastMsg.parts[0].text += "\n" + msg.parts[0].text;
        } else {
            sanitized.push({ role: msg.role, parts: [{ text: msg.parts[0].text }] });
        }
    }

    // Batasi panjang riwayat maksimal MAX_HISTORY_LENGTH
    while (sanitized.length > MAX_HISTORY_LENGTH) {
        sanitized.shift();
    }

    // Pastikan riwayat setelah pemotongan tetap diawali dengan "user"
    while (sanitized.length > 0 && sanitized[0].role !== "user") {
        sanitized.shift();
    }

    chatHistories.set(userId, sanitized);
}

// =====================================================================
// Fungsi Logout Manual dari Web Dashboard (BARU)
// =====================================================================
async function logoutAndRestart() {
    if (isRestarting) {
        console.log("[Bot] ⚠️ Proses restart sudah berjalan.");
        return;
    }
    isRestarting = true;

    console.log("[Bot] 🔄 Logout manual dari dashboard web...");
    currentBotStatus = 'loading';
    state.setBotStatus("loading");
    if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });

    await destroyClientSafely();
    cleanSessionFolder();

    console.log("[Bot] 🧹 Sesi dihapus. Membuat QR baru dalam 3 detik...");
    scheduleRestart(3000);
}

// =====================================================================
// Entry Point — Dipanggil dari index.js
// =====================================================================
function initializeBot(socketIoParam) {
    io = socketIoParam;
    state.io = io; // pastikan state.io terisi
    isRestarting = false;
    currentBotStatus = 'loading';
    state.setBotStatus("loading");
    if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
    
    // Listener khusus ketika ada client Socket.io baru konek agar LANGSUNG dikirimi status terbaru
    io.on('connection', (socket) => {
        socket.emit('bot_status', { status: currentBotStatus, qr: lastQR });
    });

    console.log("[Bot] 🔄 Menginisialisasi WhatsApp Client...");
    initializeClient().catch((err) => {
        console.error("[Bot] ❌ Inisialisasi pertama gagal:", err.message);
        currentBotStatus = 'offline';
        state.setBotStatus("offline");
        if (io) io.emit('bot_status', { status: currentBotStatus, qr: '' });
    });
}

module.exports = { initializeBot, logoutAndRestart, getCurrentBotStatus: () => currentBotStatus, getLastQR: () => lastQR };
