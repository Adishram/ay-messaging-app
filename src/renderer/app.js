// app.js — Main Application Controller

const App = {
    currentUser: null,
    currentView: 'auth',
    onlineUsers: new Set(),

    async init() {
        console.log('App init...');
        
        AuthView.init();
        ContactsView.init();
        ChatView.init();
        SettingsView.init();
        VideoCallView.init();

        this.setupEventListeners();

        try {
            // Try to load existing identity
            const identity = await P2P.init();
            
            if (identity && identity.profile.name !== 'Anonymous') {
                this.currentUser = identity;
                await this.initializeMainView();
            } else {
                this.showView('auth');
            }

            if (window.electronAPI && window.electronAPI.onUpdateDownloaded) {
                window.electronAPI.onUpdateDownloaded(() => {
                    const btn = document.createElement('button');
                    btn.className = 'btn-primary';
                    btn.style = 'position:fixed; bottom:20px; right:20px; z-index:9999;';
                    btn.innerText = 'Update Ready - Restart';
                    btn.onclick = () => window.electronAPI.restartApp();
                    document.body.appendChild(btn);
                });
            }

            window.App = this;
        } catch (error) {
            console.error('Failed to initialize:', error);
            this.showView('auth');
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
        
        // Auto-connect to known contacts
        this.autoConnectContacts();
    },

    async autoConnectContacts() {
        try {
            const contacts = await getAllContacts();
            for (const contact of contacts) {
                P2P.connectToPeer(contact.pubKeyHex).catch(() => {});
            }
        } catch (err) {
            console.error('Auto-connect failed:', err);
        }
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

        await P2P.teardown();
        this.currentUser = null;
        this.onlineUsers = new Set();
        AuthView.resetUI();
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
