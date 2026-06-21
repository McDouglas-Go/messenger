function requireAuth() {
    if (!Api.authToken) {
        window.location.hash = '#login';
        return false;
    }
    return true;
}

function logout() {
    if (Chats.ws) {
        Chats.ws.close(1000, 'logout');  
    }
    Api.post('/logout').then(() => {
        Api.clearToken();
        window.location.hash = '#login';
    });
}

function renderChats(container) {
    if (!requireAuth()) return;
    container.classList.remove('chat-open');
    if (Chats.chats.length === 0) {
        Chats.init();
    }
    container.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-placeholder';
    placeholder.textContent = 'Select a chat to start messaging';
    container.appendChild(placeholder);

    const createChatBtn = document.getElementById('create-chat-btn');
    if (createChatBtn) {
        createChatBtn.addEventListener('click', () => {
            if (!requireAuth()) return;
            Chats.showCreateChatMenu();
        });
    }

    const chatsBtn = document.getElementById('chats-btn');
    if (chatsBtn) {
        chatsBtn.addEventListener('click', () => {
            window.location.hash = '#chats';
            Chats.currentChatId = null;
            Chats.currentChatDetail = null;
            const main = document.getElementById('main');
            if (main) {
                main.classList.remove('chat-open');
                main.innerHTML = '<div class="chat-placeholder">Select a chat to start messaging</div>';
            }
            document.querySelectorAll('#chat-list .active').forEach(li => li.classList.remove('active'));
        });
    }
    const profileBtn = document.getElementById('profile-btn');
    if (profileBtn) {
        profileBtn.addEventListener('click', () => {
            window.location.hash = '#profile';
        });
    }
}

function renderSettings(container) {
    if (!requireAuth()) return;
    container.innerHTML = '<h2>Settings</h2>';
}

function renderProfile(container) {
    if (!requireAuth()) return;
    Profile.render(container); 
}


Router.add('login', Auth.renderLogin.bind(Auth));
Router.add('register', Auth.renderRegister.bind(Auth));
Router.add('chats', renderChats);
Router.add('settings', renderSettings);
Router.add('profile', renderProfile);

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