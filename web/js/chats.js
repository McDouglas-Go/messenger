const Chats = {
    chats: [],
    currentChatID: null,
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
            if (chat.id === this.currentChatID) {
                li.classList.add('active');
            }

            let title = '';
            if(chat.type === 'private') {
                title = `Private Chat (${chat.id.slice(0, 8)})`;
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
        if (this.currentChatID === chatId) return;
        this.currentChatID = chatId;
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

    connectWebSocket() {
        //todo
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