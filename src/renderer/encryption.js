// ── End-to-End Encryption Module ──────────────────────────────────
// Uses Web Crypto API: ECDH (P-256) for key exchange, AES-256-GCM for message encryption.
// Adapted for P2P identity (hex-encoded keys from identity.js).

const Encryption = {
    _sharedKeyCache: new Map(),

    // ── Derive shared AES-256-GCM key from ECDH ────────────────────────

    /**
     * Derive a shared key for a specific peer.
     * Uses the local private key (base64 PKCS8) and remote public key (hex raw).
     * Results are cached per remotePubKeyHex.
     */
    async deriveSharedKeyFor(privKeyB64, remotePubKeyHex) {
        if (this._sharedKeyCache.has(remotePubKeyHex)) {
            return this._sharedKeyCache.get(remotePubKeyHex);
        }

        const remotePubKeyBuf = hexToBuf(remotePubKeyHex);
        const remotePubKey = await crypto.subtle.importKey(
            'raw', remotePubKeyBuf,
            { name: 'ECDH', namedCurve: 'P-256' },
            false, []
        );

        const myPrivKeyBuf = base64ToBuf(privKeyB64);
        const myPrivKey = await crypto.subtle.importKey(
            'pkcs8', myPrivKeyBuf,
            { name: 'ECDH', namedCurve: 'P-256' },
            false, ['deriveKey', 'deriveBits']
        );

        const sharedKey = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: remotePubKey },
            myPrivKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );

        this._sharedKeyCache.set(remotePubKeyHex, sharedKey);
        return sharedKey;
    },

    // ── Message Encryption / Decryption ─────────────────────────────────

    /**
     * Encrypt a plaintext message using AES-256-GCM.
     * Returns { ciphertext (base64), iv (base64) } as separate fields.
     */
    async encryptMessage(sharedKey, plaintext) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);

        // Generate a random 12-byte IV for each message
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const ciphertext = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            data
        );

        return {
            ciphertext: this._arrayBufferToBase64(ciphertext),
            iv: this._arrayBufferToBase64(iv.buffer),
        };
    },

    /**
     * Decrypt an encrypted message using AES-256-GCM.
     * Input: ciphertext (base64), iv (base64).
     */
    async decryptMessage(sharedKey, ciphertextB64, ivB64) {
        const ciphertext = this._base64ToArrayBuffer(ciphertextB64);
        const iv = new Uint8Array(this._base64ToArrayBuffer(ivB64));

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            ciphertext
        );

        return new TextDecoder().decode(decrypted);
    },

    clearCache() {
        this._sharedKeyCache.clear();
    },

    // ── Utility ─────────────────────────────────────────────────────────

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
