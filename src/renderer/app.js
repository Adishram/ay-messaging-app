// ── App Router & Bootstrap ────────────────────────────────────────
const App = {
    currentUser: null,
    socket: null,
    conversationSubscription: null,
    lastSeenInterval: null,
    connectionBanner: null,

    async init() {
        initAppwrite();

        AuthView.init();
        ContactsView.init();
        ChatView.init();
        SettingsView.init();
        VideoCallView.init();

        // Create connection status banner
        this.createConnectionBanner();

        const user = await getCurrentUser();
        if (user) {
            this.currentUser = user;
            this.onAuthSuccess();
        } else {
            this.showView('auth');
        }
    },

    // ── Connection Banner (1.3) ──────────────────────────────────────

    createConnectionBanner() {
        const banner = document.createElement('div');
        banner.id = 'connection-banner';
        banner.className = 'connection-banner hidden';
        banner.innerHTML = `
            <span id="connection-banner-text">Reconnecting...</span>
            <button id="connection-banner-retry" class="connection-retry-btn">Retry</button>
        `;
        document.body.appendChild(banner);
        this.connectionBanner = banner;

        document.getElementById('connection-banner-retry').addEventListener('click', () => {
            if (this.socket && !this.socket.connected) {
                this.socket.connect();
            }
        });
    },

    showConnectionBanner(text, showRetry = false) {
        const banner = document.getElementById('connection-banner');
        const textEl = document.getElementById('connection-banner-text');
        const retryBtn = document.getElementById('connection-banner-retry');
        textEl.textContent = text;
        retryBtn.classList.toggle('hidden', !showRetry);
        banner.classList.remove('hidden');
    },

    hideConnectionBanner() {
        const banner = document.getElementById('connection-banner');
        if (banner) banner.classList.add('hidden');
    },

    async onAuthSuccess() {
        this.currentUser = await getCurrentUser();
        if (!this.currentUser) {
            this.showView('auth');
            return;
        }

        try {
            await ensureUserProfile(this.currentUser);
        } catch (e) {
            console.error('Profile setup error:', e);
            const loginErr = document.getElementById('login-error');
            const signupErr = document.getElementById('signup-error');
            const msg = e.message || 'Failed to set up profile.';
            if (loginErr) loginErr.textContent = msg;
            if (signupErr) signupErr.textContent = msg;
            this.showView('auth');
            return;
        }

        const initials = ContactsView.getInitials(this.currentUser.name);
        document.getElementById('current-user-avatar').textContent = initials;
        document.getElementById('current-user-name').textContent = this.currentUser.name;

        // Connect to signaling server with JWT (1.1)
        await this.connectSocket();

        VideoCallView.setupSocketHandlers();
        await ContactsView.loadConversations();
        this.subscribeConversations();

        updateLastSeen();
        if (this.lastSeenInterval) clearInterval(this.lastSeenInterval);
        this.lastSeenInterval = setInterval(() => updateLastSeen(), 60000);

        this.showView('main');
    },

    // ── Socket Connection with JWT + Auto-Reconnect (1.1 + 1.3) ─────

    async connectSocket() {
        if (this.socket) {
            this.socket.disconnect();
        }

        // Generate Appwrite JWT for signaling auth
        let jwt = null;
        try {
            const jwtResponse = await account.createJWT();
            jwt = jwtResponse.jwt;
        } catch (e) {
            console.warn('[Socket] Failed to create JWT, using fallback:', e.message);
        }

        this.socket = io('https://ay-signaling.onrender.com', {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 10000,
            timeout: 10000,
        });

        this.socket.on('connect', () => {
            console.log('[Socket] Connected');
            this.hideConnectionBanner();
            // Register with JWT
            this.socket.emit('register', this.currentUser.$id, jwt);

            // Send block list to signaling server
            this.syncBlockList();
        });

        this.socket.on('online-users', (users) => {
            ContactsView.updateOnlineUsers(users);
            if (ChatView.currentPeerId) {
                const isOnline = users.includes(ChatView.currentPeerId);
                const statusEl = document.getElementById('chat-peer-status');
                statusEl.textContent = isOnline ? 'Online' : 'Offline';
                statusEl.className = `chat-status ${isOnline ? 'online' : ''}`;
            }
        });

        // ── Connection Resilience Events (1.3) ───────────────────────

        this.socket.on('disconnect', (reason) => {
            console.log('[Socket] Disconnected:', reason);
            if (reason === 'io server disconnect') {
                this.showConnectionBanner('Disconnected by server', true);
            } else {
                this.showConnectionBanner('Reconnecting...');
            }
        });

        this.socket.on('reconnect_attempt', (attempt) => {
            this.showConnectionBanner(`Reconnecting... (attempt ${attempt})`);
        });

        this.socket.on('reconnect_failed', () => {
            this.showConnectionBanner('Connection failed', true);
        });

        this.socket.on('reconnect', () => {
            console.log('[Socket] Reconnected');
            this.hideConnectionBanner();
            this.socket.emit('register', this.currentUser.$id, jwt);
            this.syncBlockList();
        });

        this.socket.on('auth-error', ({ message }) => {
            console.error('[Socket] Auth error:', message);
            this.showConnectionBanner('Authentication failed', true);
        });

        // ── Typing indicators (Phase 2 prep) ────────────────────────

        this.socket.on('typing-start', ({ from }) => {
            if (ChatView.currentPeerId === from) {
                ChatView.showTypingIndicator(true);
            }
        });

        this.socket.on('typing-stop', ({ from }) => {
            if (ChatView.currentPeerId === from) {
                ChatView.showTypingIndicator(false);
            }
        });

        // ── Delivery state relays (1.2) ──────────────────────────────

        this.socket.on('message-delivered', ({ from, messageId }) => {
            ChatView.updateMessageStatus(messageId, 'delivered');
        });

        this.socket.on('message-read', ({ from, messageId }) => {
            ChatView.updateMessageStatus(messageId, 'read');
        });
    },

    // ── Block List Sync ──────────────────────────────────────────────

    async syncBlockList() {
        if (!this.socket || !this.currentUser) return;
        try {
            const profile = await getUserProfile(this.currentUser.$id);
            const blockedUsers = profile?.blockedUsers || [];
            this.socket.emit('update-block-list', blockedUsers);
        } catch (e) {
            console.warn('[Socket] Failed to sync block list:', e);
        }
    },

    subscribeConversations() {
        if (this.conversationSubscription) {
            this.conversationSubscription();
        }
        this.conversationSubscription = subscribeToConversations(
            this.currentUser.$id,
            (events, payload) => {
                ContactsView.loadConversations();
            }
        );
    },

    teardown() {
        if (this.lastSeenInterval) {
            clearInterval(this.lastSeenInterval);
            this.lastSeenInterval = null;
        }
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        if (this.conversationSubscription) {
            this.conversationSubscription();
            this.conversationSubscription = null;
        }
        if (VideoCallView.peer) {
            VideoCallView.cleanupCall();
        }
        if (ChatView.messageSubscription) {
            ChatView.messageSubscription();
            ChatView.messageSubscription = null;
        }
        this.currentUser = null;
        this.hideConnectionBanner();
    },

    showView(viewName) {
        document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
        const viewId = viewName === 'video-call' ? 'view-video-call' : `view-${viewName}`;
        document.getElementById(viewId)?.classList.add('active');
    },
};

// ── Bootstrap ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
