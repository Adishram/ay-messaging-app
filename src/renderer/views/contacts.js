// contacts.js — Manage Contacts and Conversations locally

const ContactsView = {
    conversations: [],
    contacts: [],

    init() {
        // Tab switching
        document.querySelectorAll('.sidebar-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.remove('active'));
                
                e.target.classList.add('active');
                const panelId = `panel-${e.target.dataset.panel}`;
                document.getElementById(panelId).classList.add('active');
            });
        });

        // Search
        document.getElementById('search-contacts').addEventListener('input', (e) => {
            this.handleSearch(e.target.value);
        });

        // Add Contact Modal
        document.getElementById('btn-add-contact').addEventListener('click', () => {
            document.getElementById('modal-add-contact').classList.remove('hidden');
            setTimeout(() => document.getElementById('add-contact-string').focus(), 100);
        });

        document.getElementById('btn-cancel-add-contact').addEventListener('click', () => {
            document.getElementById('modal-add-contact').classList.add('hidden');
            document.getElementById('add-contact-string').value = '';
            document.getElementById('add-contact-error').textContent = '';
        });

        document.getElementById('btn-confirm-add-contact').addEventListener('click', () => this.addContact());
        
        // Handle enter key in add contact
        document.getElementById('add-contact-string').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addContact();
        });
    },

    async loadConversations() {
        try {
            this.conversations = await getConversationsLocal();
            this.renderConversations();
        } catch (error) {
            console.error('Failed to load conversations:', error);
        }
    },

    async loadContacts() {
        try {
            this.contacts = await getAllContacts();
            this.renderContacts();
        } catch (error) {
            console.error('Failed to load contacts:', error);
        }
    },

    async addContact() {
        const inputString = document.getElementById('add-contact-string').value.trim();
        const errorEl = document.getElementById('add-contact-error');
        const btn = document.getElementById('btn-confirm-add-contact');
        
        if (!inputString) return;

        btn.innerHTML = '<span>Connecting...</span>';
        btn.disabled = true;
        errorEl.textContent = '';

        try {
            // Initiate P2P connection to exchange profiles
            const pubKeyHex = await P2P.connectFromString(inputString);
            
            // Wait shortly for profile exchange if online
            await new Promise(res => setTimeout(res, 2000));
            
            // Check if contact was added (P2P layer upserts it when profile received)
            let contact = await getContact(pubKeyHex);
            
            if (!contact) {
                // Not online immediately, add placeholder
                contact = {
                    pubKeyHex,
                    profile: { name: 'Unknown User', avatarColor: '#9e9e9e' }
                };
                await upsertContact(contact);
            }

            // Create a conversation implicitly
            const conv = await getOrCreateConversationLocal(App.currentUser.pubKeyHex, pubKeyHex);

            document.getElementById('modal-add-contact').classList.add('hidden');
            document.getElementById('add-contact-string').value = '';
            
            // Reload views
            await this.loadContacts();
            await this.loadConversations();
            
            // Switch to chats tab
            document.querySelector('[data-panel="conversations"]').click();
            ChatView.openConversation(conv, contact);

        } catch (error) {
            console.error('Add contact failed:', error);
            errorEl.textContent = 'Invalid connection string or connection failed.';
        } finally {
            btn.innerHTML = '<span>Connect</span>';
            btn.disabled = false;
        }
    },

    renderConversations(filterText = '') {
        const listEl = document.getElementById('conversation-list');
        listEl.innerHTML = '';

        // Hydrate conversations with contact profiles
        const hydrated = this.conversations.map(conv => {
            const contact = this.contacts.find(c => c.pubKeyHex === conv.peerPubKeyHex) || 
                          { profile: { name: 'Unknown', avatarColor: '#9e9e9e' }};
            return { ...conv, peerProfile: contact.profile };
        });

        const filtered = hydrated.filter(conv => 
            conv.peerProfile.name.toLowerCase().includes(filterText.toLowerCase())
        );

        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">No chats found</div>';
            return;
        }

        filtered.forEach(conv => {
            const isOnline = App.onlineUsers.has(conv.peerPubKeyHex);
            const initials = this.getInitials(conv.peerProfile.name);
            const timeStr = conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';
            const previewText = conv.lastMessagePreview || 'Started a conversation';
            const isActive = ChatView.currentConversation?.id === conv.id;

            const item = document.createElement('div');
            item.className = `contact-item ${isActive ? 'active' : ''}`;
            item.onclick = () => ChatView.openConversation(
                this.conversations.find(c => c.id === conv.id), 
                this.contacts.find(c => c.pubKeyHex === conv.peerPubKeyHex)
            );

            item.innerHTML = `
                <div class="contact-avatar" style="background-color: ${conv.peerProfile.avatarColor}">
                    ${initials}
                    <div class="status-indicator ${isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="contact-info">
                    <div class="contact-header">
                        <span class="contact-name">${this.escapeHtml(conv.peerProfile.name)}</span>
                        <span class="contact-time">${timeStr}</span>
                    </div>
                    <span class="contact-preview">${this.escapeHtml(previewText)}</span>
                </div>
            `;
            listEl.appendChild(item);
        });
    },

    renderContacts(filterText = '') {
        const listEl = document.getElementById('contact-list');
        listEl.innerHTML = '';

        const filtered = this.contacts.filter(contact => 
            contact.profile.name.toLowerCase().includes(filterText.toLowerCase())
        );

        if (filtered.length === 0) {
            listEl.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">No contacts found</div>';
            return;
        }

        filtered.forEach(contact => {
            const isOnline = App.onlineUsers.has(contact.pubKeyHex);
            const initials = this.getInitials(contact.profile.name);

            const item = document.createElement('div');
            item.className = `contact-item`;
            item.onclick = async () => {
                const conv = await getOrCreateConversationLocal(App.currentUser.pubKeyHex, contact.pubKeyHex);
                document.querySelector('[data-panel="conversations"]').click();
                ChatView.openConversation(conv, contact);
            };

            item.innerHTML = `
                <div class="contact-avatar" style="background-color: ${contact.profile.avatarColor}">
                    ${initials}
                    <div class="status-indicator ${isOnline ? 'online' : 'offline'}"></div>
                </div>
                <div class="contact-info" style="justify-content: center">
                    <span class="contact-name">${this.escapeHtml(contact.profile.name)}</span>
                </div>
            `;
            listEl.appendChild(item);
        });
    },

    handleSearch(text) {
        const isChatsTab = document.querySelector('[data-panel="conversations"]').classList.contains('active');
        if (isChatsTab) {
            this.renderConversations(text);
        } else {
            this.renderContacts(text);
        }
    },

    updateOnlineStatuses() {
        // Just re-render the current lists to update the green dots
        this.renderConversations(document.getElementById('search-contacts').value);
        this.renderContacts(document.getElementById('search-contacts').value);
    },

    getInitials(name) {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    },

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};
