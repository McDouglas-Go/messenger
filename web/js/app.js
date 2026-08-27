function requireAuth() {
    if (!Api.authToken) {
        window.location.hash = '#login';
        return false;
    }
    return true;
}

async function logout() {
    if (Chats.ws) {
        Chats.ws.close(1000, 'logout');  
    }
    const userId = Api.userId;

    await Api.post('/logout');
    Api.clearToken();

    if (typeof KeyStorage !== 'undefined' && KeyStorage.deleteKeys && userId) {
        try {
            await KeyStorage.deleteKeys(String(userId));
        } catch (e) {
            console.error('Failed to delete user keys', e);
        }
    }
    window.location.hash = '#login';
}

function renderChats(container) {
    if (!requireAuth()) return;
    Profile._restoreSidebar();
    container.classList.remove('chat-open');
    if (Chats.chats.length === 0) {
        Chats.init();
    }
    container.innerHTML = '';
    const placeholder = document.createElement('div');
    placeholder.className = 'chat-placeholder';
    placeholder.textContent = 'Select a chat to start messaging';
    container.appendChild(placeholder);
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

document.addEventListener('DOMContentLoaded', () => {
    const chatsBtn = document.getElementById('chats-btn');
    if (chatsBtn) {
        chatsBtn.addEventListener('click', () => {
            Profile._restoreSidebar();
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
    const createChatBtn = document.getElementById('create-chat-btn');
    if (createChatBtn) {
        createChatBtn.addEventListener('click', () => Chats.showCreateChatMenu());
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        e.preventDefault();
        const backBtn = document.querySelector('.back-btn:not([disabled])');
        if (backBtn) backBtn.click();
    }
});

(async function () {
    const currentHash = window.location.hash.substring(1);
    if (!Api.authToken) {
        const restored = await Api.refreshToken();
        if (restored) {
            if (!currentHash || currentHash === 'login') {
                window.location.hash = '#chats';
            }
        } else {
            window.location.hash = '#login';
        }
    } else {
        if (!currentHash || currentHash === 'login') {
            window.location.hash = '#chats';
        }
    }

    window.addEventListener('hashchange', () => Router.load());
    Router.load();
})();