// settings.js — Local-first settings

const SettingsView = {
    init() {
        document.getElementById('btn-settings-back').addEventListener('click', () => {
            App.showView('main');
        });

        document.getElementById('btn-save-name').addEventListener('click', () => this.saveName());
        document.getElementById('btn-delete-account').addEventListener('click', () => this.deleteAccount());
        document.getElementById('btn-copy-userid').addEventListener('click', () => this.copyUserId());
        document.getElementById('btn-reveal-mnemonic').addEventListener('click', () => this.toggleMnemonic());
    },

    loadData() {
        const id = App.currentUser;
        if (!id) return;
        
        document.getElementById('settings-name').value = id.profile.name !== 'Anonymous' ? id.profile.name : '';
        
        // Show User ID (full hex, formatted)
        document.getElementById('settings-userid').value = id.pubKeyHex;
        
        // Hide mnemonic by default
        document.getElementById('settings-mnemonic').classList.add('hidden');
        document.getElementById('btn-reveal-mnemonic').textContent = 'Reveal';
        
        document.getElementById('name-status').textContent = '';
        document.getElementById('delete-status').textContent = '';
        document.getElementById('userid-status').textContent = '';
    },

    async saveName() {
        const newName = document.getElementById('settings-name').value.trim();
        if (!newName) return;

        const btn = document.getElementById('btn-save-name');
        btn.textContent = 'Saving...';
        btn.disabled = true;

        try {
            await updateIdentityProfile({ name: newName });
            App.currentUser = await getStoredIdentity();
            App.updateUserUI();
            this.showStatus('name-status', 'Name updated successfully', 'success');
        } catch (error) {
            console.error('Failed to update name:', error);
            this.showStatus('name-status', error.message || 'Failed to update name', 'error');
        } finally {
            btn.textContent = 'Save';
            btn.disabled = false;
        }
    },

    async copyUserId() {
        const input = document.getElementById('settings-userid');
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value);
        this.showStatus('userid-status', 'Copied to clipboard!', 'success');
        setTimeout(() => {
            document.getElementById('userid-status').textContent = '';
        }, 2000);
    },

    toggleMnemonic() {
        const container = document.getElementById('settings-mnemonic');
        const btn = document.getElementById('btn-reveal-mnemonic');
        
        if (container.classList.contains('hidden')) {
            // Show mnemonic
            const words = App.currentUser.mnemonic;
            container.innerHTML = '';
            words.forEach((word, i) => {
                const span = document.createElement('span');
                span.className = 'mnemonic-word';
                span.innerHTML = `<small>${i + 1}</small>${word}`;
                container.appendChild(span);
            });
            container.classList.remove('hidden');
            btn.textContent = 'Hide';
        } else {
            container.classList.add('hidden');
            container.innerHTML = '';
            btn.textContent = 'Reveal';
        }
    },

    async deleteAccount() {
        if (!confirm('Are you sure you want to delete your account? This will erase all your local messages, contacts, and keys. This cannot be undone.')) {
            return;
        }

        const btn = document.getElementById('btn-delete-account');
        btn.textContent = 'Deleting...';
        btn.disabled = true;

        try {
            await P2P.teardown();
            await clearIdentity();
            await clearAllData();
            
            App.currentUser = null;
            App.onlineUsers = new Set();
            AuthView.resetUI();
            App.showView('auth');
            
        } catch (error) {
            console.error('Failed to delete account:', error);
            this.showStatus('delete-status', error.message || 'Failed to delete account.', 'error');
            btn.textContent = 'Delete My Account';
            btn.disabled = false;
        }
    },

    showStatus(elementId, message, type) {
        const el = document.getElementById(elementId);
        el.textContent = message;
        el.className = 'settings-status';
        el.classList.add(type);
        setTimeout(() => {
            if (el.textContent === message) el.textContent = '';
        }, 3000);
    }
};
