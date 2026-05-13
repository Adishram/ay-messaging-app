// auth.js — Auth / Setup UI Flow (Create + Restore)

const AuthView = {
    currentTab: 'create',

    init() {
        // Tab switching
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                this.currentTab = e.target.dataset.tab;
                document.getElementById('auth-create-panel').classList.toggle('hidden', this.currentTab !== 'create');
                document.getElementById('auth-restore-panel').classList.toggle('hidden', this.currentTab !== 'restore');
            });
        });

        // Create account form
        document.getElementById('form-create').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleCreate();
        });

        // Restore account form
        document.getElementById('form-restore').addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleRestore();
        });

        // Copy mnemonic button
        document.getElementById('btn-copy-mnemonic').addEventListener('click', () => {
            if (App.currentUser && App.currentUser.mnemonic) {
                const text = App.currentUser.mnemonic.join(' ');
                navigator.clipboard.writeText(text);
                const btn = document.getElementById('btn-copy-mnemonic');
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = 'Copy Words', 2000);
            }
        });

        // Confirm mnemonic (proceed to main view)
        document.getElementById('btn-confirm-mnemonic').addEventListener('click', async () => {
            document.getElementById('mnemonic-step').classList.add('hidden');
            await App.initializeMainView();
        });
    },

    async handleCreate() {
        const name = document.getElementById('create-name').value.trim();
        if (!name) return;

        const btn = document.getElementById('btn-create');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<span>Creating...</span>';
        btn.disabled = true;

        try {
            const identity = await createNewIdentity(name);
            App.currentUser = identity;
            await P2P.initWithIdentity(identity);

            // Show the mnemonic to the user
            this.showMnemonic(identity.mnemonic);
        } catch (err) {
            console.error('Create failed:', err);
            this.showError('create-error', err.message || 'Failed to create account.');
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    },

    showMnemonic(words) {
        const display = document.getElementById('mnemonic-display');
        display.innerHTML = '';
        words.forEach((word, i) => {
            const span = document.createElement('span');
            span.className = 'mnemonic-word';
            span.innerHTML = `<small>${i + 1}</small>${word}`;
            display.appendChild(span);
        });

        // Show the mnemonic step, hide the form
        document.getElementById('auth-create-panel').classList.add('hidden');
        document.getElementById('auth-restore-panel').classList.add('hidden');
        document.querySelector('.auth-tabs').classList.add('hidden');
        document.getElementById('mnemonic-step').classList.remove('hidden');
    },

    async handleRestore() {
        const wordsInput = document.getElementById('restore-words').value.trim().toLowerCase();
        const name = document.getElementById('restore-name').value.trim();
        
        if (!wordsInput || !name) {
            this.showError('restore-error', 'Please fill in all fields.');
            return;
        }

        const words = wordsInput.split(/\s+/);
        if (words.length !== 8) {
            this.showError('restore-error', 'Please enter exactly 8 words.');
            return;
        }

        // Validate words are in BIP-39 wordlist
        const invalid = words.filter(w => !BIP39_WORDLIST.includes(w));
        if (invalid.length > 0) {
            this.showError('restore-error', `Invalid words: ${invalid.join(', ')}`);
            return;
        }

        const btn = document.getElementById('btn-restore');
        const origHTML = btn.innerHTML;
        btn.innerHTML = '<span>Restoring...</span>';
        btn.disabled = true;

        try {
            const identity = await restoreFromMnemonic(words, name);
            App.currentUser = identity;
            await P2P.initWithIdentity(identity);
            await App.initializeMainView();
        } catch (err) {
            console.error('Restore failed:', err);
            this.showError('restore-error', err.message || 'Failed to restore account.');
        } finally {
            btn.innerHTML = origHTML;
            btn.disabled = false;
        }
    },

    showError(elementId, message) {
        document.getElementById(elementId).textContent = message;
    },

    resetUI() {
        document.getElementById('create-name').value = '';
        document.getElementById('restore-words').value = '';
        document.getElementById('restore-name').value = '';
        document.getElementById('create-error').textContent = '';
        document.getElementById('restore-error').textContent = '';
        document.getElementById('mnemonic-step').classList.add('hidden');
        document.getElementById('auth-create-panel').classList.remove('hidden');
        document.querySelector('.auth-tabs').classList.remove('hidden');
    },
};
