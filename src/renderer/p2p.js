// p2p.js — Replaces appwrite.js entirely
// Handles: signaling, WebRTC peer management, messaging, receipts

const SIGNAL_SERVER = 'https://ay-signaling.onrender.com';

let p2pSocket   = null;
let p2pIdentity = null;
const peers      = new Map();   // pubKeyHex → SimplePeer instance

// Event callbacks (set from app.js / chat.js)
const P2P = {
    onMessage:    null,  // ({ remotePubKeyHex, plaintext, msgId, timestamp }) =>
    onTyping:     null,  // ({ remotePubKeyHex, isTyping }) =>
    onReceipt:    null,  // ({ msgId, status }) =>
    onPeerOnline: null,  // (pubKeyHex) =>
    onPeerProfile: null, // ({ pubKeyHex, profile }) =>

    // ── Init ──────────────────────────────────────────────────────────

    async init() {
        p2pIdentity = await getOrCreateIdentity();

        p2pSocket = io(SIGNAL_SERVER, {
            query: { peerId: p2pIdentity.pubKeyHex },
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
            timeout: 10000,
        });

        p2pSocket.on('connect', () => {
            console.log('[p2p] Connected to signaling server');
            p2pSocket.emit('register', p2pIdentity.pubKeyHex);
        });

        p2pSocket.on('signal', async ({ from, data }) => {
            let peer = peers.get(from);
            if (!peer) {
                // Incoming connection — we are NOT the initiator
                peer = await P2P.createPeer(from, false);
            }
            peer.signal(data);
        });

        p2pSocket.on('online-users', (users) => {
            // Forward to app for UI updates
            if (typeof App !== 'undefined' && App.onOnlineUsers) {
                App.onOnlineUsers(users);
            }
        });

        p2pSocket.on('reconnect', () => {
            console.log('[p2p] Reconnected to signaling server');
            p2pSocket.emit('register', p2pIdentity.pubKeyHex);
        });

        return p2pIdentity;
    },

    getSocket() {
        return p2pSocket;
    },

    getIdentity() {
        return p2pIdentity;
    },

    // ── Connect to a peer (by pubkey) ─────────────────────────────────

    async connectToPeer(remotePubKeyHex) {
        if (peers.has(remotePubKeyHex)) return peers.get(remotePubKeyHex);
        const peer = await P2P.createPeer(remotePubKeyHex, true);
        return peer;
    },

    // Call this when the user pastes a connection string
    async connectFromString(connStr) {
        const remotePubKeyHex = parseConnectionString(connStr);
        await P2P.connectToPeer(remotePubKeyHex);
        return remotePubKeyHex;
    },

    isPeerConnected(remotePubKeyHex) {
        const peer = peers.get(remotePubKeyHex);
        return peer && peer.connected;
    },

    getPeer(remotePubKeyHex) {
        return peers.get(remotePubKeyHex);
    },

    // ── SimplePeer factory ────────────────────────────────────────────

    async createPeer(remotePubKeyHex, initiator) {
        const sharedKey = await Encryption.deriveSharedKeyFor(p2pIdentity.privKeyB64, remotePubKeyHex);

        const peer = new SimplePeer({
            initiator,
            trickle: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' },
                ],
            },
        });

        peers.set(remotePubKeyHex, peer);

        // Forward SDP/ICE through signaling server ONLY
        peer.on('signal', data => {
            p2pSocket.emit('signal', { to: remotePubKeyHex, from: p2pIdentity.pubKeyHex, data });
        });

        peer.on('connect', () => {
            console.log('[p2p] connected to', remotePubKeyHex.slice(0, 12));
            // Exchange profile immediately on connect
            P2P.sendRaw(peer, { type: 'profile', payload: p2pIdentity.profile });
        });

        peer.on('data', async raw => {
            let msg;
            try {
                // Handle both string and ArrayBuffer data
                if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) {
                    // Could be a file chunk — check if it starts with JSON
                    const view = new Uint8Array(raw);
                    const newlineIdx = view.indexOf(0x0a);
                    if (newlineIdx > 0 && newlineIdx < 500) {
                        // Likely file-chunk with header\nbinary format
                        try {
                            const headerStr = new TextDecoder().decode(view.slice(0, newlineIdx));
                            const header = JSON.parse(headerStr);
                            if (header.type === 'file-chunk') {
                                window.__fileTransfer?.handleChunk(remotePubKeyHex, raw);
                                return;
                            }
                        } catch (_) {}
                    }
                    // Try as JSON string
                    msg = JSON.parse(new TextDecoder().decode(raw));
                } else {
                    msg = JSON.parse(raw);
                }
            } catch {
                return;
            }
            await P2P.handleIncoming(remotePubKeyHex, msg, sharedKey);
        });

        peer.on('error', err => console.error('[p2p] peer error', err));
        peer.on('close', () => { peers.delete(remotePubKeyHex); });

        return peer;
    },

    // ── Outgoing message ──────────────────────────────────────────────

    async sendMessage(remotePubKeyHex, plaintext) {
        const peer      = peers.get(remotePubKeyHex);
        const sharedKey = await Encryption.deriveSharedKeyFor(p2pIdentity.privKeyB64, remotePubKeyHex);

        if (!peer || !peer.connected) throw new Error('Peer not connected');

        const { ciphertext, iv } = await Encryption.encryptMessage(sharedKey, plaintext);
        const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, remotePubKeyHex);

        const msgId = crypto.randomUUID();
        const timestamp = Date.now();
        const packet = { type: 'message', id: msgId, ciphertext, iv, timestamp };
        P2P.sendRaw(peer, packet);

        // Save locally immediately
        await saveMessage({
            id: msgId,
            conversationId: conv.id,
            senderId: p2pIdentity.pubKeyHex,
            content: plaintext,
            ciphertext,
            iv,
            timestamp,
            status: 'sent',
            type: 'text',
        });
        await updateConversationPreview(conv.id, plaintext.slice(0, 60));

        return { msgId, timestamp, conversationId: conv.id };
    },

    sendTyping(remotePubKeyHex, isTyping) {
        const peer = peers.get(remotePubKeyHex);
        if (peer?.connected) P2P.sendRaw(peer, { type: 'typing', isTyping });
    },

    // ── Incoming message handler ──────────────────────────────────────

    async handleIncoming(remotePubKeyHex, msg, sharedKey) {
        switch (msg.type) {

            case 'profile': {
                await upsertContact({
                    pubKeyHex: remotePubKeyHex,
                    profile: msg.payload,
                });
                P2P.onPeerProfile?.({ pubKeyHex: remotePubKeyHex, profile: msg.payload });
                break;
            }

            case 'message': {
                let plaintext;
                try {
                    plaintext = await Encryption.decryptMessage(sharedKey, msg.ciphertext, msg.iv);
                } catch (e) {
                    console.error('[p2p] Decryption failed:', e);
                    plaintext = '[Could not decrypt message]';
                }

                const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, remotePubKeyHex);

                await saveMessage({
                    id: msg.id,
                    conversationId: conv.id,
                    senderId: remotePubKeyHex,
                    content: plaintext,
                    ciphertext: msg.ciphertext,
                    iv: msg.iv,
                    timestamp: msg.timestamp,
                    status: 'delivered',
                    type: 'text',
                });
                await updateConversationPreview(conv.id, plaintext.slice(0, 60));

                // Send delivery receipt
                const peer = peers.get(remotePubKeyHex);
                if (peer?.connected) P2P.sendRaw(peer, { type: 'receipt', msgId: msg.id, status: 'delivered' });

                P2P.onMessage?.({ remotePubKeyHex, plaintext, msgId: msg.id, timestamp: msg.timestamp, conversationId: conv.id });
                break;
            }

            case 'receipt': {
                await updateMessageStatus(msg.msgId, msg.status);
                P2P.onReceipt?.({ msgId: msg.msgId, status: msg.status });
                break;
            }

            case 'typing': {
                P2P.onTyping?.({ remotePubKeyHex, isTyping: msg.isTyping });
                break;
            }

            case 'file-meta': {
                window.__fileTransfer?.handleMeta(remotePubKeyHex, msg);
                break;
            }
        }
    },

    // ── Helpers ───────────────────────────────────────────────────────

    sendRaw(peer, obj) {
        peer.send(JSON.stringify(obj));
    },

    // Teardown — disconnect all peers and socket
    teardown() {
        for (const [key, peer] of peers) {
            try { peer.destroy(); } catch (_) {}
        }
        peers.clear();
        Encryption.clearCache();
        if (p2pSocket) {
            p2pSocket.disconnect();
            p2pSocket = null;
        }
        p2pIdentity = null;
    },
};
