const Auth = {
    renderLogin(container) {
        container.innerHTML = `
            <div class="auth-form">
                <h2>Sign In</h2>
                <form id="login-form">
                    <input type="email" id="login-email" placeholder="Email" required>
                    <input type="password" id="login-password" placeholder="Password" required>
                    <button type="submit">Log in</button>
                </form>
                <p>Don't have an account? <a href="#register">Sign up</a></p>
            </div>
        `;
        document.getElementById('login-form').onsubmit = this.handleLogin.bind(this);
    },

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const data = await Api.post('/login', { email, password }, true);
            Api.setToken(data.access_token);
            window.location.hash = '#chats';
        } catch (err) {
            alert('Login failed: ' + err.message);
        }
    },

    renderRegister(container) {
        container.innerHTML = `
            <div class="auth-form">
                <h2>Sign Up</h2>
                <form id="register-form">
                    <input type="text" id="reg-username" placeholder="Username" required>
                    <input type="email" id="reg-email" placeholder="Email" required>
                    <input type="text" id="reg-displayname" placeholder="Display Name" required>
                    <input type="password" id="reg-password" placeholder="Password" required>
                    <input type="password" id="reg-password-confirm" placeholder="Confirm Password" required>
                    <button type="submit">Create Account</button>
                </form>
                <p>Already have an account? <a href="#login">Log in</a></p>
            </div>
        `;
        document.getElementById('register-form').onsubmit = this.handleRegister.bind(this);
    },

    async handleRegister(e) {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const email = document.getElementById('reg-email').value;
        const displayName = document.getElementById('reg-displayname').value;
        const password = document.getElementById('reg-password').value;
        const passwordConfirm = document.getElementById('reg-password-confirm').value;

        try {
            await Api.post('/register', {
                username,
                email,
                password,
                password_confirm: passwordConfirm,
                display_name: displayName
            }, true);
            alert('Registration successful! Please log in.');
            window.location.hash = '#login';
        } catch (err) {
            alert('Registration failed: ' + err.message);
        }
    }
};