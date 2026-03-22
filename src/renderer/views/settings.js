// settings.js — Local-first settings

const SettingsView = {
    init() {
        document.getElementById('btn-settings-back').addEventListener('click', () => {
            App.showView('main');
        });

        document.getElementById('btn-save-name').addEventListener('click', () => this.saveName());
        document.getElementById('btn-delete-account').addEventListener('click', () => this.deleteAccount());
        document.getElementById('btn-copy-conn').addEventListener('click', () => this.copyConnString());
    },

    loadData() {
        const id = App.currentUser;
        if (!id) return;
        
        document.getElementById('settings-name').value = id.profile.name !== 'Anonymous' ? id.profile.name : '';
        document.getElementById('settings-conn-string').value = makeConnectionString(id);
        
        document.getElementById('name-status').textContent = '';
        document.getElementById('delete-status').textContent = '';
        document.getElementById('conn-status').textContent = '';
    },

    async saveName() {
        const newName = document.getElementById('settings-name').value.trim();
        if (!newName) return;

        const btn = document.getElementById('btn-save-name');
        btn.textContent = 'Saving...';
        btn.disabled = true;

        try {
            await updateIdentityProfile({ name: newName });
            App.currentUser = await getOrCreateIdentity(); // Refresh
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

    async copyConnString() {
        const input = document.getElementById('settings-conn-string');
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value);
        this.showStatus('conn-status', 'Copied to clipboard!', 'success');
        setTimeout(() => {
            document.getElementById('conn-status').textContent = '';
        }, 2000);
    },

    async deleteAccount() {
        if (!confirm('Are you sure you want to delete your account? This will erase all your local messages, contacts, and keys. This cannot be undone.')) {
            return;
        }

        const btn = document.getElementById('btn-delete-account');
        btn.textContent = 'Deleting...';
        btn.disabled = true;

        try {
            P2P.teardown();
            await clearIdentity();
            await clearAllData();
            
            App.currentUser = null;
            document.getElementById('setup-error').textContent = 'Account deleted successfully.';
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
