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

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "mannx-bot",
        dataPath: "./.wwebjs_auth"
    }),
    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--dns-prefetch-disable",
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ],
    },
});

let isRestarting = false;

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
    if (state.botStatus !== "loading") state.setBotStatus("loading");
});

client.on("authenticated", () => {
    console.log("[Bot] 🔐 Autentikasi berhasil. Menunggu WhatsApp siap...");
});

client.on("ready", () => {
    isRestarting = false;
    console.log("[Bot] ✅ WhatsApp Client siap! Bot aktif dan siap membalas pesan.");
    state.setBotStatus("online");
});

client.on("auth_failure", async (msg) => {
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
    client.initialize().catch((err) => {
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
                const result = await Promise.race([
                    model.generateContent({
                        contents: [{ role: "user", parts: [{ text: body }] }],
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

function initializeBot() {
    isRestarting = false;
    state.setBotStatus("loading");
    console.log("[Bot] 🔄 Menginisialisasi WhatsApp Client...");
    client.initialize().catch((err) => {
        console.error("[Bot] ❌ Inisialisasi pertama gagal:", err.message);
        state.setBotStatus("offline");
    });
}

module.exports = { initializeBot };
