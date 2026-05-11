// fileTransfer.js — File transfer over Hyperswarm streams
// Files are chunked and sent as base64 over the JSON message protocol

const FileTransfer = {
    pendingReceive: new Map(), // fileId → { meta, chunks: [], received: 0 }
    CHUNK_SIZE: 48 * 1024, // 48KB per chunk (safe for JSON serialization)

    // ── Send a file ─────────────────────────────────────────────────

    async sendFile(remotePubKeyHex, file) {
        const fileId = crypto.randomUUID();
        const totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);

        // Send metadata first
        P2P.sendRaw(remotePubKeyHex, {
            type: 'file-meta',
            fileId,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            totalChunks,
        });

        // Read and send chunks
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.CHUNK_SIZE;
            const end = Math.min(start + this.CHUNK_SIZE, file.size);
            const chunk = bytes.slice(start, end);

            // Encode chunk as base64
            const base64 = this._uint8ToBase64(chunk);

            P2P.sendRaw(remotePubKeyHex, {
                type: 'file-chunk',
                fileId,
                index: i,
                data: base64,
            });

            // Small delay between chunks to avoid overwhelming the stream
            if (i % 5 === 4) {
                await new Promise(r => setTimeout(r, 10));
            }
        }

        console.log(`[FileTransfer] Sent ${file.name} (${totalChunks} chunks)`);
        return fileId;
    },

    // ── Receive handlers ────────────────────────────────────────────

    handleMeta(remotePubKeyHex, msg) {
        console.log(`[FileTransfer] Receiving ${msg.name} (${msg.totalChunks} chunks)`);
        this.pendingReceive.set(msg.fileId, {
            from: remotePubKeyHex,
            meta: {
                name: msg.name,
                size: msg.size,
                mimeType: msg.mimeType,
                totalChunks: msg.totalChunks,
            },
            chunks: new Array(msg.totalChunks),
            received: 0,
        });
    },

    handleChunk(remotePubKeyHex, msg) {
        const pending = this.pendingReceive.get(msg.fileId);
        if (!pending) return;

        pending.chunks[msg.index] = this._base64ToUint8(msg.data);
        pending.received++;

        // Check if complete
        if (pending.received >= pending.meta.totalChunks) {
            this._assembleFile(msg.fileId, pending);
        }
    },

    _assembleFile(fileId, pending) {
        // Concatenate all chunks
        const totalSize = pending.chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of pending.chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        // Create blob URL
        const blob = new Blob([result], { type: pending.meta.mimeType });
        const url = URL.createObjectURL(blob);

        console.log(`[FileTransfer] Assembled ${pending.meta.name} (${totalSize} bytes)`);

        // Dispatch event for chat.js to handle
        window.dispatchEvent(new CustomEvent('file-received', {
            detail: {
                from: pending.from,
                name: pending.meta.name,
                size: pending.meta.size,
                mimeType: pending.meta.mimeType,
                url,
            }
        }));

        this.pendingReceive.delete(fileId);
    },

    // ── Base64 helpers ───────────────────────────────────────────────

    _uint8ToBase64(uint8) {
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
        }
        return btoa(binary);
    },

    _base64ToUint8(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    },
};

// Expose globally for p2p.js
window.__fileTransfer = FileTransfer;
