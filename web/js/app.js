function requireAuth() {
    if (!Api.authToken) {
        window.location.hash = '#login';
        return false;
    }
    return true;
}

function logout() {
    Api.post('/logout').then(() => {
        Api.clearToken();
        window.location.hash = '#login';
    });
}

function renderChats(container) {
    if (!requireAuth()) return;
    if (Chats.chats.length === 0) {
        Chats.init();
    }
    container.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-placeholder';
    placeholder.textContent = 'Select a chat to start messaging';
    container.appendChild(placeholder);

    document.getElementById('new-chat-btn').onclick = () => Chats.showCreateChatMenu();
}

function renderSettings(container) {
    if (!requireAuth()) return;
    container.innerHTML = '<h2>Settings</h2>';
}


Router.add('login', Auth.renderLogin.bind(Auth));
Router.add('register', Auth.renderRegister.bind(Auth));
Router.add('chats', renderChats);
Router.add('settings', renderSettings);

(async function () {
    if (!Api.authToken) {
        const restored = await Api.refreshToken();
        if (restored) {
            window.location.hash = '#chats';
        } else {
            window.location.hash = '#login';
        }
    } else {
        window.location.hash = '#chats';
    }

    window.addEventListener('hashchange', () => Router.load());
    Router.load();
})();