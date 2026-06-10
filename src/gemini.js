const { GoogleGenerativeAI } = require('@google/generative-ai');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

const DATA_PARSER_SYSTEM_INSTRUCTION = `Tugas Anda adalah membaca data JSON desa saat ini dan memperbaruinya berdasarkan perintah dari admin. Jika perintahnya mengubah data yang sudah ada (seperti nama kades), timpa nilainya. Jika perintahnya berisi informasi baru (seperti koperasi), buat key-value baru yang sesuai di dalam objek. KELUARKAN HASIL AKHIRNYA HANYA BERUPA KODE JSON BERSIH YANG SUDAH DIPERBARUI, TANPA BASA-BASI, TANPA TANDA BACKTICK MARCDOWN.`;

let genAIInstance = null;

function getGenAI() {
    if (!process.env.GEMINI_API_KEY) return null;
    if (!genAIInstance) {
        genAIInstance = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return genAIInstance;
}

function describeGeminiError(err) {
    const msg = err?.message || String(err);
    if (msg.includes('404') || msg.includes('not found')) {
        return `Model "${GEMINI_MODEL}" tidak tersedia. Periksa nama model di .env (GEMINI_MODEL=gemini-3.1-flash-lite).`;
    }
    if (msg.includes('429') || msg.includes('quota') || msg.includes('Quota exceeded')) {
        return `Kuota API habis untuk model ${GEMINI_MODEL}. Reset kuota tengah malam Waktu Pasifik (~15:00-16:00 WIB).`;
    }
    return msg;
}

function extractJsonFromGeminiResponse(text) {
    let cleaned = (text || '').trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
}

module.exports = {
    GEMINI_MODEL,
    DATA_PARSER_SYSTEM_INSTRUCTION,
    getGenAI,
    describeGeminiError,
    extractJsonFromGeminiResponse
};
