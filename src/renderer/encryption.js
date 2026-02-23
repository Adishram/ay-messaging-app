// ── End-to-End Encryption Module ──────────────────────────────────
// Uses the Web Crypto API (SubtleCrypto) built into Chromium/Electron.
// AES-256-GCM for message encryption, PBKDF2 for key derivation,
// ECDH (P-256) for key exchange between conversation participants.

const Encryption = {
    // ── Key Pair Management ─────────────────────────────────────────

    /**
     * Generate an ECDH key pair for the current user.
     * The public key is shared via the Appwrite users collection.
     * The private key stays in localStorage (never leaves the device).
     */
    async generateKeyPair() {
        const keyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true, // extractable
            ['deriveKey', 'deriveBits']
        );
        return keyPair;
    },

    /**
     * Export a public key to base64 (to store in Appwrite).
     */
    async exportPublicKey(publicKey) {
        const raw = await crypto.subtle.exportKey('raw', publicKey);
        return this._arrayBufferToBase64(raw);
    },

    /**
     * Import a public key from base64 (from Appwrite).
     */
    async importPublicKey(base64Key) {
        const raw = this._base64ToArrayBuffer(base64Key);
        return await crypto.subtle.importKey(
            'raw',
            raw,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            []
        );
    },

    /**
     * Export a private key to JWK for secure local storage.
     */
    async exportPrivateKey(privateKey) {
        return await crypto.subtle.exportKey('jwk', privateKey);
    },

    /**
     * Import a private key from JWK.
     */
    async importPrivateKey(jwk) {
        return await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey', 'deriveBits']
        );
    },

    // ── Shared Secret Derivation ────────────────────────────────────

    /**
     * Derive a shared AES-256-GCM key from your private key + their public key.
     * This is the magic of ECDH: both sides derive the same shared secret
     * without ever transmitting it.
     */
    async deriveSharedKey(myPrivateKey, theirPublicKey) {
        return await crypto.subtle.deriveKey(
            {
                name: 'ECDH',
                public: theirPublicKey,
            },
            myPrivateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    // ── Message Encryption / Decryption ─────────────────────────────

    /**
     * Encrypt a plaintext message using AES-256-GCM.
     * Returns a base64 string containing iv + ciphertext.
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

        // Pack iv + ciphertext together
        const packed = new Uint8Array(iv.length + ciphertext.byteLength);
        packed.set(iv, 0);
        packed.set(new Uint8Array(ciphertext), iv.length);

        return this._arrayBufferToBase64(packed.buffer);
    },

    /**
     * Decrypt an encrypted message using AES-256-GCM.
     * Input is the base64 string from encryptMessage().
     */
    async decryptMessage(sharedKey, encryptedBase64) {
        const packed = new Uint8Array(this._base64ToArrayBuffer(encryptedBase64));

        // Extract iv (first 12 bytes) and ciphertext (rest)
        const iv = packed.slice(0, 12);
        const ciphertext = packed.slice(12);

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            ciphertext
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    },

    /**
     * Save the user's key pair to localStorage.
     * Private key is encrypted via OS keychain (safeStorage) before storage (P2 #8).
     */
    async saveKeyPairLocally(userId, keyPair) {
        const publicKeyB64 = await this.exportPublicKey(keyPair.publicKey);
        const privateKeyJwk = await this.exportPrivateKey(keyPair.privateKey);
        const privateKeyStr = JSON.stringify(privateKeyJwk);

        localStorage.setItem(`ay_pubkey_${userId}`, publicKeyB64);

        // Encrypt private key with OS keychain if available
        if (window.electronAPI && window.electronAPI.safeStorageEncrypt) {
            try {
                const encrypted = await window.electronAPI.safeStorageEncrypt(privateKeyStr);
                if (encrypted) {
                    localStorage.setItem(`ay_privkey_${userId}`, 'encrypted:' + encrypted);
                    return;
                }
            } catch (e) {
                console.warn('safeStorage encrypt failed, falling back to plain:', e);
            }
        }
        // Fallback: store as plain JSON
        localStorage.setItem(`ay_privkey_${userId}`, privateKeyStr);
    },

    /**
     * Load the user's key pair from localStorage.
     * Decrypts private key via safeStorage if it was encrypted.
     */
    async loadKeyPairLocally(userId) {
        const publicKeyB64 = localStorage.getItem(`ay_pubkey_${userId}`);
        const privateKeyRaw = localStorage.getItem(`ay_privkey_${userId}`);

        if (!publicKeyB64 || !privateKeyRaw) return null;

        try {
            let privateKeyStr = privateKeyRaw;

            // Decrypt if encrypted with safeStorage
            if (privateKeyRaw.startsWith('encrypted:')) {
                if (window.electronAPI && window.electronAPI.safeStorageDecrypt) {
                    const decrypted = await window.electronAPI.safeStorageDecrypt(
                        privateKeyRaw.substring('encrypted:'.length)
                    );
                    if (decrypted) {
                        privateKeyStr = decrypted;
                    } else {
                        console.warn('safeStorage decrypt returned null');
                        return null;
                    }
                } else {
                    console.warn('Private key is encrypted but safeStorage unavailable');
                    return null;
                }
            }

            const publicKey = await this.importPublicKey(publicKeyB64);
            const privateKey = await this.importPrivateKey(JSON.parse(privateKeyStr));
            return { publicKey, privateKey };
        } catch (e) {
            console.error('Failed to load keys:', e);
            return null;
        }
    },

    /**
     * Get or create the user's key pair.
     * If keys exist in localStorage, load them.
     * Otherwise, generate new ones and save.
     */
    async getOrCreateKeyPair(userId) {
        let keyPair = await this.loadKeyPairLocally(userId);
        if (keyPair) return keyPair;

        keyPair = await this.generateKeyPair();
        await this.saveKeyPairLocally(userId, keyPair);
        return keyPair;
    },

    // ── Shared Key Cache ────────────────────────────────────────────
    // Cache derived shared keys per peer to avoid re-deriving on every message.

    _sharedKeyCache: new Map(),

    async getSharedKey(myPrivateKey, theirPublicKeyBase64) {
        if (this._sharedKeyCache.has(theirPublicKeyBase64)) {
            return this._sharedKeyCache.get(theirPublicKeyBase64);
        }

        const theirPublicKey = await this.importPublicKey(theirPublicKeyBase64);
        const sharedKey = await this.deriveSharedKey(myPrivateKey, theirPublicKey);
        this._sharedKeyCache.set(theirPublicKeyBase64, sharedKey);
        return sharedKey;
    },

    clearCache() {
        this._sharedKeyCache.clear();
    },

    // ── Utility ─────────────────────────────────────────────────────

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
