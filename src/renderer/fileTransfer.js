// fileTransfer.js — File transfer over Hyperswarm streams
// Files are chunked and sent as base64 over the JSON message protocol

const FileTransfer = {
    pendingReceive: new Map(), // fileId → { meta, chunks: [], received: 0 }
    CHUNK_SIZE: 128 * 1024, // 128KB per chunk (safe and fast with native encoding)

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

        // Read and send chunks natively using FileReader slices
        for (let i = 0; i < totalChunks; i++) {
            const start = i * this.CHUNK_SIZE;
            const end = Math.min(start + this.CHUNK_SIZE, file.size);
            const blobSlice = file.slice(start, end);
            
            const base64 = await this._readAsBase64(blobSlice);

            P2P.sendRaw(remotePubKeyHex, {
                type: 'file-chunk',
                fileId,
                index: i,
                data: base64,
            });

            // Dispatch progress
            window.dispatchEvent(new CustomEvent('file-progress', {
                detail: { fileId, progress: Math.round(((i + 1) / totalChunks) * 100), type: 'upload' }
            }));

            // Small delay to yield to UI and not choke IPC buffer
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

    async handleChunk(remotePubKeyHex, msg) {
        const pending = this.pendingReceive.get(msg.fileId);
        if (!pending) return;

        pending.chunks[msg.index] = await this._base64ToUint8(msg.data);
        pending.received++;

        // Dispatch progress
        window.dispatchEvent(new CustomEvent('file-progress', {
            detail: { fileId: msg.fileId, progress: Math.round((pending.received / pending.meta.totalChunks) * 100), type: 'download' }
        }));

        // Check if complete
        if (pending.received >= pending.meta.totalChunks) {
            this._assembleFile(msg.fileId, pending);
        }
    },

    async _assembleFile(fileId, pending) {
        // Concatenate all chunks
        const totalSize = pending.chunks.reduce((sum, c) => sum + c.length, 0);
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of pending.chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        // We convert the file directly into a persistent base64 data URL
        // instead of a temporary blob URL so it saves properly in IndexedDB
        const blob = new Blob([result], { type: pending.meta.mimeType });
        const persistentDataUrl = await this._readAsDataURL(blob);

        console.log(`[FileTransfer] Assembled ${pending.meta.name} (${totalSize} bytes)`);

        // Dispatch event for chat.js to handle
        window.dispatchEvent(new CustomEvent('file-received', {
            detail: {
                from: pending.from,
                name: pending.meta.name,
                size: pending.meta.size,
                mimeType: pending.meta.mimeType,
                url: persistentDataUrl, // Persistent data string
            }
        }));

        this.pendingReceive.delete(fileId);
    },

    // ── Async Base64 helpers ───────────────────────────────────────────────

    async _readAsBase64(blobSlice) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.readAsDataURL(blobSlice);
        });
    },

    async _readAsDataURL(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    },

    async _base64ToUint8(base64) {
        // Use native fetch to decode base64 extremely fast
        const res = await fetch(`data:application/octet-stream;base64,${base64}`);
        const buffer = await res.arrayBuffer();
        return new Uint8Array(buffer);
    },
};

// Expose globally for p2p.js
window.__fileTransfer = FileTransfer;
