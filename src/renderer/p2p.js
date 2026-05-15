// p2p.js — P2P layer (bridges renderer to main process Hyperswarm via IPC)
// Replaces Socket.io + SimplePeer with Hyperswarm streams

let p2pIdentity = null;

// Event callbacks (set from app.js / chat.js / videoCall.js)
const P2P = {
    onMessage:     null,  // ({ remotePubKeyHex, plaintext, msgId, timestamp }) =>
    onTyping:      null,  // ({ remotePubKeyHex, isTyping }) =>
    onReceipt:     null,  // ({ msgId, status }) =>
    onPeerOnline:  null,  // (pubKeyHex) =>
    onPeerOffline: null,  // (pubKeyHex) =>
    onPeerProfile: null,  // ({ pubKeyHex, profile }) =>
    onCallSignal:  null,  // ({ from, data }) =>  — for video call signaling

    // ── Init ──────────────────────────────────────────────────────────

    async init() {
        // Try to load existing identity and re-init swarm
        const identity = await initExistingIdentity();
        if (!identity) return null;

        p2pIdentity = identity;
        this.setupEventListeners();
        return p2pIdentity;
    },

    async initWithIdentity(identity) {
        p2pIdentity = identity;
        this.setupEventListeners();
        return p2pIdentity;
    },

    setupEventListeners() {
        // Listen for messages from main process (Hyperswarm)
        window.electronAPI.onSwarmMessage(({ from, message }) => {
            this.handleIncoming(from, message);
        });

        window.electronAPI.onSwarmPeerConnected(async ({ pubKeyHex }) => {
            console.log('[P2P] Peer connected:', pubKeyHex.slice(0, 12));
            // Send our profile immediately
            this.sendRaw(pubKeyHex, { type: 'profile', payload: p2pIdentity.profile });
            P2P.onPeerOnline?.(pubKeyHex);

            // Flush pending messages
            const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, pubKeyHex);
            const pendingMsgs = await getPendingMessages(conv.id);
            for (const msg of pendingMsgs) {
                console.log('[P2P] Flushing pending message:', msg.id);
                this.sendRaw(pubKeyHex, { type: 'message', id: msg.id, content: msg.content, timestamp: msg.timestamp });
                await updateMessageStatus(msg.id, 'sent');
            }
            if (pendingMsgs.length > 0 && typeof ChatView !== 'undefined') {
                ChatView.loadMessages();
            }
        });

        window.electronAPI.onSwarmPeerDisconnected(({ pubKeyHex }) => {
            console.log('[P2P] Peer disconnected:', pubKeyHex.slice(0, 12));
            P2P.onPeerOffline?.(pubKeyHex);
        });

        window.electronAPI.onSwarmOnlinePeers((peers) => {
            if (typeof App !== 'undefined' && App.onOnlineUsers) {
                App.onOnlineUsers(peers);
            }
        });
    },

    getIdentity() {
        return p2pIdentity;
    },

    // ── Connect to a peer (by pubkey hex) ──────────────────────────

    async connectToPeer(remotePubKeyHex) {
        return await window.electronAPI.swarmConnectPeer(remotePubKeyHex);
    },

    async isPeerConnected(remotePubKeyHex) {
        return await window.electronAPI.swarmIsConnected(remotePubKeyHex);
    },

    // ── Outgoing message ──────────────────────────────────────────

    async sendMessage(remotePubKeyHex, plaintext) {
        const isConnected = await this.isPeerConnected(remotePubKeyHex);
        const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, remotePubKeyHex);
        const msgId = crypto.randomUUID();
        const timestamp = Date.now();

        if (isConnected) {
            // Send over Hyperswarm (already encrypted by Noise protocol)
            const packet = { type: 'message', id: msgId, content: plaintext, timestamp };
            this.sendRaw(remotePubKeyHex, packet);
        }

        // Save locally
        await saveMessage({
            id: msgId,
            conversationId: conv.id,
            senderId: p2pIdentity.pubKeyHex,
            content: plaintext,
            timestamp,
            status: isConnected ? 'sent' : 'pending',
            type: 'text',
        });
        await updateConversationPreview(conv.id, plaintext.slice(0, 60));

        return { msgId, timestamp, conversationId: conv.id };
    },

    sendTyping(remotePubKeyHex, isTyping) {
        this.sendRaw(remotePubKeyHex, { type: 'typing', isTyping });
    },

    // ── Video call signaling over Hyperswarm ─────────────────────

    sendCallSignal(remotePubKeyHex, signalData) {
        this.sendRaw(remotePubKeyHex, { type: 'call-signal', data: signalData });
    },

    async sendCallRequest(remotePubKeyHex, callerName) {
        let acked = false;
        const ackListener = (e) => {
            if (e.detail === remotePubKeyHex) acked = true;
        };
        window.addEventListener('call-ack', ackListener);
        
        for (let i = 0; i < 3; i++) {
            this.sendRaw(remotePubKeyHex, { type: 'call-request', callerName });
            await new Promise(r => setTimeout(r, 2000));
            if (acked) break;
        }
        window.removeEventListener('call-ack', ackListener);
    },

    sendCallAccepted(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-accepted' });
    },

    sendCallRejected(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-rejected' });
    },

    sendCallEnded(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-ended' });
    },

    sendCallBusy(remotePubKeyHex) {
        this.sendRaw(remotePubKeyHex, { type: 'call-busy' });
    },

    // ── Groups & Unsend ──────────────────────────────────────────

    async unsendMessage(remotePubKeyHex, msgId) {
        this.sendRaw(remotePubKeyHex, { type: 'unsend', msgId });
        await deleteMessage(msgId);
        const el = document.querySelector(`[data-id="${msgId}"]`);
        if (el) el.remove();
    },

    async sendGroupMessage(topicHex, plaintext) {
        window.electronAPI.swarmBroadcast(topicHex, { type: 'group-message', content: plaintext, senderId: p2pIdentity.pubKeyHex });
    },

    // ── Incoming message handler ──────────────────────────────────

    async handleIncoming(remotePubKeyHex, msg) {
        switch (msg.type) {

            case 'profile': {
                const existing = await getContact(remotePubKeyHex);
                if (existing) {
                    await upsertContact({
                        pubKeyHex: remotePubKeyHex,
                        profile: msg.payload,
                        status: existing.status
                    });
                    P2P.onPeerProfile?.({ pubKeyHex: remotePubKeyHex, profile: msg.payload });
                }
                break;
            }

            case 'contact-request': {
                await upsertContact({
                    pubKeyHex: remotePubKeyHex,
                    profile: msg.profile,
                    status: 'pending_incoming'
                });
                if (window.electronAPI) {
                    window.electronAPI.showNotification('Contact Request', `${msg.profile.name} wants to connect with you.`);
                }
                P2P.onContactRequest?.({ pubKeyHex: remotePubKeyHex, profile: msg.profile });
                break;
            }

            case 'contact-accept': {
                await updateContactStatus(remotePubKeyHex, 'approved');
                if (msg.profile) {
                    await upsertContact({
                        pubKeyHex: remotePubKeyHex,
                        profile: msg.profile,
                        status: 'approved'
                    });
                }
                if (window.electronAPI) {
                    window.electronAPI.showNotification('Request Accepted', `Your request was accepted.`);
                }
                P2P.onContactAccept?.({ pubKeyHex: remotePubKeyHex });
                break;
            }

            case 'contact-decline': {
                await deleteContact(remotePubKeyHex);
                P2P.onContactDecline?.({ pubKeyHex: remotePubKeyHex });
                break;
            }

            case 'message': {
                const conv = await getOrCreateConversationLocal(p2pIdentity.pubKeyHex, remotePubKeyHex);

                await saveMessage({
                    id: msg.id,
                    conversationId: conv.id,
                    senderId: remotePubKeyHex,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    status: 'delivered',
                    type: 'text',
                });
                await updateConversationPreview(conv.id, msg.content.slice(0, 60));

                // Send delivery receipt
                this.sendRaw(remotePubKeyHex, { type: 'receipt', msgId: msg.id, status: 'delivered' });

                P2P.onMessage?.({
                    remotePubKeyHex,
                    plaintext: msg.content,
                    msgId: msg.id,
                    timestamp: msg.timestamp,
                    conversationId: conv.id,
                });
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

            case 'file-chunk': {
                window.__fileTransfer?.handleChunk(remotePubKeyHex, msg);
                break;
            }

            // Video call signaling
            case 'call-signal': {
                P2P.onCallSignal?.({ from: remotePubKeyHex, data: msg.data });
                break;
            }

            case 'call-request': {
                this.sendRaw(remotePubKeyHex, { type: 'call-ack' }); // ACK immediately
                VideoCallView.handleIncomingCall(remotePubKeyHex, msg.callerName);
                break;
            }

            case 'call-ack': {
                window.dispatchEvent(new CustomEvent('call-ack', { detail: remotePubKeyHex }));
                break;
            }

            case 'unsend': {
                await deleteMessage(msg.msgId);
                const el = document.querySelector(`[data-id="${msg.msgId}"]`);
                if (el) el.remove();
                break;
            }

            case 'group-message': {
                P2P.onMessage?.({ 
                    remotePubKeyHex: msg.senderId, 
                    plaintext: msg.content, 
                    msgId: crypto.randomUUID(), 
                    timestamp: Date.now(), 
                    isGroup: true, 
                    topicHex: msg.groupTopic 
                });
                break;
            }

            case 'call-accepted': {
                VideoCallView.handleCallAccepted(remotePubKeyHex);
                break;
            }

            case 'call-rejected': {
                VideoCallView.handleCallRejected(remotePubKeyHex);
                break;
            }

            case 'call-ended': {
                VideoCallView.handleCallEnded(remotePubKeyHex);
                break;
            }

            case 'call-busy': {
                VideoCallView.handleCallBusy(remotePubKeyHex);
                break;
            }
        }
    },

    // ── Helpers ───────────────────────────────────────────────────

    sendRaw(remotePubKeyHex, obj) {
        window.electronAPI.swarmSend(remotePubKeyHex, obj);
    },

    // Teardown
    async teardown() {
        await window.electronAPI.swarmTeardown();
        p2pIdentity = null;
    },
};
