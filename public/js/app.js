// public/js/app.js

// Referensi Elemen DOM
const loadingScreen = document.getElementById('loading-screen');
const loginContainer = document.getElementById('login-container');
const dashboardContainer = document.getElementById('dashboard-container');
const loginForm = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');
const loginErrorMsg = document.getElementById('login-error-msg');
const logoutBtn = document.getElementById('logout-btn');

// Komponen Status Bot
const statusIconContainer = document.getElementById('status-icon-container');
const statusIcon = document.getElementById('status-icon');
const statusPulse = document.getElementById('status-pulse');
const statusBadge = document.getElementById('status-badge');
const statusDesc = document.getElementById('status-desc');
const qrContainer = document.getElementById('qr-container');
const qrImage = document.getElementById('qr-image');

// Komponen Kontrol AI
const aiToggle = document.getElementById('ai-toggle');
const aiToggleDesc = document.getElementById('ai-toggle-desc');

// Komponen AI-Driven Data Update
const aiCommandInput = document.getElementById('ai-command-input');
const executeAiUpdateBtn = document.getElementById('execute-ai-update-btn');
const editorError = document.getElementById('editor-error');
const editorErrorMsg = document.getElementById('editor-error-msg');
const editorSuccess = document.getElementById('editor-success');

// State Client
let isAuthenticated = false;
let socket = null;

// Mulai Autentikasi Saat Halaman Dimuat
document.addEventListener('DOMContentLoaded', checkAuthStatus);

// Cek Status Auth
async function checkAuthStatus() {
    showLoading(true, 'Memeriksa status login...');
    try {
        const response = await fetch('/api/auth-status');
        const data = await response.json();
        
        if (data.authenticated) {
            isAuthenticated = true;
            showView('dashboard');
            initSocket();
        } else {
            isAuthenticated = false;
            showView('login');
        }
    } catch (err) {
        console.error('Gagal mengecek status auth:', err);
        showView('login');
    } finally {
        showLoading(false);
    }
}

// Handler Submit Form Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    
    const username = usernameInput.value;
    const password = passwordInput.value;
    
    showLoading(true, 'Mencoba login...');
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
            isAuthenticated = true;
            loginForm.reset();
            showView('dashboard');
            initSocket();
        } else {
            showLoginError(data.error || 'Terjadi kesalahan sistem.');
        }
    } catch (err) {
        showLoginError('Gagal terhubung ke server.');
        console.error(err);
    } finally {
        showLoading(false);
    }
});

// Handler Logout
logoutBtn.addEventListener('click', async () => {
    showLoading(true, 'Mengakhiri sesi...');
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        const data = await response.json();
        if (response.ok && data.success) {
            isAuthenticated = false;
            if (socket) {
                socket.disconnect();
                socket = null;
            }
            showView('login');
        } else {
            alert('Gagal logout, silakan coba lagi.');
        }
    } catch (err) {
        console.error('Error logout:', err);
        alert('Gagal menghubungi server untuk logout.');
    } finally {
        showLoading(false);
    }
});

// --- Inisialisasi Socket.io ---
function initSocket() {
    if (socket) return; // Mencegah inisialisasi ganda
    
    socket = io();
    
    // Dengarkan Perubahan Status Bot
    socket.on('bot_status', (data) => {
        updateBotStatusUI(data.status, data.qr);
    });
    
    // Dengarkan Perubahan AI Toggle
    socket.on('ai_toggle', (data) => {
        aiToggle.checked = data.enabled;
        updateAiToggleText(data.enabled);
    });

    socket.on('connect_error', () => {
        console.warn('Socket terputus dari backend.');
        updateBotStatusUI('offline');
    });
}

