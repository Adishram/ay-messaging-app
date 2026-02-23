// ── Settings View Controller ──────────────────────────────────────
const SettingsView = {
    init() {
        // Open settings
        document.getElementById('btn-settings').addEventListener('click', () => {
            this.loadCurrentSettings();
            App.showView('settings');
        });

        // Back button
        document.getElementById('btn-settings-back').addEventListener('click', () => {
            App.showView('main');
        });

        // Upload avatar
        document.getElementById('btn-upload-avatar').addEventListener('click', () => {
            document.getElementById('avatar-file-input').click();
        });

        document.getElementById('avatar-file-input').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const statusEl = document.getElementById('avatar-status');
            statusEl.textContent = '';
            statusEl.className = 'settings-status';

            // Validate
            if (file.size > 5 * 1024 * 1024) {
                statusEl.textContent = 'File too large. Max 5MB.';
                statusEl.classList.add('error');
                return;
            }
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                statusEl.textContent = 'Only JPG, PNG, and WebP are allowed.';
                statusEl.classList.add('error');
                return;
            }

            try {
                statusEl.textContent = 'Uploading...';
                const fileUrl = await uploadProfilePicture(file);
                // Show the new image
                const imgEl = document.getElementById('settings-avatar-img');
                imgEl.src = fileUrl;
                imgEl.classList.remove('hidden');
                document.getElementById('settings-avatar-text').classList.add('hidden');

                statusEl.textContent = 'Profile picture updated!';
                statusEl.classList.add('success');

                // Update sidebar avatar too
                const sidebarAvatar = document.getElementById('current-user-avatar');
                sidebarAvatar.innerHTML = `<img src="${fileUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" />`;
            } catch (err) {
                statusEl.textContent = err.message || 'Upload failed.';
                statusEl.classList.add('error');
            }
            e.target.value = ''; // Reset file input
        });

        // Save name
        document.getElementById('btn-save-name').addEventListener('click', async () => {
            const nameInput = document.getElementById('settings-name');
            const statusEl = document.getElementById('name-status');
            statusEl.textContent = '';
            statusEl.className = 'settings-status';

            const newName = nameInput.value.trim();
            if (!newName) {
                statusEl.textContent = 'Name cannot be empty.';
                statusEl.classList.add('error');
                return;
            }

            try {
                await updateUserName(newName);
                document.getElementById('current-user-name').textContent = newName;
                statusEl.textContent = 'Name updated!';
                statusEl.classList.add('success');
            } catch (err) {
                statusEl.textContent = err.message || 'Failed to update name.';
                statusEl.classList.add('error');
            }
        });

        // Change password
        document.getElementById('btn-change-password').addEventListener('click', async () => {
            const oldPw = document.getElementById('settings-old-password').value;
            const newPw = document.getElementById('settings-new-password').value;
            const statusEl = document.getElementById('password-status');
            statusEl.textContent = '';
            statusEl.className = 'settings-status';

            if (!oldPw || !newPw) {
                statusEl.textContent = 'Please fill in both fields.';
                statusEl.classList.add('error');
                return;
            }
            if (newPw.length < 8) {
                statusEl.textContent = 'New password must be at least 8 characters.';
                statusEl.classList.add('error');
                return;
            }

            try {
                await updatePassword(oldPw, newPw);
                statusEl.textContent = 'Password changed successfully!';
                statusEl.classList.add('success');
                document.getElementById('settings-old-password').value = '';
                document.getElementById('settings-new-password').value = '';
            } catch (err) {
                statusEl.textContent = err.message || 'Failed to change password.';
                statusEl.classList.add('error');
            }
        });

        // Delete account
        document.getElementById('btn-delete-account').addEventListener('click', async () => {
            const statusEl = document.getElementById('delete-status');
            statusEl.textContent = '';
            statusEl.className = 'settings-status';

            const confirmed = confirm('Are you absolutely sure you want to delete your account? This cannot be undone.');
            if (!confirmed) return;

            const doubleConfirm = confirm('Last chance — all your messages and data will be permanently deleted.');
            if (!doubleConfirm) return;

            try {
                statusEl.textContent = 'Deleting account...';
                App.teardown();
                // Clear all drafts from localStorage
                Object.keys(localStorage).forEach((key) => {
                    if (key.startsWith('draft_')) localStorage.removeItem(key);
                });
                await deleteUserAccount();
                App.currentUser = null;
                App.showView('auth');
            } catch (err) {
                statusEl.textContent = err.message || 'Failed to delete account.';
                statusEl.classList.add('error');
            }
        });
    },

    async loadCurrentSettings() {
        if (!App.currentUser) return;

        // Load name
        document.getElementById('settings-name').value = App.currentUser.name || '';

        // Load avatar
        try {
            const profile = await getUserProfile(App.currentUser.$id);
            if (profile && profile.avatarUrl && profile.avatarUrl.startsWith('http')) {
                const imgEl = document.getElementById('settings-avatar-img');
                imgEl.src = profile.avatarUrl;
                imgEl.classList.remove('hidden');
                document.getElementById('settings-avatar-text').classList.add('hidden');
            } else {
                document.getElementById('settings-avatar-text').textContent = ContactsView.getInitials(App.currentUser.name);
                document.getElementById('settings-avatar-text').classList.remove('hidden');
                document.getElementById('settings-avatar-img').classList.add('hidden');
            }
        } catch (e) {
            document.getElementById('settings-avatar-text').textContent = ContactsView.getInitials(App.currentUser.name);
        }

        // Clear statuses
        document.querySelectorAll('.settings-status').forEach((el) => (el.textContent = ''));
        document.getElementById('settings-old-password').value = '';
        document.getElementById('settings-new-password').value = '';
    },
};
