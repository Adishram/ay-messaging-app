// ── Auth View Controller ──────────────────────────────────────────
const AuthView = {
    init() {
        // ── Tab switching (both the tab buttons AND the text links) ────
        function showLogin() {
            document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
            document.querySelector('.auth-tab[data-tab="login"]').classList.add('active');
            document.getElementById('form-login').classList.remove('hidden');
            document.getElementById('form-signup').classList.add('hidden');
        }

        function showSignup() {
            document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
            document.querySelector('.auth-tab[data-tab="signup"]').classList.add('active');
            document.getElementById('form-login').classList.add('hidden');
            document.getElementById('form-signup').classList.remove('hidden');
        }

        // Tab buttons
        document.querySelectorAll('.auth-tab').forEach((tab) => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                if (tab.dataset.tab === 'login') showLogin();
                else showSignup();
            });
        });

        // Explicit text links
        document.getElementById('switch-to-signup').addEventListener('click', (e) => {
            e.preventDefault();
            showSignup();
        });
        document.getElementById('switch-to-login').addEventListener('click', (e) => {
            e.preventDefault();
            showLogin();
        });

        // ── Login form ────────────────────────────────────────────────
        document.getElementById('form-login').addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            errorEl.textContent = '';

            try {
                await login(email, password);
                App.onAuthSuccess();
            } catch (err) {
                errorEl.textContent = err.message || 'Login failed. Please try again.';
            }
        });

        // ── Signup form ───────────────────────────────────────────────
        document.getElementById('form-signup').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('signup-name').value.trim();
            const email = document.getElementById('signup-email').value.trim();
            const password = document.getElementById('signup-password').value;
            const errorEl = document.getElementById('signup-error');
            errorEl.textContent = '';

            try {
                await signUp(email, password, name);
                App.onAuthSuccess();
            } catch (err) {
                errorEl.textContent = err.message || 'Sign up failed. Please try again.';
            }
        });
    },
};