// --- Logika Update UI Status Bot ---
function updateBotStatusUI(status, qrData = '') {
    // Reset Kelas
    statusIconContainer.className = 'relative flex items-center justify-center w-28 h-28 rounded-full mb-4 transition-all duration-300';
    statusIcon.className = 'fa-solid text-4xl';
    statusPulse.className = 'absolute -top-1 -right-1 flex h-4 w-4';
    statusBadge.className = 'px-3.5 py-1 text-xs font-semibold rounded-full mb-2';
    
    if (status === 'online') {
        // Online: Emerald Green
        statusIconContainer.classList.add('bg-emerald-100', 'text-emerald-600', 'shadow-lg', 'shadow-emerald-50');
        statusIcon.classList.add('fa-circle-check');
        statusPulse.classList.remove('hidden');
        statusPulse.querySelector('span:first-child').className = 'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-emerald-400';
        statusPulse.querySelector('span:last-child').className = 'relative inline-flex rounded-full h-4 w-4 bg-emerald-500';
        
        statusBadge.classList.add('bg-emerald-100', 'text-emerald-700');
        statusBadge.innerText = 'Online';
        statusDesc.innerText = 'WhatsApp Bot aktif dan siap melayani chat warga.';
        qrContainer.classList.add('hidden');
        qrImage.src = '';
    } 
    else if (status === 'qr') {
        // QR Code: Amber/Yellow
        statusIconContainer.classList.add('bg-amber-100', 'text-amber-600');
        statusIcon.classList.add('fa-qrcode');
        statusPulse.classList.add('hidden');
        
        statusBadge.classList.add('bg-amber-100', 'text-amber-700');
        statusBadge.innerText = 'Menunggu Scan';
        statusDesc.innerText = 'Scan QR Code dengan WhatsApp di HP Anda untuk menghubungkan bot.';
        
        if (qrData) {
            qrContainer.classList.remove('hidden');
            qrContainer.classList.add('flex');
            qrImage.src = qrData;
        } else {
            qrContainer.classList.add('hidden');
        }
    } 
    else if (status === 'loading') {
        // Loading: Blue
        statusIconContainer.classList.add('bg-blue-100', 'text-blue-600');
        statusIcon.classList.add('fa-circle-notch', 'animate-spin');
        statusPulse.classList.add('hidden');
        
        statusBadge.classList.add('bg-blue-100', 'text-blue-700');
        statusBadge.innerText = 'Menghubungkan';
        statusDesc.innerText = 'Membuka sesi WhatsApp dan menyiapkan sistem...';
        qrContainer.classList.add('hidden');
        qrImage.src = '';
    } 
    else {
        // Offline / Error: Red
        statusIconContainer.classList.add('bg-red-100', 'text-red-500');
        statusIcon.classList.add('fa-power-off');
        statusPulse.classList.add('hidden');
        
        statusBadge.classList.add('bg-red-100', 'text-red-700');
        statusBadge.innerText = 'Offline';
        statusDesc.innerText = 'WhatsApp Bot terputus dari server atau sesi tidak aktif.';
        qrContainer.classList.add('hidden');
        qrImage.src = '';
    }
}

// --- Kontrol AI Toggle Switch ---
aiToggle.addEventListener('change', async function() {
    const isChecked = this.checked;
    updateAiToggleText(isChecked);
    
    try {
        const response = await fetch('/api/toggle-bot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: isChecked })
        });
        if (!response.ok) {
            alert('Gagal memperbarui status auto-respon bot di server.');
            // Revert UI jika gagal
            this.checked = !isChecked;
            updateAiToggleText(!isChecked);
        }
    } catch (err) {
        console.error('Error toggle bot:', err);
        alert('Gagal menghubungi server.');
        this.checked = !isChecked;
        updateAiToggleText(!isChecked);
    }
});

function updateAiToggleText(enabled) {
    if (enabled) {
        aiToggleDesc.innerText = 'Respon chatbot aktif secara otomatis.';
        aiToggleDesc.className = 'text-xs text-emerald-600 mt-0.5';
    } else {
        aiToggleDesc.innerText = 'Auto-respon mati. Bot dihentikan.';
        aiToggleDesc.className = 'text-xs text-red-500 mt-0.5';
    }
}

// --- Logika AI-Driven Data Update ---

executeAiUpdateBtn.addEventListener('click', async () => {
    editorError.classList.add('hidden');
    editorSuccess.classList.add('hidden');

    const command = aiCommandInput.value.trim();
    if (!command) {
        showEditorMessage('error', 'Silakan ketik perintah pembaruan data terlebih dahulu.');
        aiCommandInput.focus();
        return;
    }

    executeAiUpdateBtn.disabled = true;
    executeAiUpdateBtn.classList.add('opacity-60', 'cursor-not-allowed');
    showLoading(true, 'AI sedang memproses perintah Anda...');

    try {
        const response = await fetch('/api/knowledge/ai-update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showEditorMessage('success');
            aiCommandInput.value = '';
        } else {
            showEditorMessage('error', data.error || 'Gagal memproses pembaruan data via AI.');
        }
    } catch (err) {
        console.error(err);
        showEditorMessage('error', 'Gagal menghubungi server. Periksa koneksi Anda.');
    } finally {
        executeAiUpdateBtn.disabled = false;
        executeAiUpdateBtn.classList.remove('opacity-60', 'cursor-not-allowed');
        showLoading(false);
    }
});

// Pembantu Menampilkan Pesan Sukses / Error Editor
function showEditorMessage(type, msg = '') {
    editorError.classList.add('hidden');
    editorSuccess.classList.add('hidden');
    
    if (type === 'success') {
        editorSuccess.classList.remove('hidden');
        setTimeout(() => {
            editorSuccess.classList.add('hidden');
        }, 5000);
    } else {
        editorErrorMsg.innerText = msg;
        editorError.classList.remove('hidden');
    }
}

// --- Pembantu UI Kontainer / View ---
function showView(view) {
    if (view === 'login') {
        loginContainer.classList.remove('hidden');
        dashboardContainer.classList.add('hidden');
    } else {
        loginContainer.classList.add('hidden');
        dashboardContainer.classList.remove('hidden');
    }
}

function showLoading(show, message = 'Mohon tunggu...') {
    if (show) {
        loadingScreen.querySelector('p').innerText = message;
        loadingScreen.classList.remove('hidden');
        loadingScreen.classList.add('opacity-100');
    } else {
        loadingScreen.classList.add('hidden');
        loadingScreen.classList.remove('opacity-100');
    }
}

function showLoginError(msg) {
    loginErrorMsg.innerText = msg;
    loginError.classList.remove('hidden');
}
