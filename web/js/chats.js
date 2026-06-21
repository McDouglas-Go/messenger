const Chats = {
    chats: [],
    currentChatId: null,
    ws: null,
    currentChatDetail: null,

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
            if (chat.type === 'private') {
                if (chat.other_user) {
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
        await this.loadChatDetail(chatId);
        await this.loadMessages(chatId);
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
        this.showUserPicker([Api.userId], async (selectedIds) => {
            const userId = selectedIds[0];
            try {
                const chat = await Api.createPrivateChat(userId);
                await this.loadChats();
                this.selectChat(chat.id);
            } catch (err) {
                alert('Failed to create chat: ' + err.message);
            }
        }, 'Search who you want to write', true);
    },
    
    showGroupChatCreator() {
        const html = `
            <div class="modal-content" style="max-height:none; overflow:visible;">   <!-- ← исправлено -->
                <h3>New Group</h3>
                <input type="text" id="group-name-input" placeholder="Name">
                <div style="display:flex; justify-content:flex-end; margin-top:15px; gap:10px;">
                    <button id="cancel-group-name">Cancel</button>
                    <button id="next-group-name">Next</button>
                </div>
            </div>
        `;
        Modals.createModal('group-chat-modal', html);
        Modals.show('group-chat-modal');
        document.getElementById('cancel-group-name').onclick = () => {
            Modals.hide('group-chat-modal');
        };
        document.getElementById('next-group-name').onclick = () => {
            const name = document.getElementById('group-name-input').value.trim();
            if (!name) {
                alert('Enter a group name');
                return;
            }
            Modals.hide('group-chat-modal');
            Chats.showUserPicker([Api.userId], async (selectedIds) => {
                if (selectedIds.length === 0) {
                    alert('Please select at least one member');
                    return;
                }
                try {
                    const chat = await Api.createGroupChat(name, selectedIds);
                    await Chats.loadChats();
                    Chats.selectChat(chat.id);
                } catch (err) {
                    alert('Failed to create group: ' + err.message);
                }
            }, 'Add Members');
        };
    },

    async loadChatDetail(chatId) {
        try {
            const detail = await Api.get(`/chats/${chatId}`);
            this.currentChatDetail = detail;
            this.renderChatHeader();
            const sidebar = document.getElementById('chat-info-sidebar');
            if (sidebar && sidebar.style.display === 'flex') {
                this.showChatSidebar();
            }
        } catch (err) {
            console.error('Failed to load chat detail', err);
        }
    },

    renderChatHeader() {
        const header = document.getElementById('chat-header');
        if (!header || !this.currentChatDetail) return;

        const { chat, members, current_role } = this.currentChatDetail;
        let title = '';
        let subtitle = '';

        if (chat.type === 'private') {
            const other = members.find(m => m.user_id !== Api.userId);
            if (other) {
                title = other.display_name || other.username;
                subtitle = 'last seen recently';
            } 
        } else {
            title = chat.name;
            subtitle = `${members.length} members`;
        }
        header.innerHTML = `
            <div class="chat-header-info" id="chat-header-trigger">
                <div class="chat-header-title">${escapeHtml(title)}</div>
                <div class="chat-header-subtitle">${subtitle}</div>
            </div>
            <div class="chat-header-actions"></div>
        `;
        document.getElementById('chat-header-trigger').addEventListener('click', () => {
            this.showChatSidebar();
        });
    },

    showChatSidebar() {
        if (!this.currentChatDetail) return;
        const sidebar = document.getElementById('chat-info-sidebar');
        if (!sidebar) return;
        if (sidebar.style.display === 'none') {
            sidebar.style.display = '';
        }
        const { chat, members, current_role } = this.currentChatDetail;
        let contentHtml = '';

        if (chat.type === 'private') {
            const other = members.find(m => m.user_id !== Api.userId);
            if (other) {
                contentHtml = `
                    <div class="profile-info">
                        <div class="avatar-placeholder"></div>
                        <h3>${escapeHtml(other.display_name || other.username)}</h3>
                        <p class="status">offline</p>
                        <p class="username">@${escapeHtml(other.username)}</p>
                    </div>
                `;
            } else {
                contentHtml = '<p>User not found</p>';
            }
        } else {
            contentHtml = `
                <div class="group-info">
                    <div class="group-name-container">
                        <span class="group-name-text">${escapeHtml(chat.name)}</span>
                        ${current_role === 'owner' || current_role === 'admin' ? 
                            '<button class="rename-btn">Rename</button>' : ''}
                    </div>
                    <div class="chat-actions">
                        ${current_role === 'owner' || current_role === 'admin' ? 
                            `<button id="add-members-btn">Add Members</button>` : ''}
                        ${current_role === 'owner' ? 
                            `<button id="delete-chat-btn">Delete Chat</button>` : ''}
                    </div>
                    <h3>Members (${members.length})</h3>
                    <ul class="member-list">
                        ${members.map(m => `
                            <li class="member-item" data-user-id="${m.user_id}">
                                <div class="member-info">
                                    <span class="member-name">${escapeHtml(m.display_name || m.username)}</span>
                                    <span class="member-role">${m.role}</span>
                                </div>
                                ${(current_role === 'owner' || current_role === 'admin') && m.user_id !== Api.userId ? 
                                    `<button class="kick-member-btn" data-user-id="${m.user_id}">Remove</button>` : ''}
                            </li>
                        `).join('')}
                    </ul>
                </div>
            `;
        }

        sidebar.innerHTML = `
            <div class="sidebar-header">
                <button class="close-sidebar" id="close-chat-info-sidebar">&times;</button>
            </div>
            <div class="sidebar-content">
                ${contentHtml}
            </div>
        `;

        document.getElementById('close-chat-info-sidebar').onclick = () => {
            sidebar.classList.remove('open');
        };

        if (chat.type === 'group') {
            const renameBtn = document.querySelector('.rename-btn');
            if (renameBtn) {
                renameBtn.addEventListener('click', () => this.startRenameGroup());
            }

            document.getElementById('add-members-btn')?.addEventListener('click', () => this.showAddMembersModal());
            document.getElementById('delete-chat-btn')?.addEventListener('click', () => this.deleteCurrentChat());

            document.querySelectorAll('.kick-member-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeMember(btn.dataset.userId);
                };
            });

            document.querySelectorAll('.member-item').forEach(item => {
                item.onclick = (e) => {
                    if (e.target.classList.contains('kick-member-btn')) return;
                    this.showUserProfile(item.dataset.userId);
                };
            });
        }
        sidebar.classList.add('open');
    },

    async startRenameGroup() {
        const nameContainer = document.querySelector('.group-name-container');
        if (!nameContainer) return;

        const oldName = this.currentChatDetail.chat.name;
        nameContainer.innerHTML = `
            <input type="text" class="inline-edit-input" value="${escapeHtml(oldName)}" id="rename-input">
            <button id="save-rename">Save</button>
        `;
        const input = document.getElementById('rename-input');
        input.focus();
        const saveRename = async () => {
            const newName = input.value.trim();
            if (!newName || newName === oldName) {
                nameContainer.innerHTML = `<span class="group-name-text">${escapeHtml(oldName)}</span> <button class="rename-btn">Rename</button>`;
                document.querySelector('.rename-btn')?.addEventListener('click', () => this.startRenameGroup());
                return;
            }
            try {
                await Api.put(`/chats/${this.currentChatId}`, { name: newName });
                await this.loadChatDetail(this.currentChatId);
            } catch (err) {
                alert('Failed to rename: ' + err.message);
                nameContainer.innerHTML = `<span class="group-name-text">${escapeHtml(oldName)}</span> <button class="rename-btn">Rename</button>`;
                document.querySelector('.rename-btn')?.addEventListener('click', () => this.startRenameGroup());
            }
        };
        document.getElementById('save-rename').onclick = saveRename;
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') saveRename();
            if (e.key === 'Escape') {
                nameContainer.innerHTML = `<span class="group-name-text">${escapeHtml(oldName)}</span> <button class="rename-btn">Rename</button>`;
                document.querySelector('.rename-btn')?.addEventListener('click', () => this.startRenameGroup());
            }
        });
    },

    async deleteCurrentChat() {
        if (!confirm('Delete this chat? This action cannot be undone.')) return;
        try {
            await Api.del(`/chats/${this.currentChatId}`);
            this.currentChatId = null;
            this.currentChatDetail = null;
            document.getElementById('main').innerHTML = '<div class="placeholder">Select a chat to start messaging</div>';
            document.getElementById('chat-info-sidebar').style.display = 'none';
            await this.loadChats();
        } catch (err) {
             alert('Failed to delete chat: ' + err.message);
        }
    },

    showUserPicker(excludeUserIds, onDone, title, singleSelect = false) {
        const modalId = 'user-picker-modal';
        const html = `
            <div class="modal-content user-picker-content">
                <h3>${escapeHtml(title)}</h3>
                <input type="text" id="picker-search" placeholder="Type username...">
                <ul id="picker-results"></ul>
                <div id="picker-selected" class="selected-members"></div>
                <div class="picker-buttons" ${singleSelect ? 'style="display:none"' : ''}>
                    <button id="picker-cancel">Cancel</button>
                    <button id="picker-done">Done</button>
                </div>
            </div>
        `;
        Modals.createModal(modalId, html);
        Modals.show(modalId);

        const selected = new Map();
        const searchInput = document.getElementById('picker-search');
        const resultsList = document.getElementById('picker-results');
        const selectedDiv = document.getElementById('picker-selected');

        const renderSelected = () => {
            selectedDiv.innerHTML = Array.from(selected.entries()).map(([id, info]) => {
                const name = info.displayName || info.username;
                return `<span class="member-tag">${escapeHtml(name)} <button class="remove-tag-btn" data-user-id="${id}">&times;</button></span>`;
            }).join('');
            selectedDiv.querySelectorAll('.remove-tag-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const uid = e.target.dataset.userId;
                    selected.delete(uid);
                    renderSelected();
                };
            });
        };

        let searchTimeout;
        searchInput.oninput = () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
                const query = searchInput.value.trim();
                if (query.length < 2) {
                    resultsList.innerHTML = '';
                    return;
                }
                try {
                    const users = await Api.get('/users?query=' + encodeURIComponent(query));
                    resultsList.innerHTML = users
                        .filter(u => !excludeUserIds.includes(u.id) && !selected.has(u.id))
                        .map(u => `<li data-user-id="${u.id}" data-username="${escapeHtml(u.username)}" data-displayname="${escapeHtml(u.display_name)}">${escapeHtml(u.username)} (${escapeHtml(u.display_name)})</li>`)
                        .join('');
                    resultsList.querySelectorAll('li').forEach(li => {
                        li.onclick = () => {
                            const uid = li.dataset.userId;
                            const uname = li.dataset.username;
                            const dname = li.dataset.displayname;

                            if (singleSelect) {
                                Modals.hide(modalId);
                                onDone([uid]);
                                return;
                            }

                            selected.set(uid, { username: uname, displayName: dname });
                            renderSelected();
                            resultsList.innerHTML = '';
                            searchInput.value = '';
                            searchInput.focus();
                        };
                    });
                } catch (err) {
                    console.error(err);
                }
            }, 300);
        };

        if (!singleSelect) {
            document.getElementById('picker-cancel').onclick = () => Modals.hide(modalId);
            document.getElementById('picker-done').onclick = () => {
                Modals.hide(modalId);
                onDone(Array.from(selected.keys()));
            };
        }
    },

    showAddMembersModal() {
        if (!this.currentChatDetail) return;
        const currentMemberIds = this.currentChatDetail.members.map(m => m.user_id);
        this.showUserPicker(currentMemberIds, async (selectedIds) => {
            if (selectedIds.length === 0) return;
            try {
                await Api.post(`/chats/${this.currentChatId}/members`, { user_ids: selectedIds });
                await this.loadChatDetail(this.currentChatId);
            } catch (err) {
                alert('Failed to add members: ' + err.message);
            }
        }, 'Add members');
    },

    async addMembers(userIds) {
        try {
            await Api.post(`/chats/${this.currentChatId}/members`, { user_ids: userIds });
            await this.loadChatDetail(this.currentChatId);
        } catch (err) {
            alert('Failed to add members: ' + err.message);
        }
    },

    async removeMember(userId) {
        if (!confirm('Remove this member?')) return;
        try {
            await Api.del(`/chats/${this.currentChatId}/members`, { user_id: userId });
            await this.loadChatDetail(this.currentChatId);
        } catch (err) {
            alert('Failed to remove member: ' + err.message);
        }
    },

    showUserProfile(userId) {
        const member = this.currentChatDetail?.members.find(m => m.user_id === userId);
        if (!member) {
            alert('User info not available');
            return;
        }
        const html = `
            <div class="user-profile-modal">
                <h3>${escapeHtml(member.display_name || '')}</h3>
                <p><strong>Username:</strong> ${escapeHtml(member.username)}</p>
                <p><strong>${member.role}</strong></p>
                <p><strong>Joined:</strong> ${member.joined_at}</p>
                <button id="send-message-to-user">Write message</button>
                <button id="close-user-profile">Close</button>
            </div>
        `;
        Modals.createModal('user-profile-modal', html);
        document.getElementById('send-message-to-user').onclick = async () => {
            Modals.hide('user-profile-modal');
            try {
                const chat = await Api.createPrivateChat(userId);
                await this.loadChats();
                this.selectChat(chat.id);
            } catch (err) {
                alert('Could not open chat: ' + err.message);
            }
        };
        document.getElementById('close-user-profile').onclick = () => Modals.hide('user-profile-modal');
        Modals.show('user-profile-modal');
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
            <div id="chat-header"></div>
            <div id="messages-container">
                <div id="messages-list"></div>
                <div id="typing-indicator" class="typing-indicator"></div>
                <form id="message-form">
                    <input type="text" id="message-input" placeholder="Message…" autocomplete="off">
                    <button type="submit">Send</button>
                </form>
            </div>
        `;

        const list = document.getElementById('messages-list');
        messages.forEach(msg => this.appendMessage(msg, list));

        document.getElementById('message-form').onsubmit = (e) => {
            e.preventDefault();
            this.sendMessage();
        };

        const msgInput = document.getElementById('message-input');
        let typingTimer;

        msgInput.addEventListener('input', () => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
            this.ws.send(JSON.stringify({
                event: 'typing',
                data: { chat_id: this.currentChatId }
            }));
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => {
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        event: 'stop_typing',
                        data: { chat_id: this.currentChatId }
                    }));
                }
            }, 2000);
        });

        msgInput.addEventListener('keydown', (e) => {
            clearTimeout(typingTimer);
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({
                    event: 'stop_typing',
                    data: { chat_id: this.currentChatId }
                }));
            }
        });
        this.renderChatHeader();
        list.scrollTop = list.scrollHeight;
    },

    appendMessage(msg, container = null) {
        if (!container) container = document.getElementById('messages-list');
        if (!container) return;

        const div = document.createElement('div');
        const isOwn = (Api.userId && msg.sender_id === Api.userId);
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.setAttribute('data-message-id', msg.id);

        const timeStr = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let editedStr = '';
        if (msg.edited_at) {
            const editedTime = new Date(msg.edited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            editedStr = `<span class="edited-at">edited at ${editedTime}</span>`;
        }
        div.innerHTML = `
            <div class="message-content">${escapeHtml(msg.text || '')}</div>
            <div class="message-meta">
                <span class="message-time">${timeStr}</span>
                ${editedStr}
            </div>
        `;

        if (msg.sender_id === Api.userId) {
            div.addEventListener('contextmenu', (e) => this.showContextMenu(e, msg));
        }

        container.appendChild(div);
        return div;
    },

    showContextMenu(e, msg) {
        e.preventDefault();
        const existing = document.getElementById('context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';

        const items = [];
        if (msg.sender_id === Api.userId) {
            items.push({ text: 'Edit', action: () => this.startEditMessage(msg) });
            items.push({ text: 'Delete', action: () => this.deleteMessage(msg) });
        }

        if (items.length === 0) return;

        items.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'context-menu-item';
            itemEl.textContent = item.text;
            itemEl.addEventListener('click', () => {
                item.action();
                menu.remove();
            });
            menu.appendChild(itemEl);
        });

        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        document.body.appendChild(menu);

        const closeHandler = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
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
        } catch (err) {
            alert('Failed to send message: ' + err.message);
        }
    },

    startEditMessage(msg) {
        const msgDiv = document.querySelector(`.message[data-message-id="${msg.id}"]`);
        if (!msgDiv) return;

        const contentDiv = msgDiv.querySelector('.message-content');
        const oldText = msg.text || '';
        contentDiv.innerHTML = `<input type="text" class="edit-input" value="${escapeHtml(oldText)}">`;
        const input = contentDiv.querySelector('.edit-input');
        input.focus();

        const finishEdit = async () => {
            const newText = input.value.trim();
            if (newText === '' || newText === oldText) {
                contentDiv.textContent = oldText;
                return;
            }
            try {
                const encoded = btoa(unescape(encodeURIComponent(newText)));
                const nonce = btoa(Math.random().toString()).slice(0, 12);
                await Api.editMessage(this.currentChatId, msg.id, encoded, nonce, 'text');
            } catch (err) {
                alert('Failed to edit message: ' + err.message);
                contentDiv.textContent = oldText;
            }
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishEdit();
            } else if (e.key === 'Escape') {
                contentDiv.textContent = oldText;
            }
        });
        input.addEventListener('blur', () => {
            finishEdit();
        });
    },

    async deleteMessage(msg) {
        if (!confirm('Are you sure you want to delete this message?')) return;
        try {
            await Api.deleteMessage(this.currentChatId, msg.id);
        } catch (err) {
            alert('Failed to delete message: ' + err.message);
        }
    },

    // ==================== WEBSOCKET ====================
    connectWebSocket() {
        if (!Api.authToken) return;
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connected');
            ws.send(JSON.stringify({
                event: 'auth',
                data: { token: Api.authToken }
            }));
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.event === 'auth_ok') return;
                this.handleWsEvent(data);
            } catch (e) {
                console.error('Invalid JSON in WebSocket message', e);
            }
        };

        ws.onclose = (event) => {
            console.log('WebSocket disconnected', event.reason);
            if (event.code !== 1000) {
                console.log('Reconnecting in 5s...');
                setTimeout(() => this.connectWebSocket(), 5000);
            }
        };

        ws.onerror = (event) => {
            console.error('WebSocket error', event);
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
                default:
                    console.warn('Unknown WS event:', event);
            }
        } catch (e) {
            console.error('Error processing event', event, e);
        }
    },

    onNewMessage(msg) {
        this.loadChats();

        if (this.currentChatId !== msg.chat_id) return;
        try {
            msg.text = atob(msg.encrypted_content);
        } catch (e) {
            msg.text = '[encrypted]';
        }

        this.appendMessage(msg);
        const list = document.getElementById('messages-list');
        if (list) list.scrollTop = list.scrollHeight;
    },

    onMessageUpdated(payload) {
        if (this.currentChatId !== payload.chat_id) return;

        const msgDiv = document.querySelector(`.message[data-message-id="${payload.id}"]`);
        if (!msgDiv) return;

        const contentDiv = msgDiv.querySelector('.message-content');
        if (contentDiv) {
            try {
                contentDiv.textContent = atob(payload.encrypted_content);
            } catch (e) {
                contentDiv.textContent = '[encrypted]';
            }
        }

        const timeSpan = msgDiv.querySelector('.message-time');
        if (timeSpan && payload.sent_at) {
            timeSpan.textContent = new Date(payload.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        let editedSpan = msgDiv.querySelector('.edited-at');
        const metaDiv = msgDiv.querySelector('.message-meta');

        if (payload.edited_at) {
            const editedTime = new Date(payload.edited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (editedSpan) {
                editedSpan.textContent = `edited at ${editedTime}`;
            } else if (metaDiv) {
                editedSpan = document.createElement('span');
                editedSpan.className = 'edited-at';
                editedSpan.textContent = `edited at ${editedTime}`;
                metaDiv.appendChild(editedSpan);
            }
        }
    },

    onMessageDeleted(payload) {
        if (this.currentChatId !== payload.chat_id) return;

        const msgDiv = document.querySelector(`.message[data-message-id="${payload.message_id}"]`);
        if (!msgDiv) return;

        msgDiv.classList.add('deleting');
        msgDiv.addEventListener('animationend', () => {
            if (msgDiv.parentNode) msgDiv.parentNode.removeChild(msgDiv);
        });
        this.loadChats(); 
    },

    onTyping(payload) {
        if (this.currentChatId !== payload.chat_id) return;
        const typingEl = document.getElementById('typing-indicator');
        if (typingEl) {
            typingEl.textContent = `${(payload.user_id || '').slice(0, 8)} is typing...`;
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