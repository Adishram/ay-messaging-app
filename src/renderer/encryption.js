// ── Encryption Module (Simplified) ──────────────────────────────
// Transport encryption is handled by Hyperswarm's Noise protocol.
// This module is kept for any future local encryption needs.

const Encryption = {
    // Utility — kept for potential future use (e.g., encrypting local DB)

    _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    _base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    },
};
