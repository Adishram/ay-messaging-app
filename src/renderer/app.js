// app.js — Main Application Controller

const App = {
    currentUser: null,
    socket: null, // Points to P2P.getSocket() (the signaling socket)
    currentView: 'auth',
    onlineUsers: new Set(), // Set of pubKeyHex

    async init() {
        console.log('App init...');
        
        AuthView.init();
        ContactsView.init();
        ChatView.init();
        SettingsView.init();
        VideoCallView.init();

        this.setupEventListeners();

        try {
            // Check identity, if name is Anonymous, show auth setup view
            const identity = await P2P.init();
            this.currentUser = identity;
            this.socket = P2P.getSocket();
            VideoCallView.setupSocketHandlers();

            if (identity.profile.name === 'Anonymous') {
                this.showView('auth');
            } else {
                await this.initializeMainView();
            }

            window.App = this;
        } catch (error) {
            console.error('Failed to initialize P2P:', error);
            document.getElementById('setup-error').textContent = 'Failed to connect to signaling network.';
        }
    },

    setupEventListeners() {
        document.getElementById('btn-logout').addEventListener('click', () => this.logout());
        document.getElementById('btn-settings').addEventListener('click', () => {
            SettingsView.loadData();
            this.showView('settings');
        });
    },

    async initializeMainView() {
        this.updateUserUI();
        this.showView('main');
        await ContactsView.loadConversations();
        await ContactsView.loadContacts();
        ChatView.showEmptyState();
    },

    updateUserUI() {
        if (!this.currentUser) return;
        
        const name = this.currentUser.profile.name;
        document.getElementById('current-user-name').textContent = name;
        
        const avatarEl = document.getElementById('current-user-avatar');
        avatarEl.innerHTML = `<span>${ContactsView.getInitials(name)}</span>`;
        
        if (this.currentUser.profile.avatarColor) {
            avatarEl.style.backgroundColor = this.currentUser.profile.avatarColor;
        }
    },

    async logout() {
        const confirmLogout = confirm('Are you sure you want to log out? Local data will remain on this device.');
        if (!confirmLogout) return;

        P2P.teardown();
        this.currentUser = null;
        this.socket = null;
        this.showView('auth');
    },

    showView(viewId) {
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${viewId}`).classList.add('active');
        this.currentView = viewId;
    },
    
    // Callback from P2P layer for presence
    onOnlineUsers(usersArray) {
        this.onlineUsers = new Set(usersArray);
        ContactsView.updateOnlineStatuses();
        ChatView.updateHeaderStatus();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
