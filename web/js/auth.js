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
            await Api.login(email, password);
            let keys = await KeyStorage.loadKeys(Api.userId);
            if (!keys) {
                await new Promise((resolve, reject) => {
                    this._showKeyChoiceModal(resolve, reject);
                });
                keys = await KeyStorage.loadKeys(Api.userId);
                if (!keys) {
                    throw new Error('Failed to set up encryption keys');
                }
                
            }
            window.location.hash = '#chats';
        } catch (err) {
            alert('Login failed: ' + err.message);
        }
    },

    _showKeyChoiceModal(resolve, reject) {
        const html = `
            <div class="modal-content">
                <h3>Encryption Keys Required</h3>
                <p>No encryption keys found</p>
                <p>Download your keys from other session to save access to all previous messages.
                Filename must looks like <b>your_username-your_id.json</b></p>
                <p>Generate new keys if you have not key file (You will lose access to previous messages in this session)</p>
                <div class="modal-buttons">
                    <button id="upload-key-btn">Upload Key File</button>
                    <button id="generate-keys-btn">Generate New Keys</button>
                </div>
            </div>
        `;
        Modals.createModal('key-choice-modal', html);
        Modals.show('key-choice-modal');

        document.getElementById('generate-keys-btn').onclick = async () => {
            Modals.hide('key-choice-modal');
            await this.generateAndSaveKeys();
            resolve();
        };

        document.getElementById('upload-key-btn').onclick = async () => {
            Modals.hide('key-choice-modal');
            const file = await this.selectPrivateKeyFile();
            if (!file) {
                this._showKeyChoiceModal(resolve, reject);
                return;
            }
            try {
                const text = await file.text();
                const jwk = JSON.parse(text);
                if (!jwk.d || !jwk.x || !jwk.y) throw new Error('Invalid key');
                const privateKey = await CryptoModule.importPrivateKey(jwk);
                const publicJwkObj = await crypto.subtle.exportKey('jwk', privateKey);
                delete publicJwkObj.d;
                delete publicJwkObj.key_ops;
                const publicKeyJwk = JSON.stringify(publicJwkObj);

                const serverKeyResp = await Api.get(`/users/${Api.userId}/public-key`);
                if (serverKeyResp?.public_key) {
                    const serverPublicKey = JSON.parse(serverKeyResp.public_key);
                    if (publicJwkObj.x !== serverPublicKey.x || publicJwkObj.y !== serverPublicKey.y) {
                        alert('This key does not belong to this account. Please load the correct key.');
                        this._showKeyChoiceModal(resolve, reject);
                        return;
                    }
                }
                await KeyStorage.saveKeys(Api.userId, JSON.stringify(jwk), publicKeyJwk);
                await Api.put('/me', { public_key: publicKeyJwk });
                resolve();
            } catch (e) {
                alert('Invalid key file. Please try again.');
                this._showKeyChoiceModal(resolve, reject);
            }
        };
    },

    selectPrivateKeyFile() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.onchange = (e) => {
                const file = e.target.files[0];
                resolve(file || null);
            };
            const onFocus = () => {
                window.removeEventListener('focus', onFocus);
                if (!input.files || input.files.length === 0) {
                    resolve(null);
                }
            };
            window.addEventListener('focus', onFocus, { once: true });
            input.click();
        });
    },

    async generateAndSaveKeys() {
        const keyPair = await CryptoModule.generateKeyPair();
        const privateJwkStr = await CryptoModule.exportPrivateKey(keyPair.privateKey);
        const publicJwkStr = await CryptoModule.exportPublicKey(keyPair.publicKey);
        await KeyStorage.saveKeys(Api.userId, privateJwkStr, publicJwkStr);
        await Api.put('/me', { public_key: publicJwkStr });
        const blob = new Blob([privateJwkStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'messenger_private_key.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },

    renderRegister(container) {
        container.innerHTML = `
            <div class="auth-form">
                <h2>Sign Up</h2>
                <form id="register-form">
                    <input type="email" id="reg-email" placeholder="Email" required>
                    <input type="text" id="reg-username" placeholder="Username" required>
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