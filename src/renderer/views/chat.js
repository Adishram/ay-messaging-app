// chat.js — Chat interaction and message rendering (P2P + DB)

const ChatView = {
    currentConversation: null,
    currentPeer: null, // The contact object { pubKeyHex, profile }
    pendingFile: null,
    typingTimeout: null,
    searchActive: false,

    init() {
        this.setupEventListeners();
        
        // Bind P2P callbacks
        P2P.onMessage = (data) => this.handleIncomingMessage(data);
        P2P.onReceipt = (data) => this.handleReceipt(data);
        P2P.onTyping = (data) => this.handleTyping(data);
        P2P.onPeerProfile = async (data) => {
            // Profile updated, reload contacts UI
            await ContactsView.loadContacts();
            await ContactsView.loadConversations();
            if (this.currentPeer && this.currentPeer.pubKeyHex === data.pubKeyHex) {
                this.currentPeer.profile = data.profile;
                this.updateHeaderStatus();
            }
        };

        // File transfer completion from fileTransfer.js
        window.addEventListener('file-received', (e) => this.handleFileReceived(e.detail));
    },

    setupEventListeners() {
        // Input handling
        const input = document.getElementById('message-input');
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
        });
        
        input.addEventListener('input', () => {
            if (!this.currentPeer) return;
            P2P.sendTyping(this.currentPeer.pubKeyHex, true);
            
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                P2P.sendTyping(this.currentPeer.pubKeyHex, false);
            }, 3000);
        });

        document.getElementById('btn-send').addEventListener('click', () => this.handleSend());

        // File constraints & UI
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                // 100MB limit for reliable data channel chunking
                if (file.size > 100 * 1024 * 1024) {
                    alert('File too large (max 100MB)');
                    e.target.value = '';
                    return;
                }
                this.pendingFile = file;
                document.getElementById('file-preview-name').textContent = file.name;
                document.getElementById('file-preview-size').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
                document.getElementById('file-preview-bar').classList.remove('hidden');
                input.focus();
            }
        });

        document.getElementById('btn-attach').addEventListener('click', () => fileInput.click());
        document.getElementById('btn-remove-file').addEventListener('click', () => this.clearPendingFile());

        // Header controls
        document.getElementById('btn-video-call').addEventListener('click', async () => {
            if (this.currentPeer) {
                // We reuse Socket.io signaling from videoCall.js (which remains)
                VideoCallView.startCall(this.currentPeer.pubKeyHex, this.currentPeer.profile.name, false);
            }
        });
        
        document.getElementById('btn-screen-share-chat').addEventListener('click', () => {
            if (this.currentPeer) {
                VideoCallView.startCall(this.currentPeer.pubKeyHex, this.currentPeer.profile.name, true);
            }
        });

        // Search in chat
        document.getElementById('btn-search-messages').addEventListener('click', () => this.toggleSearch());
        document.getElementById('btn-close-search').addEventListener('click', () => this.toggleSearch());
        document.getElementById('search-messages-input').addEventListener('input', (e) => this.performSearch(e.target.value));
    },

    showEmptyState() {
        document.getElementById('chat-empty').classList.remove('hidden');
        document.getElementById('chat-header').classList.add('hidden');
        document.getElementById('chat-messages').classList.add('hidden');
        document.getElementById('chat-input').classList.add('hidden');
        this.currentConversation = null;
        this.currentPeer = null;
    },

    async openConversation(conversation, peerContact) {
        this.currentConversation = conversation;
        this.currentPeer = peerContact;

        document.getElementById('chat-empty').classList.add('hidden');
        document.getElementById('chat-header').classList.remove('hidden');
        document.getElementById('chat-messages').classList.remove('hidden');
        document.getElementById('chat-input').classList.remove('hidden');

        // Render header
        document.getElementById('chat-peer-name').textContent = peerContact.profile.name;
        const avatarEl = document.getElementById('chat-peer-avatar');
        avatarEl.style.backgroundColor = peerContact.profile.avatarColor;
        avatarEl.innerHTML = `<span>${ContactsView.getInitials(peerContact.profile.name)}</span>`;
        
        this.updateHeaderStatus();

        // Connect data channel if not connected
        if (!P2P.isPeerConnected(peerContact.pubKeyHex)) {
            P2P.connectToPeer(peerContact.pubKeyHex).catch(e => console.error('P2P connect dev:', e));
        }

        document.getElementById('chat-messages').innerHTML = '';
        await this.loadMessages();
        
        // Focus input
        setTimeout(() => document.getElementById('message-input').focus(), 100);
    },

    updateHeaderStatus() {
        if (!this.currentPeer) return;
        const statusEl = document.getElementById('chat-peer-status');
        const isOnline = App.onlineUsers.has(this.currentPeer.pubKeyHex);
        
        if (isOnline) {
            statusEl.textContent = 'Online';
            statusEl.classList.add('online');
        } else {
            statusEl.textContent = 'Offline';
            statusEl.classList.remove('online');
        }
    },

    async loadMessages() {
        if (!this.currentConversation) return;
        
        const msgs = await getMessagesLocal(this.currentConversation.id);
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';

        let currentDate = null;

        msgs.forEach(msg => {
            const msgDate = new Date(msg.timestamp).toISOString().split('T')[0];
            if (msgDate !== currentDate) {
                container.appendChild(this.createDateDivider(msg.timestamp));
                currentDate = msgDate;
            }
            container.appendChild(this.createMessageElement(msg));
        });

        this.scrollToBottom();
    },

    async handleSend() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        
        if (!text && !this.pendingFile) return;

        input.value = '';
        if (this.pendingFile) {
            const peerObj = P2P.getPeer(this.currentPeer.pubKeyHex);
            if (peerObj && peerObj.connected) {
                // Send file via connection
                this.renderLocalFileMessage(this.pendingFile);
                sendFileP2P(peerObj, this.pendingFile, (progress) => {
                    // Could update progress bar UI here
                }).catch(err => console.error('File send error:', err));
            } else {
                alert('Peer is offline, cannot send file via P2P.');
            }
            this.clearPendingFile();
            P2P.sendTyping(this.currentPeer.pubKeyHex, false);
            return;
        }

        // Just Text Message
        if (!text) return;

        try {
            // Optimistic render (will show sending status if we want, but local store is fast)
            const { msgId, timestamp } = await P2P.sendMessage(this.currentPeer.pubKeyHex, text);
            
            P2P.sendTyping(this.currentPeer.pubKeyHex, false);
            
            // Re-render
            await this.loadMessages();
            ContactsView.loadConversations(); // Update side bar preview
        } catch (error) {
            console.error('Send message failed:', error);
            // Even if failed to send (offline), the message should be persisted as 'failed' status ideally
            alert('Cannot send message. User might be offline.');
        }
    },

    renderLocalFileMessage(file) {
        // Construct a fake msg block for local optimistic render of file
        const container = document.getElementById('chat-messages');
        const msgInfo = {
            id: crypto.randomUUID(),
            senderId: App.currentUser.pubKeyHex,
            content: `Sent file: ${file.name}`,
            timestamp: Date.now(),
            status: 'sent',
            type: 'text' // For simplicity right now
        };
        container.appendChild(this.createMessageElement(msgInfo));
        this.scrollToBottom();
    },

    handleIncomingMessage(data) {
        // data: { remotePubKeyHex, plaintext, msgId, timestamp, conversationId }
        ContactsView.loadConversations(); // Update preview
        
        // If we have chat open for this conversation, append
        if (this.currentConversation && this.currentConversation.id === data.conversationId) {
            this.loadMessages(); // Just full reload to keep date dividers clean
        }
    },

    handleFileReceived(fileMeta) {
        // We received a file chunk entirely -> blob
        const { from, name, size, mimeType, url } = fileMeta;
        ContactsView.loadConversations(); 
        
        if (this.currentPeer && this.currentPeer.pubKeyHex === from) {
            const container = document.getElementById('chat-messages');
            
            // Create a fake msg
            const isImg = mimeType.startsWith('image/');
            const isVid = mimeType.startsWith('video/');
            
            let contentHtml = `<a href="${url}" download="${name}" class="file-attachment text-preview">📄 ${name} (${(size/1024/1024).toFixed(2)} MB) - Click to download</a>`;
            if (isImg) contentHtml = `<a href="${url}" download="${name}"><img src="${url}" class="file-attachment image-preview" style="max-width: 200px; border-radius: 8px;"></a>`;
            if (isVid) contentHtml = `<video src="${url}" controls class="file-attachment video-preview" style="max-width: 200px; border-radius: 8px;"></video>`;

            // Write to local DB as a mock message to keep history
            saveMessage({
                id: crypto.randomUUID(),
                senderId: from,
                conversationId: this.currentConversation.id,
                content: contentHtml,
                timestamp: Date.now(),
                status: 'delivered',
                type: 'html'
            });

            this.loadMessages();
        }
    },

    handleReceipt(data) {
        // Update checkmarks
        const uiStatus = document.getElementById(`status-${data.msgId}`);
        if (uiStatus) {
            if (data.status === 'delivered') uiStatus.innerHTML = '<path d="M5 13l4 4L19 7"/><path d="M10 13l4 4L24 7"/>'; // double tick
        }
    },

    handleTyping(data) {
        if (!this.currentPeer || data.remotePubKeyHex !== this.currentPeer.pubKeyHex) return;
        const ind = document.getElementById('typing-indicator');
        if (data.isTyping) {
            ind.classList.remove('hidden');
            this.scrollToBottom();
        } else {
            ind.classList.add('hidden');
        }
    },

    createMessageElement(msg) {
        const isSelf = msg.senderId === App.currentUser.pubKeyHex;
        const el = document.createElement('div');
        el.className = `message ${isSelf ? 'message-self' : ''}`;
        el.dataset.id = msg.id;

        const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        let statusHtml = '';
        if (isSelf) {
            if (msg.status === 'sent') {
                statusHtml = `<svg id="status-${msg.id}" class="message-status" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`; // single tick
            } else if (msg.status === 'delivered') {
                statusHtml = `<svg id="status-${msg.id}" class="message-status status-read" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/><path d="M10 13l4 4L24 7" opacity="0.5"/></svg>`; // double tick
            }
        }

        // Handle HTML injection from files vs pure text (escaped)
        let msgContent = msg.type === 'html' ? msg.content : this.escapeHtml(msg.content);

        el.innerHTML = `
            <div class="message-bubble glass-panel">
                <div class="message-content">${msgContent}</div>
                <div class="message-meta">
                    <span class="message-time">${timeStr}</span>
                    ${statusHtml}
                </div>
            </div>
        `;
        return el;
    },

    createDateDivider(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        
        let label = date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
        if (diffDays === 0) label = 'Today';
        else if (diffDays === 1) label = 'Yesterday';

        const wrapper = document.createElement('div');
        wrapper.className = 'date-divider';
        wrapper.innerHTML = `<span>${label}</span>`;
        return wrapper;
    },

    clearPendingFile() {
        this.pendingFile = null;
        document.getElementById('file-preview-bar').classList.add('hidden');
        document.getElementById('file-input').value = '';
    },

    scrollToBottom() {
        const msgsEl = document.getElementById('chat-messages');
        requestAnimationFrame(() => {
            msgsEl.scrollTop = msgsEl.scrollHeight;
        });
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ── Search functionality ────────────────────────────────────
    toggleSearch() {
        this.searchActive = !this.searchActive;
        const panel = document.getElementById('search-panel');
        if (this.searchActive) {
            panel.classList.remove('hidden');
            document.getElementById('search-messages-input').focus();
        } else {
            panel.classList.add('hidden');
            document.getElementById('search-messages-input').value = '';
            this.performSearch('');
        }
    },

    performSearch(term) {
        const messages = document.querySelectorAll('.message-bubble');
        let count = 0;
        const lowerTerm = term.toLowerCase();

        messages.forEach(bubble => {
            const content = bubble.querySelector('.message-content').textContent.toLowerCase();
            const parent = bubble.parentElement;
            
            if (term && content.includes(lowerTerm)) {
                parent.style.display = 'flex';
                count++;
            } else if (!term) {
                parent.style.display = 'flex';
            } else {
                parent.style.display = 'none';
            }
        });

        const countEl = document.getElementById('search-count');
        if (term) {
            countEl.textContent = `${count} matches`;
        } else {
            countEl.textContent = '';
            document.querySelectorAll('.date-divider').forEach(d => d.style.display = 'flex');
        }
    }
};
