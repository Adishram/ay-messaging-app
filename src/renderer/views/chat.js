// ── Chat View Controller ──────────────────────────────────────────
const ChatView = {
    currentConversationId: null,
    currentPeerId: null,
    currentPeerName: null,
    messageSubscription: null,
    pendingFile: null,
    replyingTo: null,
    editingMessage: null,
    contextMenuTarget: null,
    typingTimeout: null,
    isTyping: false,
    searchResults: [],
    searchIndex: -1,
    MESSAGE_EDIT_WINDOW_MS: 15 * 60 * 1000,    // 15 min
    MESSAGE_DELETE_WINDOW_MS: 5 * 60 * 1000,    // 5 min

    init() {
        document.getElementById('btn-send').addEventListener('click', () => this.handleSend());
        document.getElementById('message-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSend();
            }
            if (e.key === 'Escape') {
                if (this.editingMessage) this.cancelEdit();
                if (this.replyingTo) this.cancelReply();
            }
        });

        // Draft persistence — save on input (2.5)
        document.getElementById('message-input').addEventListener('input', () => {
            this.emitTyping();
            this.saveDraft();
        });

        // Video call
        document.getElementById('btn-video-call').addEventListener('click', () => {
            if (this.currentPeerId) VideoCallView.startCall(this.currentPeerId, this.currentPeerName);
        });
        document.getElementById('btn-screen-share-chat').addEventListener('click', () => {
            if (this.currentPeerId) VideoCallView.startCall(this.currentPeerId, this.currentPeerName, true);
        });

        // File attach
        document.getElementById('btn-attach').addEventListener('click', () => document.getElementById('file-input').click());
        document.getElementById('file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const validation = validateFile(file);
            if (!validation.valid) { alert(validation.error); e.target.value = ''; return; }
            this.pendingFile = file;
            document.getElementById('file-preview-name').textContent = file.name;
            document.getElementById('file-preview-size').textContent = formatFileSize(file.size);
            document.getElementById('file-preview-bar').classList.remove('hidden');
        });
        document.getElementById('btn-remove-file').addEventListener('click', () => this.clearPendingFile());
        document.getElementById('btn-cancel-reply').addEventListener('click', () => this.cancelReply());

        // Context menu items
        document.getElementById('ctx-reply').addEventListener('click', () => this.handleContextReply());
        document.getElementById('ctx-delete').addEventListener('click', () => this.handleContextDelete());
        document.getElementById('ctx-edit').addEventListener('click', () => this.handleContextEdit());
        document.getElementById('ctx-react').addEventListener('click', () => this.handleContextReact());

        // Emoji picker buttons
        document.querySelectorAll('#emoji-picker .emoji-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const emoji = btn.dataset.emoji;
                document.getElementById('emoji-picker').classList.add('hidden');
                if (this.contextMenuTarget) this.addReaction(this.contextMenuTarget.msgId, emoji);
            });
        });

        // Close pickers on outside click
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('message-context-menu');
            const picker = document.getElementById('emoji-picker');
            if (!menu.classList.contains('hidden') && !menu.contains(e.target)) menu.classList.add('hidden');
            if (!picker.classList.contains('hidden') && !picker.contains(e.target)) picker.classList.add('hidden');
        });

        // Search (2.4)
        document.getElementById('btn-search-messages').addEventListener('click', () => this.toggleSearch());
        document.getElementById('btn-close-search').addEventListener('click', () => this.closeSearch());
        document.getElementById('search-messages-input').addEventListener('input', (e) => this.performSearch(e.target.value));
    },

    // ── Typing Indicator ─────────────────────────────────────────────

    emitTyping() {
        if (!App.socket || !this.currentPeerId) return;
        if (!this.isTyping) {
            this.isTyping = true;
            App.socket.emit('typing-start', { to: this.currentPeerId });
        }
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.isTyping = false;
            App.socket.emit('typing-stop', { to: this.currentPeerId });
        }, 2000);
    },

    showTypingIndicator(show) {
        const el = document.getElementById('typing-indicator');
        if (el) el.classList.toggle('hidden', !show);
    },

    // ── Draft Persistence (2.5) ──────────────────────────────────────

    saveDraft() {
        if (!this.currentConversationId) return;
        const input = document.getElementById('message-input');
        const text = input.value;
        if (text) {
            localStorage.setItem(`draft_${this.currentConversationId}`, text);
        } else {
            localStorage.removeItem(`draft_${this.currentConversationId}`);
        }
    },

    restoreDraft() {
        if (!this.currentConversationId) return;
        const draft = localStorage.getItem(`draft_${this.currentConversationId}`);
        const input = document.getElementById('message-input');
        input.value = draft || '';
    },

    clearDraft() {
        if (!this.currentConversationId) return;
        localStorage.removeItem(`draft_${this.currentConversationId}`);
    },

    // ── Message Search (2.4) ─────────────────────────────────────────

    toggleSearch() {
        const panel = document.getElementById('search-panel');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            document.getElementById('search-messages-input').focus();
        }
    },

    closeSearch() {
        document.getElementById('search-panel').classList.add('hidden');
        document.getElementById('search-messages-input').value = '';
        document.getElementById('search-count').textContent = '';
        // Remove highlights
        document.querySelectorAll('.search-highlight').forEach((el) => {
            el.classList.remove('search-highlight');
        });
        this.searchResults = [];
        this.searchIndex = -1;
    },

    performSearch(query) {
        // Clear old highlights
        document.querySelectorAll('.search-highlight').forEach((el) => el.classList.remove('search-highlight'));
        this.searchResults = [];
        this.searchIndex = -1;

        if (!query || query.length < 2) {
            document.getElementById('search-count').textContent = '';
            return;
        }

        const lowerQuery = query.toLowerCase();
        const messages = document.querySelectorAll('.message-group');
        messages.forEach((msg) => {
            const bubble = msg.querySelector('.message-bubble');
            if (bubble && bubble.textContent.toLowerCase().includes(lowerQuery)) {
                msg.classList.add('search-highlight');
                this.searchResults.push(msg);
            }
        });

        const count = this.searchResults.length;
        document.getElementById('search-count').textContent = count > 0 ? `${count} found` : 'No results';

        // Scroll to first result
        if (count > 0) {
            this.searchIndex = 0;
            this.searchResults[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    },

    // ── Open Conversation ────────────────────────────────────────────

    async openConversation(conversationId, peerId, peerName, isOnline) {
        this.currentConversationId = conversationId;
        this.currentPeerId = peerId;
        this.currentPeerName = peerName;
        this.cancelReply();
        this.cancelEdit();
        this.closeSearch();

        document.getElementById('chat-area-content').classList.remove('hidden');
        document.querySelector('.chat-empty').classList.add('hidden');
        document.getElementById('chat-input').classList.remove('hidden');
        document.getElementById('chat-header').classList.remove('hidden');

        const initials = ContactsView.getInitials(peerName);
        document.getElementById('chat-peer-avatar').textContent = initials;
        document.getElementById('chat-peer-name').textContent = peerName;
        const statusEl = document.getElementById('chat-peer-status');
        statusEl.textContent = isOnline ? 'Online' : 'Offline';
        statusEl.className = `chat-status ${isOnline ? 'online' : ''}`;

        markConversationRead(conversationId);
        await this.loadMessages();
        this.subscribeMessages();
        this.restoreDraft(); // 2.5
        document.getElementById('message-input').focus();
    },

    // ── Load Messages ────────────────────────────────────────────────

    async loadMessages() {
        const messagesEl = document.getElementById('chat-messages');
        messagesEl.innerHTML = '';

        try {
            const messages = await getMessages(this.currentConversationId);
            let lastDate = null;

            for (const msg of messages) {
                const msgDate = new Date(msg.createdAt).toLocaleDateString();
                if (msgDate !== lastDate) {
                    lastDate = msgDate;
                    const divider = document.createElement('div');
                    divider.className = 'message-date-divider';
                    divider.textContent = this.formatDateDivider(msg.createdAt);
                    messagesEl.appendChild(divider);
                }

                if (msg.isEncrypted && msg.type === 'text') {
                    try {
                        const peerId = msg.senderId === App.currentUser.$id ? this.currentPeerId : msg.senderId;
                        const sharedKey = await getConversationEncryptionKey(App.currentUser.$id, peerId);
                        if (sharedKey) {
                            msg._decryptedContent = await Encryption.decryptMessage(sharedKey, msg.content);
                        } else {
                            msg._decryptedContent = '[Encryption key unavailable]';
                        }
                    } catch (e) {
                        msg._decryptedContent = '[Could not decrypt]';
                    }
                }

                this.appendMessage(msg, false);

                if (msg.senderId !== App.currentUser.$id) {
                    markMessageRead(msg.$id, App.currentUser.$id);
                    if (App.socket && msg.status !== 'read') {
                        App.socket.emit('message-delivered', { to: msg.senderId, messageId: msg.$id });
                    }
                }
            }

            this.scrollToBottom();
        } catch (err) {
            console.error('Failed to load messages:', err);
        }
    },

    // ── Append Message ───────────────────────────────────────────────

    appendMessage(msg, animate = true) {
        const messagesEl = document.getElementById('chat-messages');
        const isSent = msg.senderId === App.currentUser.$id;

        const group = document.createElement('div');
        group.className = `message-group ${isSent ? 'sent' : 'received'}`;
        group.dataset.msgId = msg.$id;
        group.dataset.senderId = msg.senderId;
        group.dataset.createdAt = msg.createdAt;

        // Reply quote
        if (msg.replyPreview) {
            const quote = document.createElement('div');
            quote.className = 'reply-quote';
            quote.textContent = msg.replyPreview;
            group.appendChild(quote);
        }

        let contentEl;
        switch (msg.type) {
            case 'image':
                contentEl = document.createElement('img');
                contentEl.className = 'message-image';
                contentEl.src = msg.fileUrl;
                contentEl.alt = msg.fileName || 'Image';
                contentEl.loading = 'lazy';
                contentEl.addEventListener('click', () => {
                    if (window.electronAPI) window.electronAPI.openExternal(msg.fileUrl);
                });
                break;
            case 'video':
                contentEl = document.createElement('video');
                contentEl.className = 'message-video';
                contentEl.src = msg.fileUrl;
                contentEl.controls = true;
                contentEl.preload = 'metadata';
                break;
            case 'file':
                contentEl = document.createElement('a');
                contentEl.className = 'message-file';
                contentEl.href = msg.fileUrl;
                contentEl.target = '_blank';
                contentEl.innerHTML = `
                    <div class="message-file-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </div>
                    <div class="message-file-info">
                        <div class="message-file-name">${this.escapeHtml(msg.fileName || 'File')}</div>
                        <div class="message-file-size">${formatFileSize(msg.fileSize || 0)}</div>
                    </div>`;
                break;
            default: {
                const displayContent = msg._decryptedContent || msg.content;
                contentEl = document.createElement('div');
                contentEl.className = 'message-bubble';
                contentEl.textContent = displayContent;
                if (!animate) contentEl.style.animation = 'none';
                if (msg.isEncrypted) contentEl.title = '🔒 End-to-end encrypted';
                break;
            }
        }

        // Reactions row (2.3)
        const reactionsRow = document.createElement('div');
        reactionsRow.className = 'reactions-row';
        reactionsRow.dataset.msgId = msg.$id;
        if (msg.reactions) {
            this.renderReactions(reactionsRow, msg.reactions);
        }

        // Time + delivery status + edited label
        const time = document.createElement('div');
        time.className = 'message-time';
        let timeText = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (msg.isEncrypted) timeText = '🔒 ' + timeText;
        if (msg.isEdited) timeText += ' · edited';
        time.textContent = timeText;

        if (isSent) {
            const tick = document.createElement('span');
            tick.className = 'delivery-tick';
            tick.dataset.msgId = msg.$id;
            const status = msg.status || 'sent';
            tick.innerHTML = this.getTickIcon(status);
            tick.title = status.charAt(0).toUpperCase() + status.slice(1);
            time.appendChild(tick);
        }

        group.appendChild(contentEl);
        group.appendChild(reactionsRow);
        group.appendChild(time);

        // Context menu on right-click
        group.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const displayContent = msg._decryptedContent || msg.content;
            this.showContextMenu(e.clientX, e.clientY, msg.$id, msg.senderId, displayContent, msg.createdAt, msg.type);
        });

        messagesEl.appendChild(group);
    },

    // ── Reactions (2.3) ──────────────────────────────────────────────

    renderReactions(container, reactionsStr) {
        container.innerHTML = '';
        try {
            const reactions = typeof reactionsStr === 'string' ? JSON.parse(reactionsStr) : reactionsStr;
            if (!reactions || typeof reactions !== 'object') return;
            for (const [emoji, users] of Object.entries(reactions)) {
                if (!users || users.length === 0) continue;
                const chip = document.createElement('button');
                chip.className = 'reaction-chip';
                const isMine = users.includes(App.currentUser.$id);
                if (isMine) chip.classList.add('my-reaction');
                chip.innerHTML = `${emoji} <span>${users.length}</span>`;
                chip.addEventListener('click', () => {
                    const msgId = container.dataset.msgId;
                    this.toggleReaction(msgId, emoji);
                });
                container.appendChild(chip);
            }
        } catch (e) {
            // Invalid JSON — ignore
        }
    },

    async addReaction(messageId, emoji) {
        try {
            const msg = await databases.getDocument(DATABASE_ID, COLLECTIONS.MESSAGES, messageId);
            let reactions = {};
            try { reactions = msg.reactions ? JSON.parse(msg.reactions) : {}; } catch (e) { reactions = {}; }
            if (!reactions[emoji]) reactions[emoji] = [];
            if (!reactions[emoji].includes(App.currentUser.$id)) {
                reactions[emoji].push(App.currentUser.$id);
            }
            await databases.updateDocument(DATABASE_ID, COLLECTIONS.MESSAGES, messageId, {
                reactions: JSON.stringify(reactions),
            });
            // Update UI
            const row = document.querySelector(`.reactions-row[data-msg-id="${messageId}"]`);
            if (row) this.renderReactions(row, reactions);
        } catch (e) {
            console.error('Failed to add reaction:', e);
        }
    },

    async toggleReaction(messageId, emoji) {
        try {
            const msg = await databases.getDocument(DATABASE_ID, COLLECTIONS.MESSAGES, messageId);
            let reactions = {};
            try { reactions = msg.reactions ? JSON.parse(msg.reactions) : {}; } catch (e) { reactions = {}; }
            if (!reactions[emoji]) reactions[emoji] = [];
            const idx = reactions[emoji].indexOf(App.currentUser.$id);
            if (idx >= 0) {
                reactions[emoji].splice(idx, 1);
                if (reactions[emoji].length === 0) delete reactions[emoji];
            } else {
                reactions[emoji].push(App.currentUser.$id);
            }
            await databases.updateDocument(DATABASE_ID, COLLECTIONS.MESSAGES, messageId, {
                reactions: JSON.stringify(reactions),
            });
            const row = document.querySelector(`.reactions-row[data-msg-id="${messageId}"]`);
            if (row) this.renderReactions(row, reactions);
        } catch (e) {
            console.error('Failed to toggle reaction:', e);
        }
    },

    // ── Delivery Tick Icons ──────────────────────────────────────────

    getTickIcon(status) {
        switch (status) {
            case 'sending':
                return '<svg class="tick-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/></svg>';
            case 'sent':
                return '<svg class="tick-icon" viewBox="0 0 16 16"><path d="M4 8l3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            case 'delivered':
                return '<svg class="tick-icon" viewBox="0 0 20 16"><path d="M2 8l3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8l3 3 5-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            case 'read':
                return '<svg class="tick-icon tick-read" viewBox="0 0 20 16"><path d="M2 8l3 3 5-6" fill="none" stroke="var(--accent-solid)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8l3 3 5-6" fill="none" stroke="var(--accent-solid)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
            default:
                return '';
        }
    },

    updateMessageStatus(messageId, status) {
        const tick = document.querySelector(`.delivery-tick[data-msg-id="${messageId}"]`);
        if (tick) {
            tick.innerHTML = this.getTickIcon(status);
            tick.title = status.charAt(0).toUpperCase() + status.slice(1);
        }
    },

    // ── Context Menu ─────────────────────────────────────────────────

    showContextMenu(x, y, msgId, senderId, content, createdAt, type) {
        const menu = document.getElementById('message-context-menu');
        const deleteBtn = document.getElementById('ctx-delete');
        const editBtn = document.getElementById('ctx-edit');

        this.contextMenuTarget = { msgId, senderId, content, createdAt, type };

        const isMine = senderId === App.currentUser.$id;
        const ageMs = Date.now() - new Date(createdAt).getTime();

        // Only show edit for own text messages within 15 min
        editBtn.classList.toggle('hidden', !isMine || type !== 'text' || ageMs > this.MESSAGE_EDIT_WINDOW_MS);
        // Only show delete for own messages within 5 min
        deleteBtn.classList.toggle('hidden', !isMine || ageMs > this.MESSAGE_DELETE_WINDOW_MS);

        menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
        menu.style.top = `${Math.min(y, window.innerHeight - 200)}px`;
        menu.classList.remove('hidden');
    },

    handleContextReply() {
        document.getElementById('message-context-menu').classList.add('hidden');
        if (!this.contextMenuTarget) return;
        const { msgId, content } = this.contextMenuTarget;
        this.replyingTo = { id: msgId, content: (content || '').substring(0, 100) };
        document.getElementById('reply-preview-text').textContent = this.replyingTo.content || '[media]';
        document.getElementById('reply-preview-bar').classList.remove('hidden');
        document.getElementById('message-input').focus();
    },

    handleContextReact() {
        const menu = document.getElementById('message-context-menu');
        const picker = document.getElementById('emoji-picker');
        picker.style.left = menu.style.left;
        picker.style.top = `${parseInt(menu.style.top) - 50}px`;
        menu.classList.add('hidden');
        picker.classList.remove('hidden');
    },

    // ── Edit Message (2.2) ───────────────────────────────────────────

    handleContextEdit() {
        document.getElementById('message-context-menu').classList.add('hidden');
        if (!this.contextMenuTarget) return;
        const { msgId, content, senderId, createdAt } = this.contextMenuTarget;
        if (senderId !== App.currentUser.$id) return;
        if (Date.now() - new Date(createdAt).getTime() > this.MESSAGE_EDIT_WINDOW_MS) return;

        this.editingMessage = { id: msgId, originalContent: content };
        const input = document.getElementById('message-input');
        input.value = content;
        input.focus();
        input.classList.add('editing-active');

        // Show edit bar (reuse reply bar)
        document.getElementById('reply-preview-text').textContent = '✏️ Editing message';
        document.getElementById('reply-preview-bar').classList.remove('hidden');
    },

    cancelEdit() {
        this.editingMessage = null;
        document.getElementById('message-input').classList.remove('editing-active');
        document.getElementById('reply-preview-bar').classList.add('hidden');
    },

    async saveEdit(newContent) {
        if (!this.editingMessage) return;
        try {
            await databases.updateDocument(DATABASE_ID, COLLECTIONS.MESSAGES, this.editingMessage.id, {
                content: newContent,
                isEdited: true,
            });
            // Update UI
            const el = document.querySelector(`[data-msg-id="${this.editingMessage.id}"]`);
            if (el) {
                const bubble = el.querySelector('.message-bubble');
                if (bubble) bubble.textContent = newContent;
                const time = el.querySelector('.message-time');
                if (time && !time.textContent.includes('edited')) {
                    time.textContent = time.textContent + ' · edited';
                }
            }
            this.cancelEdit();
        } catch (e) {
            console.error('Failed to edit message:', e);
        }
    },

    // ── Delete for Everyone (2.2) ────────────────────────────────────

    async handleContextDelete() {
        document.getElementById('message-context-menu').classList.add('hidden');
        if (!this.contextMenuTarget) return;
        const { msgId, senderId, createdAt } = this.contextMenuTarget;
        if (senderId !== App.currentUser.$id) return;
        if (Date.now() - new Date(createdAt).getTime() > this.MESSAGE_DELETE_WINDOW_MS) return;

        try {
            await databases.deleteDocument(DATABASE_ID, COLLECTIONS.MESSAGES, msgId);
            const el = document.querySelector(`[data-msg-id="${msgId}"]`);
            if (el) {
                el.style.animation = 'messageIn 0.2s ease reverse forwards';
                setTimeout(() => el.remove(), 200);
            }
        } catch (err) {
            console.error('Failed to delete message:', err);
        }
    },

    cancelReply() {
        this.replyingTo = null;
        document.getElementById('reply-preview-bar').classList.add('hidden');
        document.getElementById('reply-preview-text').textContent = '';
    },

    // ── Message Subscription ─────────────────────────────────────────

    subscribeMessages() {
        if (this.messageSubscription) {
            this.messageSubscription();
            this.messageSubscription = null;
        }

        this.messageSubscription = subscribeToMessages(
            this.currentConversationId,
            async (events, payload) => {
                const isCreate = events.some((e) => e.includes('.create'));
                const isDelete = events.some((e) => e.includes('.delete'));
                const isUpdate = events.some((e) => e.includes('.update'));

                if (isDelete) {
                    const el = document.querySelector(`[data-msg-id="${payload.$id}"]`);
                    if (el) {
                        el.style.animation = 'messageIn 0.2s ease reverse forwards';
                        setTimeout(() => el.remove(), 200);
                    }
                    return;
                }

                if (isUpdate) {
                    // Handle edit
                    if (payload.isEdited) {
                        const el = document.querySelector(`[data-msg-id="${payload.$id}"]`);
                        if (el) {
                            const bubble = el.querySelector('.message-bubble');
                            if (bubble) bubble.textContent = payload.content;
                            const time = el.querySelector('.message-time');
                            if (time && !time.textContent.includes('edited')) {
                                time.textContent = time.textContent + ' · edited';
                            }
                        }
                    }
                    // Handle reaction updates
                    if (payload.reactions) {
                        const row = document.querySelector(`.reactions-row[data-msg-id="${payload.$id}"]`);
                        if (row) this.renderReactions(row, payload.reactions);
                    }
                    // Handle status updates
                    if (payload.senderId === App.currentUser.$id) {
                        this.updateMessageStatus(payload.$id, payload.status || 'sent');
                    }
                    return;
                }

                if (isCreate && payload.senderId !== App.currentUser.$id) {
                    if (payload.isEncrypted && payload.type === 'text') {
                        try {
                            const sharedKey = await getConversationEncryptionKey(App.currentUser.$id, payload.senderId);
                            if (sharedKey) {
                                payload._decryptedContent = await Encryption.decryptMessage(sharedKey, payload.content);
                            } else {
                                payload._decryptedContent = '[Encryption key unavailable]';
                            }
                        } catch (e) {
                            payload._decryptedContent = '[Could not decrypt]';
                        }
                    }

                    this.appendMessage(payload, true);
                    this.scrollToBottom();
                    markMessageRead(payload.$id, App.currentUser.$id);

                    if (App.socket) {
                        App.socket.emit('message-delivered', { to: payload.senderId, messageId: payload.$id });
                        App.socket.emit('message-read', { to: payload.senderId, messageId: payload.$id });
                    }

                    if (document.hidden || !document.hasFocus()) {
                        let notifBody = payload._decryptedContent || payload.content?.substring(0, 100) || '';
                        if (payload.type === 'image') notifBody = '📷 Sent a photo';
                        if (payload.type === 'video') notifBody = '🎬 Sent a video';
                        if (payload.type === 'file') notifBody = `📎 ${payload.fileName}`;
                        this.showInAppNotification(this.currentPeerName, notifBody);
                    }

                    if (window.electronAPI) {
                        let notifBody = payload._decryptedContent || payload.content?.substring(0, 100) || '';
                        if (payload.type === 'image') notifBody = '📷 Sent a photo';
                        if (payload.type === 'video') notifBody = '🎬 Sent a video';
                        if (payload.type === 'file') notifBody = `📎 ${payload.fileName}`;
                        window.electronAPI.showNotification(this.currentPeerName, notifBody);
                    }
                }
            }
        );
    },

    // ── In-App Notification ──────────────────────────────────────────

    showInAppNotification(senderName, text) {
        const existing = document.querySelector('.in-app-notification');
        if (existing) existing.remove();
        const notif = document.createElement('div');
        notif.className = 'in-app-notification';
        notif.innerHTML = `
            <div class="notif-avatar">${ContactsView.getInitials(senderName)}</div>
            <div class="notif-body">
                <div class="notif-name">${this.escapeHtml(senderName)}</div>
                <div class="notif-text">${this.escapeHtml(text)}</div>
            </div>`;
        document.body.appendChild(notif);
        setTimeout(() => { notif.classList.add('hiding'); setTimeout(() => notif.remove(), 300); }, 4000);
        notif.addEventListener('click', () => { notif.classList.add('hiding'); setTimeout(() => notif.remove(), 300); });
    },

    // ── Send / Edit Message ──────────────────────────────────────────

    async handleSend() {
        const input = document.getElementById('message-input');
        const content = input.value.trim();

        if (this.isTyping && App.socket && this.currentPeerId) {
            this.isTyping = false;
            clearTimeout(this.typingTimeout);
            App.socket.emit('typing-stop', { to: this.currentPeerId });
        }

        // Handle edit mode (2.2)
        if (this.editingMessage) {
            if (content && content !== this.editingMessage.originalContent) {
                await this.saveEdit(content);
            } else {
                this.cancelEdit();
            }
            input.value = '';
            this.clearDraft();
            return;
        }

        if (this.pendingFile) {
            const file = this.pendingFile;
            this.clearPendingFile();
            try {
                const uploaded = await uploadFile(file);
                const msg = await sendMessage(
                    this.currentConversationId, App.currentUser.$id,
                    content || file.name, uploaded.fileType,
                    uploaded.fileUrl, uploaded.fileName, uploaded.fileSize,
                    this.currentPeerId,
                    this.replyingTo?.id || '', this.replyingTo?.content || ''
                );
                this.cancelReply();
                msg.status = 'sent';
                this.appendMessage(msg, true);
                this.scrollToBottom();
                ContactsView.loadConversations();
            } catch (err) {
                console.error('Failed to upload file:', err);
                this.showRetryBanner('File upload failed', () => this.handleSend());
            }
            input.value = '';
            this.clearDraft();
            return;
        }

        if (!content || !this.currentConversationId) return;
        input.value = '';
        this.clearDraft();

        const tempId = 'temp_' + Date.now();
        const tempMsg = {
            $id: tempId,
            senderId: App.currentUser.$id,
            content: content,
            type: 'text',
            createdAt: new Date().toISOString(),
            status: 'sending',
            isEncrypted: false,
            replyPreview: this.replyingTo?.content || '',
        };
        this.appendMessage(tempMsg, true);
        this.scrollToBottom();

        try {
            const msg = await sendMessage(
                this.currentConversationId, App.currentUser.$id,
                content, 'text', '', '', 0,
                this.currentPeerId,
                this.replyingTo?.id || '', this.replyingTo?.content || ''
            );
            this.cancelReply();
            const tempEl = document.querySelector(`[data-msg-id="${tempId}"]`);
            if (tempEl) {
                tempEl.dataset.msgId = msg.$id;
                tempEl.dataset.createdAt = msg.createdAt;
                const tick = tempEl.querySelector('.delivery-tick');
                if (tick) { tick.dataset.msgId = msg.$id; tick.innerHTML = this.getTickIcon('sent'); tick.title = 'Sent'; }
                const reactRow = tempEl.querySelector('.reactions-row');
                if (reactRow) reactRow.dataset.msgId = msg.$id;
            }
            ContactsView.loadConversations();
        } catch (err) {
            console.error('Failed to send message:', err);
            const tempEl = document.querySelector(`[data-msg-id="${tempId}"]`);
            if (tempEl) {
                const tick = tempEl.querySelector('.delivery-tick');
                if (tick) {
                    tick.innerHTML = '<svg class="tick-icon tick-failed" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--red)" stroke-width="1.5"/><line x1="6" y1="6" x2="10" y2="10" stroke="var(--red)" stroke-width="1.5"/></svg>';
                    tick.title = 'Failed — click to retry';
                    tick.style.cursor = 'pointer';
                    tick.addEventListener('click', () => { tempEl.remove(); document.getElementById('message-input').value = content; });
                }
            }
        }
    },

    showRetryBanner(text, retryFn) {
        const existing = document.querySelector('.retry-banner');
        if (existing) existing.remove();
        const banner = document.createElement('div');
        banner.className = 'retry-banner';
        banner.innerHTML = `<span>${text}</span><button class="retry-btn">Retry</button>`;
        banner.querySelector('.retry-btn').addEventListener('click', () => { banner.remove(); retryFn(); });
        document.getElementById('chat-messages').appendChild(banner);
        setTimeout(() => banner.remove(), 10000);
    },

    clearPendingFile() {
        this.pendingFile = null;
        document.getElementById('file-preview-bar').classList.add('hidden');
        document.getElementById('file-input').value = '';
    },

    scrollToBottom() {
        const messagesEl = document.getElementById('chat-messages');
        requestAnimationFrame(() => { messagesEl.scrollTop = messagesEl.scrollHeight; });
    },

    formatDateDivider(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
