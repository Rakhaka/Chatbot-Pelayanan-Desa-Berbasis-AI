// src/state.js
const EventEmitter = require('events');

class SharedState extends EventEmitter {
    constructor() {
        super();
        this.botStatus = 'offline'; // 'offline', 'loading', 'qr', 'online'
        this.qrCode = ''; // Base64 QR code image
        this.aiEnabled = true; // Auto-response status
        this.io = null; // Socket.io server instance reference
    }

    setBotStatus(status, qr = '') {
        this.botStatus = status;
        this.qrCode = qr;
        if (this.io) {
            this.io.emit('bot_status', {
                status: this.botStatus,
                qr: this.qrCode
            });
        }
        this.emit('status_change', { status, qr });
    }

    setAiEnabled(enabled) {
        this.aiEnabled = enabled;
        if (this.io) {
            this.io.emit('ai_toggle', {
                enabled: this.aiEnabled
            });
        }
        this.emit('ai_change', enabled);
    }

    getSnapshot() {
        return {
            status: this.botStatus,
            qr: this.qrCode,
            aiEnabled: this.aiEnabled
        };
    }
}

module.exports = new SharedState();
