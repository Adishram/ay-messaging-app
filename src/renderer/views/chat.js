// chat.js — Chat interaction and message rendering (P2P + DB)

const ChatView = {
    currentConversation: null,
    currentPeer: null,
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
            await ContactsView.loadContacts();
            await ContactsView.loadConversations();
            if (this.currentPeer && this.currentPeer.pubKeyHex === data.pubKeyHex) {
                this.currentPeer.profile = data.profile;
                this.updateHeaderStatus();
            }
        };

        window.addEventListener('file-received', (e) => this.handleFileReceived(e.detail));
    },

    setupEventListeners() {
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

        // File input — instant (no delay)
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 100 * 1024 * 1024) {
                alert('File too large (max 100MB)');
                e.target.value = '';
                return;
            }
            this.pendingFile = file;
            document.getElementById('file-preview-name').textContent = file.name;
            document.getElementById('file-preview-size').textContent = this.formatFileSize(file.size);
            document.getElementById('file-preview-bar').classList.remove('hidden');
            input.focus();
        });

        document.getElementById('btn-attach').addEventListener('click', () => fileInput.click());
        document.getElementById('btn-remove-file').addEventListener('click', () => this.clearPendingFile());

        // Header controls
        document.getElementById('btn-video-call').addEventListener('click', () => {
            if (this.currentPeer) VideoCallView.startCall(this.currentPeer.pubKeyHex, this.currentPeer.profile.name, false);
        });
        document.getElementById('btn-screen-share-chat').addEventListener('click', () => {
            if (this.currentPeer) VideoCallView.startCall(this.currentPeer.pubKeyHex, this.currentPeer.profile.name, true);
        });

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

        document.getElementById('chat-peer-name').textContent = peerContact.profile.name;
        const avatarEl = document.getElementById('chat-peer-avatar');
        avatarEl.style.backgroundColor = peerContact.profile.avatarColor;
        avatarEl.innerHTML = `<span>${ContactsView.getInitials(peerContact.profile.name)}</span>`;
        
        this.updateHeaderStatus();

        const isConnected = await P2P.isPeerConnected(peerContact.pubKeyHex);
        if (!isConnected) {
            P2P.connectToPeer(peerContact.pubKeyHex).catch(() => {});
        }

        document.getElementById('chat-messages').innerHTML = '';
        await this.loadMessages();
        setTimeout(() => document.getElementById('message-input').focus(), 100);
    },

    updateHeaderStatus() {
        if (!this.currentPeer) return;
        const statusEl = document.getElementById('chat-peer-status');
        const isOnline = App.onlineUsers.has(this.currentPeer.pubKeyHex);
        statusEl.textContent = isOnline ? 'Online' : 'Offline';
        statusEl.classList.toggle('online', isOnline);
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

        // Handle file send
        if (this.pendingFile) {
            const file = this.pendingFile;
            this.clearPendingFile();
            
            try {
                await FileTransfer.sendFile(this.currentPeer.pubKeyHex, file);
                const conv = await getOrCreateConversationLocal(App.currentUser.pubKeyHex, this.currentPeer.pubKeyHex);
                const fileUrl = URL.createObjectURL(file);
                const isImg = file.type.startsWith('image/');
                const isVid = file.type.startsWith('video/');
                let contentHtml = `<a href="${fileUrl}" download="${file.name}" class="file-attachment text-preview">📄 ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB) - Click to download</a>`;
                if (isImg) contentHtml = `<a href="${fileUrl}" download="${file.name}"><img src="${fileUrl}" class="file-attachment image-preview" style="max-width: 200px; border-radius: 8px;"></a>`;
                if (isVid) contentHtml = `<video src="${fileUrl}" controls class="file-attachment video-preview" style="max-width: 200px; border-radius: 8px;"></video>`;

                await saveMessage({
                    id: crypto.randomUUID(),
                    conversationId: conv.id,
                    senderId: App.currentUser.pubKeyHex,
                    content: contentHtml,
                    timestamp: Date.now(),
                    status: 'sent',
                    type: 'html',
                });
                await this.loadMessages();
                ContactsView.loadConversations();
            } catch (err) {
                console.error('File send failed:', err);
            }

            // Also send the text if there was one
            if (!text) return;
        }

        if (!text) return;

        try {
            await P2P.sendMessage(this.currentPeer.pubKeyHex, text);
            P2P.sendTyping(this.currentPeer.pubKeyHex, false);
            await this.loadMessages();
            ContactsView.loadConversations();
        } catch (error) {
            console.error('Send message failed:', error);
        }
    },

    handleIncomingMessage(data) {
        ContactsView.loadConversations();
        
        // Show notification if not viewing this conversation
        const isActive = this.currentConversation && this.currentConversation.id === data.conversationId;
        
        if (isActive) {
            this.loadMessages();
        }

        // Always show notification unless it's the active conversation
        if (!isActive || !document.hasFocus()) {
            const contact = ContactsView.contacts.find(c => c.pubKeyHex === data.remotePubKeyHex);
            const senderName = contact ? contact.profile.name : 'New message';
            const preview = data.plaintext.length > 60 ? data.plaintext.slice(0, 60) + '…' : data.plaintext;
            
            if (window.electronAPI) {
                window.electronAPI.showNotification(senderName, preview);
            }
        }
    },

    handleFileReceived(fileMeta) {
        const { from, name, size, mimeType, url } = fileMeta;
        ContactsView.loadConversations(); 
        
        if (this.currentPeer && this.currentPeer.pubKeyHex === from) {
            const isImg = mimeType.startsWith('image/');
            const isVid = mimeType.startsWith('video/');
            
            let contentHtml = `<a href="${url}" download="${name}" class="file-attachment text-preview">📄 ${name} (${(size/1024/1024).toFixed(2)} MB) - Click to download</a>`;
            if (isImg) contentHtml = `<a href="${url}" download="${name}"><img src="${url}" class="file-attachment image-preview" style="max-width: 200px; border-radius: 8px;"></a>`;
            if (isVid) contentHtml = `<video src="${url}" controls class="file-attachment video-preview" style="max-width: 200px; border-radius: 8px;"></video>`;

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

        // Notification for file
        if (!this.currentPeer || this.currentPeer.pubKeyHex !== from || !document.hasFocus()) {
            const contact = ContactsView.contacts.find(c => c.pubKeyHex === from);
            const senderName = contact ? contact.profile.name : 'Someone';
            if (window.electronAPI) {
                window.electronAPI.showNotification(senderName, `📎 Sent a file: ${name}`);
            }
        }
    },



    handleReceipt(data) {
        const svg = document.getElementById(`status-${data.msgId}`);
        if (svg && data.status === 'delivered') {
            svg.classList.add('status-read');
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
            const statusClass = msg.status === 'delivered' ? 'status-read' : '';
            statusHtml = `<svg id="status-${msg.id}" class="message-status ${statusClass}" viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round"><path d="M5 13l4 4L19 7"/></svg>`;
        }

        let msgContent = msg.type === 'html' ? msg.content : this.escapeHtml(msg.content);

        el.innerHTML = `
            <div class="message-bubble">
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
        requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });
    },

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

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
            if (term && content.includes(lowerTerm)) { parent.style.display = 'flex'; count++; }
            else if (!term) { parent.style.display = 'flex'; }
            else { parent.style.display = 'none'; }
        });

        const countEl = document.getElementById('search-count');
        countEl.textContent = term ? `${count} matches` : '';
    }
};
