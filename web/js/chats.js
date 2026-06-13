const Chats = {
    chats: [],
    currentChatId: null,
    ws: null,

    async init() {
        await this.loadChats();
        this.connectWebSocket();
    },

    async loadChats() {
        try {
            this.chats = await Api.getChats();
            this.renderChatList();
        } catch (err) {
            console.error('Failed to load chats:', err);
        }
    },

    renderChatList() {
        const list = document.getElementById('chat-list');
        if (!list) return;
        list.innerHTML = '';
        this.chats.forEach(chat => {
            const li = document.createElement('li');
            li.dataset.chatId = chat.id;
            li.className = 'chat-item';
            if (chat.id === this.currentChatId) {
                li.classList.add('active');
            }

            let title = '';
            if(chat.type === 'private') {
                if (chat.other_user){
                    title = chat.other_user.display_name || chat.other_user.username;
                } else {
                    title = 'Unknown';
                }
            } else {
                title = chat.name || 'Group Chat';
            }

            li.innerHTML = `
                <div class="chat-avatar"></div>
                <div class="chat-info">
                    <div class="chat-title">${escapeHtml(title)}</div>
                    <div class="chat-last-msg">...</div>
                </div>
                <div class="chat-meta">
                    <div class="chat-time"></div>
                </div>
            `;
            li.addEventListener('click', () => this.selectChat(chat.id));
            list.appendChild(li);
        });
    },

    async selectChat(chatId) {
        if (this.currentChatId === chatId) return;
        this.currentChatId = chatId;
        this.renderChatList();

        const main = document.getElementById('main');
        main.innerHTML = '<h2>Loading messages...</h2>';
    },

    showCreateChatMenu() {
        const html = `
            <button id="create-private-btn">Private Chat</button>
            <button id="create-group-btn">Group Chat</button>
        `;
        Modals.createModal('create-chat-menu', html);

        document.getElementById('create-private-btn').onclick = () => {
            Modals.hide('create-chat-menu');
            Chats.showPrivateChatCreator();
        };
        document.getElementById('create-group-btn').onclick = () => {
            Modals.hide('create-chat-menu');
            Chats.showGroupChatCreator();
        };
        Modals.show('create-chat-menu');
    },

    showPrivateChatCreator() {
        const html = `
            <h3>New Private Chat</h3>
            <input type="text" id="user-search-input" placeholder="Search users...">
            <ul id="user-search-results"></ul>
            <button id="cancel-private-chat">Cancel</button>
        `;
        Modals.createModal('private-chat-modal', html);

        const searchInput = document.getElementById('user-search-input');
        const resultList = document.getElementById('user-search-results');

        let searchTimeout;
        searchInput.oninput = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const query = searchInput.value.trim();
                if (query.length < 2) {
                    resultList.innerHTML = '';
                    return;
                }
                try {
                    const users = await Api.get('/users?query=' + encodeURIComponent(query));
                    resultList.innerHTML = users.map(u => `
                        <li class="user-result-item" data-user-id="${u.id}">
                            <span>${escapeHtml(u.username)}</span>
                            <small>${escapeHtml(u.display_name)}</small>
                        </li>
                    `).join('');

                    resultList.querySelectorAll('.user-result-item').forEach(li => {
                        li.onclick = async () => {
                            const userId = li.dataset.userId;
                            Modals.hide('private-chat-modal');
                            try {
                                const chat = await Api.createPrivateChat(userId);
                                await Chats.loadChats();
                                Chats.selectChat(chat.id);
                            } catch (err) {
                                alert('Failed to create chat: ' + err.message);
                            }
                        };
                    });
                } catch (err) {
                    console.error('User search failed:', err);
                }
            }, 300);
        };

        document.getElementById('cancel-private-chat').onclick = () => Modals.hide('private-chat-modal');
        Modals.show('private-chat-modal');
        setTimeout(() => searchInput.focus(), 100);
    },
    
    showGroupChatCreator() {
        const html = `
            <h3>New Group</h3>
            <label>Group Name:</label>
            <input type="text" id="group-name-input" placeholder="Enter group name">
            <label>Add Members (search):</label>
            <input type="text" id="group-member-search" placeholder="Search users by username">
            <ul id="member-search-results"></ul>
            <div id="selected-members"></div>
            <button id="create-group-submit">Create</button>
            <button id="cancel-group-chat">Cancel</button>
        `;
        Modals.createModal('group-chat-modal', html);

        const selectedMembers = new Set(); 
        const nameInput = document.getElementById('group-name-input');
        const memberSearch = document.getElementById('group-member-search');
        const memberResults = document.getElementById('member-search-results');
        const selectedDiv = document.getElementById('selected-members');

        const renderSelected = () => {
            selectedDiv.innerHTML = Array.from(selectedMembers).map(id => {
                return `<span class="member-tag" data-user-id="${id}">${id.slice(0,8)} <button class="remove-member">&times;</button></span>`;
            }).join('');
            selectedDiv.querySelectorAll('.remove-member').forEach(btn => {
                btn.onclick = (e) => {
                    const tag = e.target.closest('.member-tag');
                    const userId = tag.dataset.userId;
                    selectedMembers.delete(userId);
                    renderSelected();
                };
            });
        };

        let searchTimeout;
        memberSearch.oninput = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const query = memberSearch.value.trim();
                if (query.length < 2) {
                    memberResults.innerHTML = '';
                    return;
                }
                try {
                    const users = await Api.get('/users?query=' + encodeURIComponent(query));
                    memberResults.innerHTML = users.map(u => `
                        <li class="user-result-item" data-user-id="${u.id}">
                            <span>${escapeHtml(u.username)}</span>
                            <small>${escapeHtml(u.display_name)}</small>
                            ${selectedMembers.has(u.id) ? ' (added)' : ''}
                        </li>
                    `).join('');
                    memberResults.querySelectorAll('.user-result-item').forEach(li => {
                        li.onclick = () => {
                            const userId = li.dataset.userId;
                            if (!selectedMembers.has(userId)) {
                                selectedMembers.add(userId);
                                renderSelected();
                                memberResults.innerHTML = '';
                                memberSearch.value = '';
                            }
                        };
                    });
                } catch (err) {
                    console.error('User search failed:', err);
                }
            }, 300);
        };

        document.getElementById('create-group-submit').onclick = async () => {
            const name = nameInput.value.trim();
            if (!name) {
                alert('Enter a group name');
                return;
            }
            if (selectedMembers.size === 0) {
                alert('Add at least one member');
                return;
            }
            try {
                const chat = await Api.createGroupChat(name, Array.from(selectedMembers));
                Modals.hide('group-chat-modal');
                await Chats.loadChats();
                Chats.selectChat(chat.id);
            } catch (err) {
                alert('Failed to create group: ' + err.message);
            }
        };

        document.getElementById('cancel-group-chat').onclick = () => Modals.hide('group-chat-modal');
        Modals.show('group-chat-modal');
    },

    async selectChat(chatId) {
        if (this.currentChatId === chatId) return;
        this.currentChatId = chatId;
        this.renderChatList(); 
        await this.loadMessages(chatId);
    },

    async loadMessages(chatId) {
        const main = document.getElementById('main');
        main.classList.remove('chat-open');
        main.innerHTML = '<div class="loading">Loading messages…</div>';

        try {
            const messages = await Api.getMessages(chatId);
            messages.forEach(m => {
                try {
                    m.text = atob(m.encrypted_content);
                } catch (e) {
                    m.text = '[encrypted]';
                }
            });
            this.renderMessages(messages);
        } catch (err) {
            main.innerHTML = `<div class="error">Failed to load messages: ${err.message}</div>`;
        }
    },

    renderMessages(messages) {
        const main = document.getElementById('main');
        main.classList.add('chat-open');
        main.innerHTML = `
            <div id="messages-container">
                <div id="messages-list"></div>
                <div id="typing-indicator" class="typing-indicator"></div>
                <form id="message-form">
                    <input type="text" id="message-input" placeholder="Write a message…" autocomplete="off">
                    <button type="submit">Send</button>
                </form>
            </div>
        `;

        const list = document.getElementById('messages-list');
        messages.forEach(msg => this.appendMessage(msg, list));

        document.getElementById('message-form').onsubmit = (e) => {
            e.preventDefault();
            this.sendMessage();
        }

        const msgInput = document.getElementById('message-input');
        let typingTimer;
        msgInput.addEventListener('input', () => {
            if (!Chats.ws || Chats.ws.readyState !== WebSocket.OPEN) return;
            Chats.ws.send(JSON.stringify({
                event: 'typing',
                data: { chat_id: Chats.currentChatId }
            }));
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                Chats.ws.send(JSON.stringify({
                    event: 'stop_typing',
                    data: { chat_id: Chats.currentChatId }
                }));
            }, 2000);
        });
        msgInput.addEventListener('keydown', () => {
            clearTimeout(typingTimer);
            if (Chats.ws && Chats.ws.readyState === WebSocket.OPEN) {
                Chats.ws.send(JSON.stringify({
                    event: 'stop_typing',
                    data: { chat_id: Chats.currentChatId }
                }));
            }
        });

        list.scrollTop = list.scrollHeight;
    },

    appendMessage(msg, container = null) {
        if (!container) container = document.getElementById('messages-list');
        if (!container) return;

        const div = document.createElement('div');
        const isOwn = (Api.userId && msg.sender_id === Api.userId);
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.setAttribute('data-message-id', msg.id)
        div.innerHTML = `
            <div class="message-content">${escapeHtml(msg.text || '')}</div>
            <div class="message-time">${new Date(msg.sent_at).toLocaleTimeString()}</div>
        `;
        container.appendChild(div);
    },

    async sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        if (!text || !this.currentChatId) return;

        const encoded = btoa(unescape(encodeURIComponent(text)));
        const nonce = btoa(Math.random().toString()).slice(0,12);

        try {
            await Api.sendMessage(this.currentChatId, encoded, nonce, 'text');
            input.value = '';
            await this.loadMessages(this.currentChatId);
        } catch (err) {
            alert('Failed to send message: ' + err.message);
        }
    },

    connectWebSocket() {
        if (!Api.authToken) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'; 
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            console.log('WebSocket connected')
            ws.send(JSON.stringify({
                event: 'auth',
                data: { token: Api.authToken }
            }));
        };
        ws.onmessage = (event) => {
            console.log('WS raw:', event.data);
            try {
                const data = JSON.parse(event.data);
                console.log('WS parsed:', data);
                if (data.event === 'auth_ok') return;
                this.handleWsEvent(data);
            } catch (e) {
                console.error('Invalid JSON in WebSocket message', e);
            }
        };
        ws.onclose = (event) => {
             console.log('WebSocket disconnected, reconnecting in 5s...', event.reason);
             setTimeout(() => this.connectWebSocket(), 5000);
        };
        ws.onerror = (event) => {
            console.error('WebSocket error', event);
            ws.close();
        };
        this.ws = ws;
    },

    handleWsEvent(data) {
        const { event, data: payload } = data;
        try {
            switch (event) {
                case 'new_message':
                    this.onNewMessage(payload);
                    break;
                case 'message_updated':
                    this.onMessageUpdated(payload);
                    break;
                case 'message_deleted':
                    this.onMessageDeleted(payload);
                    break;
                case 'typing':
                    this.onTyping(payload);
                    break;
                case 'stop_typing':
                    this.onStopTyping(payload);
                    break;
            }
        } catch (e) {
            console.error('Error processing event', event, e);
        }
    },

    onNewMessage(msg) {
        if (this.currentChatId === msg.chat_id) {
            try {
                msg.text = atob(msg.encrypted_content);
            } catch (e) {
                msg.text = '[encrypted]';
            }
            this.appendMessage(msg);
            const list = document.getElementById('messages-list');
            if (list) list.scrollTop = list.scrollHeight;
        }
        this.loadMessages(this.currentChatId);
        this.loadChats();
    },

    onMessageUpdated(updatedMsg) {
        if (this.currentChatId === msg.chat_id) {
            const existing = document.querySelector(`.message[data-message-id="${updatedMsg.id}"]`);
            if (existing) {
                try {
                    updatedMsg.text = atob(updatedMsg.encrypted_content);
                } catch (e) {
                    updatedMsg.text = '[encrypted]';
                }
                existing.querySelector('.message-content').textContent = updatedMsg.text;
                existing.querySelector('.message-time').textContent = 
                    new Date(updatedMsg.edited_at || updatedMsg.sent_at).toLocaleTimeString();
            } else {
                this.loadMessages(this.currentChatId);
            }
        }
        this.loadChats();
    },

    onMessageDeleted(payload) {
        if (this.currentChatId === msg.chat_id) {
            const msgEl = document.querySelector(`.message[data-message-id="${payload.message_id}"]`);
            if (msgEl) msgEl.remove();
        }
        this.loadChats();
    },

    onTyping(payload) {
        if (this.currentChatId !== payload.chat_id) return;
        const typingEl = document.getElementById('typing-indicator');
        if (typingEl) {
            typingEl.textContent = `${payload.user_id.slice(0,8)} is typing...`;
            typingEl.style.display = 'block';
            clearTimeout(this._typingTimeout);
            this._typingTimeout = setTimeout(() => {
                if (typingEl) typingEl.style.display = 'none';
            }, 3000);
        }
    },

    onStopTyping(payload) {
        if (this.currentChatId !== payload.chat_id) return;
        const typingEl = document.getElementById('typing-indicator');
        if (typingEl) typingEl.style.display = 'none';
    }
};

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}