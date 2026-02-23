// ── Contacts View Controller ──────────────────────────────────────
const ContactsView = {
    contacts: [],
    onlineUsers: [],

    init() {
        // Sidebar tab switching
        document.querySelectorAll('.sidebar-tab').forEach((tab) => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.sidebar-tab').forEach((t) => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.sidebar-panel').forEach((p) => p.classList.remove('active'));
                document.getElementById(`panel-${tab.dataset.panel}`).classList.add('active');
            });
        });

        // Add contact modal
        document.getElementById('btn-add-contact').addEventListener('click', () => {
            document.getElementById('modal-add-contact').classList.remove('hidden');
            document.getElementById('add-contact-email').focus();
        });

        document.getElementById('btn-cancel-add-contact').addEventListener('click', () => {
            document.getElementById('modal-add-contact').classList.add('hidden');
            document.getElementById('add-contact-email').value = '';
            document.getElementById('add-contact-error').textContent = '';
        });

        document.getElementById('btn-confirm-add-contact').addEventListener('click', async () => {
            const email = document.getElementById('add-contact-email').value.trim();
            const errorEl = document.getElementById('add-contact-error');
            errorEl.textContent = '';

            if (!email) {
                errorEl.textContent = 'Please enter an email address.';
                return;
            }

            try {
                const user = await searchUserByEmail(email);
                if (!user) {
                    errorEl.textContent = 'No user found with that email.';
                    return;
                }
                if (user.userId === App.currentUser.$id) {
                    errorEl.textContent = "You can't add yourself!";
                    return;
                }

                // Create or get conversation
                await getOrCreateConversation(App.currentUser.$id, user.userId);
                document.getElementById('modal-add-contact').classList.add('hidden');
                document.getElementById('add-contact-email').value = '';

                // Refresh conversations
                await ContactsView.loadConversations();

                // Switch to conversations tab
                document.querySelector('.sidebar-tab[data-panel="conversations"]').click();
            } catch (err) {
                errorEl.textContent = err.message || 'Failed to add contact.';
            }
        });

        // Search
        document.getElementById('search-contacts').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            document.querySelectorAll('.contact-item').forEach((item) => {
                const name = item.querySelector('.contact-name')?.textContent.toLowerCase() || '';
                item.style.display = name.includes(query) ? '' : 'none';
            });
        });

        // Logout
        document.getElementById('btn-logout').addEventListener('click', async () => {
            try {
                // Set status to offline before logging out
                if (App.currentUser) {
                    try {
                        await databases.updateDocument(
                            DATABASE_ID, COLLECTIONS.USERS, App.currentUser.$id,
                            { lastSeen: 'offline' }
                        );
                    } catch (_) { }
                }
                // Clean up all live resources (P2 #5)
                App.teardown();
                await logout();
                App.showView('auth');
            } catch (err) {
                console.error('Logout error:', err);
            }
        });
    },

    async loadConversations() {
        if (!App.currentUser) return;

        const conversations = await getConversations(App.currentUser.$id);
        const listEl = document.getElementById('conversation-list');
        listEl.innerHTML = '';

        for (const conv of conversations) {
            const otherUserId = conv.participants.find((p) => p !== App.currentUser.$id);
            const profile = await getUserProfile(otherUserId);
            if (!profile) continue;

            const initials = this.getInitials(profile.name);
            const isOnline = this.onlineUsers.includes(otherUserId);
            const time = conv.$updatedAt ? this.formatTime(conv.$updatedAt) : '';
            const draft = localStorage.getItem(`draft_${conv.$id}`) || '';

            const item = document.createElement('div');
            item.className = 'contact-item';
            item.dataset.conversationId = conv.$id;
            item.dataset.userId = otherUserId;
            item.innerHTML = `
        <div class="contact-avatar">
          ${initials}
          ${isOnline ? '<div class="online-badge"></div>' : ''}
        </div>
        <div class="contact-info">
          <div class="contact-name">${this.escapeHtml(profile.name)}</div>
          <div class="contact-preview">${draft ? '<span class="draft-label">Draft:</span> ' + this.escapeHtml(draft) : this.escapeHtml(conv.lastMessage || 'No messages yet')}</div>
        </div>
        <div class="contact-meta">
          <span class="contact-time">${time}</span>
        </div>
      `;

            item.addEventListener('click', () => {
                document.querySelectorAll('.contact-item').forEach((ci) => ci.classList.remove('active'));
                item.classList.add('active');
                ChatView.openConversation(conv.$id, otherUserId, profile.name, isOnline);
            });

            listEl.appendChild(item);
        }
    },

    updateOnlineUsers(users) {
        this.onlineUsers = users;
        // Re-render online badges
        document.querySelectorAll('.contact-item').forEach((item) => {
            const userId = item.dataset.userId;
            const badge = item.querySelector('.online-badge');
            if (users.includes(userId)) {
                if (!badge) {
                    const avatar = item.querySelector('.contact-avatar');
                    const badgeEl = document.createElement('div');
                    badgeEl.className = 'online-badge';
                    avatar.appendChild(badgeEl);
                }
            } else {
                if (badge) badge.remove();
            }
        });
    },

    getInitials(name) {
        return name
            .split(' ')
            .map((w) => w[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    },

    formatTime(isoString) {
        const date = new Date(isoString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // (2.6) Format "last seen X ago" relative time
    formatRelativeTime(isoString) {
        if (!isoString || isoString === 'online') return 'Online';
        if (isoString === 'offline') return 'Offline';

        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'Offline';

        const now = new Date();
        const diffMs = now - date;
        const diffSec = Math.floor(diffMs / 1000);
        const diffMin = Math.floor(diffSec / 60);
        const diffHr = Math.floor(diffMin / 60);
        const diffDay = Math.floor(diffHr / 24);

        if (diffMin < 1) return 'last seen just now';
        if (diffMin < 60) return `last seen ${diffMin}m ago`;
        if (diffHr < 24) return `last seen ${diffHr}h ago`;
        if (diffDay < 7) return `last seen ${diffDay}d ago`;
        return `last seen ${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
    },
};
