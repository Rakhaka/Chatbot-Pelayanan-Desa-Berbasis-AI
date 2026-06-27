const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const state = require("./state");
const { GEMINI_MODEL, getGenAI, describeGeminiError, isGeminiRecitationError } = require("./gemini");
const { readKnowledgeText } = require("./knowledge");

const BROWSER_CLOSE_TIMEOUT_MS = 15000;
const BROWSER_POLL_INTERVAL_MS = 200;
const READY_TIMEOUT_MS = 90000;

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
let readyWatchdog = null;
let io = null;

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "mannx-bot",
        dataPath: "./.wwebjs_auth"
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ],
    },
});

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
        await client.initialize();
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
    const browser = client.pupBrowser;

    try {
        if (browser?.isConnected?.()) {
            await closeBrowserPages(browser);
        }

        await Promise.race([
            client.destroy(),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error("client.destroy() timeout")), BROWSER_CLOSE_TIMEOUT_MS)
            )
        ]);
    } catch (err) {
        console.warn("[Bot] destroy() gagal atau timeout:", err?.message || err);
        try {
            if (client.pupBrowser?.isConnected?.()) {
                await client.pupBrowser.close();
            }
        } catch (_) { /* abaikan error penutupan paksa */ }
    }

    const disconnected = await waitForBrowserDisconnect(client.pupBrowser);
    if (!disconnected && client.pupBrowser?.isConnected?.()) {
        console.warn("[Bot] Browser masih terhubung — memaksa close() akhir.");
        try { await client.pupBrowser.close(); } catch (_) {}
        await waitForBrowserDisconnect(client.pupBrowser, 5000);
    }
}

function scheduleRestart(delayMs) {
    setTimeout(() => restartBot(), delayMs);
}

function clearReadyWatchdog() {
    if (readyWatchdog) {
        clearTimeout(readyWatchdog);
        readyWatchdog = null;
    }
}

function armReadyWatchdog(source) {
    clearReadyWatchdog();
    readyWatchdog = setTimeout(async () => {
        if (isInitialized) return;

        console.warn(`[Bot] WhatsApp belum ready setelah ${READY_TIMEOUT_MS / 1000} detik sejak ${source}. Mencoba restart koneksi...`);
        isRestarting = true;
        state.setBotStatus("offline");

        try {
            await destroyClientSafely();
        } catch (err) {
            console.warn("[Bot] Gagal destroy saat ready watchdog:", err?.message || err);
        }

        console.warn("[Bot] Jika kondisi ini berulang, sesi WhatsApp lokal mungkin perlu scan QR ulang.");
        scheduleRestart(5000);
    }, READY_TIMEOUT_MS);
}

client.on("qr", (qr) => {
    console.log("[Bot] 📱 Scan QR Code berikut dengan WhatsApp HP Anda:");
    qrcodeTerminal.generate(qr, { small: true });
    QRCode.toDataURL(qr, (err, url) => {
        if (err) {
            console.error("[Bot] Gagal membuat QR base64:", err);
            return;
        }
        state.setBotStatus("qr", url);
    });
});

client.on("loading_screen", (percent, message) => {
    console.log(`[Bot] ⌛ Memuat WhatsApp... ${percent}% - ${message}`);
    if (!isInitialized && state.botStatus !== "loading") state.setBotStatus("loading");
    armReadyWatchdog("loading_screen");
});

client.on("authenticated", () => {
    console.log("[Bot] 🔐 Autentikasi berhasil. Menunggu WhatsApp siap...");
    state.setBotStatus("loading");
    armReadyWatchdog("authenticated");
});

client.on("ready", () => {
    clearReadyWatchdog();
    isRestarting = false;
    isInitializing = false;
    isInitialized = true;
    console.log("[Bot] ✅ WhatsApp Client siap! Bot aktif dan siap membalas pesan.");
    state.setBotStatus("online");
});

client.on("auth_failure", async (msg) => {
    clearReadyWatchdog();
    console.error("[Bot] ❌ Gagal autentikasi WhatsApp:", msg);
    state.setBotStatus("offline");
    cleanSessionFolder();

    if (isRestarting) return;
    isRestarting = true;

    await destroyClientSafely();
    console.log("[Bot] 🔄 Mencoba inisialisasi ulang setelah auth gagal dalam 5 detik...");
    scheduleRestart(5000);
});

client.on("disconnected", async (reason) => {
    clearReadyWatchdog();
    console.log(`[Bot] ⚠️ WhatsApp Client terputus. Alasan: ${reason}`);
    state.setBotStatus("offline");

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

function restartBot() {
    console.log("[Bot] 🔄 Memulai ulang koneksi WhatsApp...");
    state.setBotStatus("loading");
    armReadyWatchdog("restartBot");
    initializeClient().then((started) => {
        if (!started && isInitialized) {
            clearReadyWatchdog();
            console.warn("[Bot] Restart diminta, tetapi client masih aktif. Mengembalikan status online.");
            isRestarting = false;
            state.setBotStatus("online");
        }
    }).catch((err) => {
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
        state.setBotStatus("offline");
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

function isSimpleGreeting(text) {
    return /^(p|ping|halo|hallo|hai|hi|hello|assalamualaikum|assalamu'?alaikum|selamat\s+(pagi|siang|sore|malam))[\s.!?]*$/i.test(text);
}

function getSimpleGreetingReply() {
    return "Halo Kak, ada yang bisa kami bantu terkait layanan atau informasi Desa Badau?";
}

function getGeminiFallbackReply(err, body) {
    if (isGeminiRecitationError(err)) {
        if (isSimpleGreeting(body)) return getSimpleGreetingReply();
        return "Mohon maaf Kak, sistem AI sedang membatasi jawaban otomatis untuk pesan tersebut. Bisa tulis ulang pertanyaannya dengan lebih spesifik terkait layanan atau informasi Desa Badau?";
    }
    return null;
}

client.on("message", async (message) => {
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

        if (isSimpleGreeting(body)) {
            const greetingReply = getSimpleGreetingReply();
            addMessageToHistory(message.from, "model", greetingReply);
            await message.reply(greetingReply);
            console.log(`[Bot] Balasan sapaan terkirim ke ${message.from}`);
            return;
        }

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
                const fallbackReply = getGeminiFallbackReply(err, body);
                if (fallbackReply) {
                    replyText = fallbackReply;
                    break;
                }
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

function initializeBot(socketIoParam) {
    io = socketIoParam;
    state.io = io; // pastikan state.io terisi
    isRestarting = false;
    state.setBotStatus("loading");
    console.log("[Bot] 🔄 Menginisialisasi WhatsApp Client...");
    armReadyWatchdog("initializeBot");
    initializeClient().catch((err) => {
        clearReadyWatchdog();
        console.error("[Bot] ❌ Inisialisasi pertama gagal:", err.message);
        state.setBotStatus("offline");
        isRestarting = false;
    });
}

module.exports = { initializeBot };
