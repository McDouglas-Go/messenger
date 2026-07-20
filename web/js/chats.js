const Chats = {
    chats: [],
    currentChatId: null,
    ws: null,
    currentChatDetail: null,
    currentChatSharedKey: null,
    chatKeys: {},
    mediaProcessed: new Set(),
    mediaUrlCache: new Map(),

    async init() {
        await this.loadChats();
        this.connectWebSocket();
    },

    async loadChats() {
        try {
            this.chats = await Api.getChats();
            await this.renderChatList();
        } catch (err) {
            console.error('Failed to load chats:', err);
        }
    },

    async renderChatList() {
        const list = document.getElementById('chat-list');
        if (!list) return;
        list.innerHTML = '';

        for (const chat of this.chats) {
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
                }
            } else {
                title = chat.name;
            }

            let lastMsgText = await this.formatLastMessage(chat);

            li.innerHTML = `
                <div class="chat-avatar"></div>
                <div class="chat-info">
                    <div class="chat-title">${escapeHtml(title)}</div>
                    <div class="chat-last-msg">${escapeHtml(lastMsgText)}</div>
                </div>
                <div class="chat-meta">
                    <div class="chat-time"></div>
                </div>
            `;
            li.addEventListener('click', () => Chats.selectChat(chat.id));
            list.appendChild(li);
        }
    },

    async formatLastMessage(chat) {
        if (!chat.last_message) return '...';
        let plain = '';
        const key = this.chatKeys[chat.id];
        if (key) {
            try {
                const packed = CryptoModule.unpackEncryptedData(chat.last_message);
                plain = await CryptoModule.decrypt(key, packed);
            } catch (e) {
                plain = ' ';
            }
        } else {
            plain = ' ';
        }
        if (chat.last_message.content_type !== 'text' && plain.startsWith('{') && plain.includes('media_ids')) {
            try {
                const mediaData = JSON.parse(plain);
                const mediaTypes = mediaData.media_types || [];
                const text = mediaData.text || '';
                let icon = '📎';
                if (mediaTypes.length > 0) {
                    const mime = mediaTypes[0];
                    if (mime.startsWith('image/')) icon = '📷 Image';
                    else if (mime.startsWith('video/')) icon = '🎬 Video';
                    else icon = '📄 File';
                }
                if (text.trim() !== '') {
                    return icon + ' · ' + text; 
                } else {
                    return icon;
                }
            } catch (e) {
                return ' ';
            }
        }

        if (chat.last_message.sender_id === Api.userId) {
            return 'You: ' + plain;
        } else if (chat.type === 'group') {
            return chat.sender_name + ': ' + plain;
        } else {
            return plain;
        }
    },

    hideChatSidebar() {
        const sidebar = document.getElementById('chat-info-sidebar');
        if (sidebar) sidebar.style.display = 'none';
    },

    async selectChat(chatId) {
        this.mediaProcessed.clear();
        if (this.currentChatId === chatId) return;
        this.currentChatId = chatId;
        this.currentChatSharedKey = null;
        await this.renderChatList();
        this.hideChatSidebar();
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
            if (detail.chat.type === 'private') {
                const other = detail.members.find(m => m.user_id !== Api.userId);
                if (other) {
                    try {
                        const pubResp = await Api.get(`/users/${other.user_id}/public-key`);
                        if (pubResp && pubResp.public_key) {
                            const partherJwk = JSON.parse(pubResp.public_key);
                            const partnerPublicKey = await CryptoModule.importPublicKey(partherJwk);
                            const myKeys = await KeyStorage.loadKeys(Api.userId);
                            if (myKeys) {
                                this.currentChatSharedKey = await CryptoModule.deriveSharedKey(myKeys.privateKey, partnerPublicKey);
                                this.chatKeys[chatId] = this.currentChatSharedKey;
                            } else {
                                console.warn('No private key found in storage, cannot encrypt');
                            }
                        }
                    } catch (e) {
                        console.error('Failed to set up encryption for chat', e);
                    }
                }
            } else {
                await this.obtainGroupKey(chatId);
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
            sidebar.style.display = 'flex';
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
                        ${current_role !== 'owner' ? 
                            `<button id="leave-chat-btn">Leave Chat</button>` : ''}
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
            document.getElementById('leave-chat-btn')?.addEventListener('click', () => this.leaveChat());
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

    async leaveChat() {
        if (!confirm('Are you sure you want to leave this chat?')) return;
        try {
            this.mediaProcessed.clear();
            await Api.del(`/chats/${this.currentChatId}/members`, { user_id: Api.userId });
        } catch (err) {
            alert('Failed to leave chat: ' + err.message);
        }
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
            await this.distributeGroupKey(this.currentChatId, userIds);
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
            const decryptedMessages = [];
            for (const m of messages) {
                let text = null;
                if (this.currentChatSharedKey) {
                    try {
                        const packed = CryptoModule.unpackEncryptedData(m);
                        text = await CryptoModule.decrypt(this.currentChatSharedKey, packed);
                    } catch (e) {
                        text = null;
                    }
                } 
                if (text !== null) {
                    m.text = text;
                    decryptedMessages.push(m);
                }
            }
            this.renderMessages(decryptedMessages);
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
                <div id="typing-indicator" class="typing-indicator" style="display:none;"></div>
                <form id="message-form">
                    <input type="file" id="file-input" accept="image/*,video/*,.pdf,.doc,.docx" style="display:none" multiple>
                    <button type="button" id="attach-btn" title="Attach file">📎</button>
                    <input type="text" id="message-input" placeholder="Write a message…" autocomplete="off">
                    <button type="submit">Send</button>
                </form>
            </div>
        `;

        const list = document.getElementById('messages-list');
        messages.forEach(msg => this.appendMessage(msg, list));
        const attachBtn = document.getElementById('attach-btn');
        const fileInput = document.getElementById('file-input');

        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', () => {
                fileInput.click();
            });
            fileInput.addEventListener('change', () => {
                this.handleFilesSelect(fileInput.files);
            });
        }

        const msgInput = document.getElementById('message-input');
        const sendBtn = document.querySelector('#message-form button');

        if (msgInput && sendBtn) {
            if (!this.currentChatSharedKey) {
                msgInput.disabled = true;
                sendBtn.disabled = true;
                msgInput.placeholder = 'Waiting for encryption keys…';
            } else {
                msgInput.disabled = false;
                sendBtn.disabled = false;
                msgInput.placeholder = 'Message…';
            }
        }

        const form = document.getElementById('message-form');
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                this.sendMessage();
            };
        }

        let typingTimer;
        if (msgInput) {
            msgInput.addEventListener('input', () => {
                if (!Chats.ws || Chats.ws.readyState !== WebSocket.OPEN) return;
                Chats.ws.send(JSON.stringify({
                    event: 'typing',
                    data: { chat_id: Chats.currentChatId }
                }));
                clearTimeout(typingTimer);
                typingTimer = setTimeout(() => {
                    if (Chats.ws && Chats.ws.readyState === WebSocket.OPEN) {
                        Chats.ws.send(JSON.stringify({
                            event: 'stop_typing',
                            data: { chat_id: Chats.currentChatId }
                        }));
                    }
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
        }

        this.renderChatHeader();
        if (list) list.scrollTop = list.scrollHeight;
    },

    handleFilesSelect(fileList) {
        if (!fileList || fileList.length === 0) return;

        let previewContainer = document.getElementById('media-preview');
        if (!previewContainer) {
            previewContainer = document.createElement('div');
            previewContainer.id = 'media-preview';
            previewContainer.className = 'media-preview';
            const messagesContainer = document.getElementById('messages-container');
            const form = document.getElementById('message-form');
            if (messagesContainer && form) {
                messagesContainer.insertBefore(previewContainer, form);
            }
        }
        previewContainer.innerHTML = '';

        for (const file of fileList) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const div = document.createElement('div');
                div.className = 'preview-item';
                if (file.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    img.src = e.target.result;
                    img.className = 'preview-thumb';
                    div.appendChild(img);
                } else if (file.type.startsWith('video/')) {
                    const video = document.createElement('video');
                    video.src = e.target.result;
                    video.className = 'preview-thumb';
                    video.autoplay = true;
                    video.muted = true;
                    video.loop = true;
                    div.appendChild(video);
                } else {
                    const icon = document.createElement('div');
                    icon.className = 'file-icon';
                    icon.textContent = '📄 ' + file.name;
                    div.appendChild(icon);
                }

                const nameSpan = document.createElement('span');
                nameSpan.className = 'file-name';
                nameSpan.textContent = file.name;
                nameSpan.style.display = 'none';
                div.appendChild(nameSpan);

                const progressContainer = document.createElement('div');
                progressContainer.className = 'progress-container';
                progressContainer.innerHTML = '<div class="progress-bar" style="width:0%"></div>';
                div.appendChild(progressContainer);

                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-preview';
                removeBtn.innerHTML = '✕';
                removeBtn.onclick = () => {
                    div.remove();
                    if (previewContainer.children.length === 0) {
                        previewContainer.remove();
                    }
                    const fileInput = document.getElementById('file-input');
                    fileInput.value = '';
                };
                div.appendChild(removeBtn);
                previewContainer.appendChild(div);
            };
            reader.readAsDataURL(file);
        }
        const sendBtn = document.querySelector('#message-form button[type="submit"]');
        const msgInput = document.getElementById('message-input');
        if (sendBtn) sendBtn.disabled = false;
        if (msgInput) msgInput.disabled = false;
    },

    appendMessage(msg, container = null) {
        if (!container) container = document.getElementById('messages-list');
        if (!container) return;

        const div = document.createElement('div');
        const isOwn = (Api.userId && msg.sender_id === Api.userId);
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.setAttribute('data-message-id', msg.id);

        let mediaHtml = '';
        let displayText = '';
        if (['image', 'video', 'file'].includes(msg.content_type)) {
            if (msg.text && msg.text.startsWith('{') && msg.text.includes('media_ids')) {
                try {
                    const mediaData = JSON.parse(msg.text);
                    if (mediaData.media_ids && mediaData.media_ids.length > 0) {
                        mediaHtml = this._renderMediaPreview(mediaData);
                        displayText = mediaData.text;
                    }
                } catch (e) {
                    console.error('Failed to parse media metadata', e);
                    displayText = '';
                }
            } else {
                mediaHtml = '<div class="media-attachment">📎 Media attachment</div>';
            }
        } else displayText = msg.text;

        const timeStr = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let editedStr = '';
        if (msg.edited_at) {
            const editedTime = new Date(msg.edited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            editedStr = `<span class="edited-at">edited at ${editedTime}</span>`;
        }
        let senderName = '';
        if (this.currentChatDetail && this.currentChatDetail.chat.type === 'group' && msg.sender_id !== Api.userId) {
            const member = this.currentChatDetail.members.find(m => m.user_id === msg.sender_id);
            senderName = member ? (member.display_name || member.username) : 'Unknown';
        }
        div.innerHTML = `
            ${senderName ? `<div class="sender-name">${escapeHtml(senderName)}</div>` : ''}
            ${mediaHtml}
            ${displayText ? `<div class="message-content">${escapeHtml(displayText)}</div>` : ''}
            <div class="message-meta">
                <span class="message-time">${timeStr}</span>
                ${editedStr}
            </div>
        `;

        if (mediaHtml && this.currentChatSharedKey && !this.mediaProcessed.has(msg.id)) {
            this.mediaProcessed.add(msg.id);
            this._decryptAndDisplayMedia(div, msg, this.currentChatSharedKey);
        }

        div.addEventListener('contextmenu', (e) => this.showContextMenu(e, msg));

        container.appendChild(div);
        return div;
    },

    async downloadAndDecryptFile(mediaId, mimeType, key) {
        const cacheKey = `${mediaId}:${mimeType || 'default'}`;
        if (this.mediaUrlCache.has(cacheKey)) {
            return this.mediaUrlCache.get(cacheKey);
        }
        const response = await fetch(`/media/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${Api.authToken}` }
        });
        if (!response.ok) throw new Error('Failed to download file');

        const encryptedBuffer = await response.arrayBuffer();
        if (key) {
            const combined = new Uint8Array(encryptedBuffer);
            const nonce = combined.slice(0, 12).buffer;
            const ciphertext = combined.slice(12).buffer;
            const plainBuffer = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: nonce },
                key,
                ciphertext
            );
            const blob = new Blob([plainBuffer], { type: mimeType || 'application/octet-stream'});
            const url = URL.createObjectURL(blob);
            this.mediaUrlCache.set(cacheKey, url);
            return url;
        }
    },

    async _decryptAndDisplayMedia(msgElement, msg, key) {
        try {
            const mediaIds = this._extractMediaIds(msg.text);
            if (!mediaIds || mediaIds.length === 0) return;

            let mediaTypes = [];
            let mediaNames = [];
            let mediaText;
            if (msg.text && msg.text.startsWith('{')) {
                try {
                    const data = JSON.parse(msg.text);
                    mediaTypes = data.media_types || [];
                    mediaNames = data.media_names || [];
                    mediaText = data.text || '';
                } catch (e) {
                    console.error('Failed to decrypt media', e);
                    return;
                }
            }

            const urls = await Promise.all(mediaIds.map((id, idx) => {
                const mimeType = mediaTypes[idx] || 'application/octet-stream';
                return this.downloadAndDecryptFile(id, mimeType, key);
            }));
            const mediaContainer = msgElement.querySelector('.media-container');
            if (mediaContainer) {
                mediaContainer.innerHTML = '';
                urls.forEach((url, idx) => {
                    const mimeType = mediaTypes[idx] || 'application/octet-stream';
                    const fileName = mediaNames[idx] || 'Noname file';
                    if (mimeType.startsWith('image/')) {
                        const img = document.createElement('img');
                        img.src = url;
                        img.className = 'media-preview-img';
                        img.addEventListener('click', () => this.openMediaViewer(url, mimeType, fileName, mediaText));
                        mediaContainer.appendChild(img);
                    } else if (mimeType.startsWith('video/')) {
                        const video = document.createElement('video');
                        video.src = url;
                        video.className = 'media-preview-video';
                        video.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.openMediaViewer(url, mimeType, fileName, mediaText);
                        })
                        mediaContainer.appendChild(video);
                    } else {
                        const fileName = mediaNames[idx] || 'Noname file';
                        const link = document.createElement('a');
                        link.href = url;
                        link.textContent = `📄 ${fileName}`;
                        link.className = 'download-link';
                        link.setAttribute('download', fileName);
                        const fileDiv = document.createElement('div');
                        fileDiv.className = 'file-preview';
                        fileDiv.appendChild(link);
                        mediaContainer.appendChild(fileDiv);
                    }
                });
                const list = document.getElementById('messages-list');
                if (list) list.scrollTop = list.scrollHeight;
            }
        } catch (e) {
            console.error('Failed to decrypt media', e);
        }
    },

    _extractMediaIds(text) {
        if (text && text.startsWith('{')) {
            try {
                const data = JSON.parse(text);
                return data.media_ids || null;
            } catch (e) {
                console.error('Failed to parse media JSON:', e);
                return;
            }
        }
        return null;
    },

    _renderMediaPreview(mediaData) {
        const ids = mediaData.media_ids || [];
        if (ids.length === 0) return '';
        return `
            <div class="media-container" data-media-ids="${ids.join(',')}">
                <div class="media-placeholder">Decrypting media...</div>
            </div>
        `;
    },

    showContextMenu(e, msg) {
        e.preventDefault();
        const existing = document.getElementById('context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';

        const items = [];

        let textToCopy = msg.text;
        if (['image', 'video', 'file'].includes(msg.content_type) && textToCopy.startsWith('{')) {
            try {
                const mediaData = JSON.parse(textToCopy);
                textToCopy = mediaData.text;
            } catch (e) {
                console.error('Failed to parse text', e);
                return;
            }
        }
        if (textToCopy.trim() !== '') {
            items.push({
                text: 'Copy Text',
                action: () => {
                    navigator.clipboard.writeText(textToCopy).catch(err => console.error('Copy failed', err));
                }
            });
        }

        if (['image', 'video', 'file'].includes(msg.content_type)) {
            items.push({ text: 'Download Media', action: () => this.downloadMedia(msg) });
        }

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

    openMediaViewer(url, mimeType, fileName, messageText = '') {
        const lightbox = document.createElement('div');
        lightbox.className = 'lightbox';

        const wrapper = document.createElement('div');
        wrapper.className = 'lightbox-media-wrapper';
        lightbox.appendChild(wrapper);

        let scale = 1;
        let translateX = 0, translateY = 0;
        let isDragging = false;
        let startX, startY, initialTranslateX, initialTranslateY;
        let mediaEl = null;

        const updateTransform = () => {
            mediaEl.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
        };

        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            scale = Math.min(Math.max(0.5, scale + delta), 5);
            if (scale <= 1) {
                translateX = 0;
                translateY = 0;
            }
            updateTransform();
        };
        if (mimeType.startsWith('image/')) {
            wrapper.addEventListener('wheel', handleWheel, { passive: false });
        }

        if (mimeType.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = url;
            img.className = 'lightbox-img';
            img.draggable = false;
            mediaEl = img;

            img.onload = () => {
                const initPosition = () => {
                    const naturalWidth = img.naturalWidth;
                    const naturalHeight = img.naturalHeight;           
                    wrapper.offsetHeight;    
                    const rect = wrapper.getBoundingClientRect();
                    
                    if (rect.width === 0 || rect.height === 0) {
                        requestAnimationFrame(initPosition);
                        return;
                    }

                    const scaleX = rect.width / naturalWidth;
                    const scaleY = rect.height / naturalHeight;
                    scale = Math.min(scaleX, scaleY, 1);
                    translateX = (rect.width - naturalWidth * scale) / 2;
                    translateY = (rect.height - naturalHeight * scale) / 2;

                    updateTransform();
                };
            };

            img.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (scale <= 1) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                initialTranslateX = translateX;
                initialTranslateY = translateY;
            });

            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                translateX = initialTranslateX + (e.clientX - startX);
                translateY = initialTranslateY + (e.clientY - startY);
                updateTransform();
            });

            window.addEventListener('mouseup', () => {
                if (isDragging) isDragging = false;
            });

            wrapper.appendChild(img);
        } else if (mimeType.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.className = 'lightbox-video';
            mediaEl = video;
            wrapper.appendChild(video);
        }

        const controls = document.createElement('div');
        controls.className = 'lightbox-controls';
        let buttonsHtml = `
            <button id="lightbox-download" title="Download">
                <svg width="20" height="20" viewBox="0 0 24 24"><path fill="white" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </button>
        `;
        if (mimeType.startsWith('image/')) {
            buttonsHtml += `
                <button id="lightbox-zoomin" title="Zoom In">+</button>
                <button id="lightbox-zoomout" title="Zoom Out">-</button>
            `;
        }
        if (messageText && messageText.trim() !== '') {
            buttonsHtml += `
                <button id="lightbox-toggle-text" title="Show text">☱</button>
            `;
        }
        buttonsHtml += `<button id="lightbox-close" title="Close">✕</button>`;
        controls.innerHTML = buttonsHtml;
        lightbox.appendChild(controls);

        let textOverlay = null;
        if (messageText && messageText.trim() !== '') {
            textOverlay = document.createElement('div');
            textOverlay.className = 'lightbox-text-overlay';
            textOverlay.textContent = messageText;
            textOverlay.style.display = 'none';
            lightbox.appendChild(textOverlay);
        }

        document.body.appendChild(lightbox);

        document.getElementById('lightbox-download').onclick = (e) => {
            e.stopPropagation();
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName || 'media';
            a.click();
        };
        if (mimeType.startsWith('image/')) {
            document.getElementById('lightbox-zoomin').onclick = (e) => {
                e.stopPropagation();
                scale = Math.min(scale + 0.5, 5);
                updateTransform();
            };
            document.getElementById('lightbox-zoomout').onclick = (e) => {
                e.stopPropagation();
                scale = Math.max(scale - 0.5, 0.5);
                if (scale <= 1) {
                    translateX = 0;
                    translateY = 0;
                }
                updateTransform();
            };
        }

        if (textOverlay) {
            document.getElementById('lightbox-toggle-text').onclick = (e) => {
                e.stopPropagation();
                if (textOverlay.style.display === 'none') {
                    textOverlay.style.display = 'block';
                } else {
                    textOverlay.style.display = 'none';
                }
            }
        }
        
        document.getElementById('lightbox-close').onclick = () => lightbox.remove();
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) lightbox.remove();
        });
    },

    async sendMessage() {
        const input = document.getElementById('message-input');
        const text = input.value.trim();
        const fileInput = document.getElementById('file-input');
        const files = fileInput?.files;

        if (!text && files.length === 0 || !this.currentChatId) return;

        const mediaIds = [];
        const mediaTypes = [];
        const mediaNames = [];
        if (files && files.length > 0) {
            const sendBtn = document.querySelector('#message-form button[type="submit"]');
            if (sendBtn) sendBtn.disabled = true;
            for (const file of files ) {
                try {
                    const buffer = await file.arrayBuffer();
                    let encryptedBuffer = buffer;
                    if (this.currentChatSharedKey) {
                        const enc = await CryptoModule.encryptBuffer(this.currentChatSharedKey, buffer);
                        const combined = new Uint8Array(enc.nonce.byteLength + enc.ciphertext.byteLength);
                        combined.set(new Uint8Array(enc.nonce), 0);
                        combined.set(new Uint8Array(enc.ciphertext), enc.nonce.byteLength);
                        encryptedBuffer = combined.buffer;
                    }

                    const media = await Api.uploadFile(
                        encryptedBuffer,
                        file.name,
                        file.type,
                        (progress) => {
                            this.updateFileProgress(file.name, progress);
                        }
                    );
                    mediaIds.push(media.id);
                    mediaTypes.push(file.type);
                    mediaNames.push(file.name);
                    this.removeFilePreview(file.name);
                } catch (e) {
                    alert(`Failed to upload ${file.name}: ${e.message}`);
                    if (sendBtn) sendBtn.disabled = false;
                    return;
                }
            }
            if (sendBtn) sendBtn.disabled = false;
        }

        let encryptedContent, nonce;
        if (text && this.currentChatSharedKey) {
            try {
                const enc = await CryptoModule.encrypt(this.currentChatSharedKey, text);
                const packed = CryptoModule.packEncryptedData(enc);
                encryptedContent = packed.encrypted_content;
                nonce = packed.nonce;
            } catch (e) {
                alert('Encryption failed: ' + e.message);
                return;
            }
        }

        let contentType = 'text';
        if (mediaIds.length > 0) {
            const firstFile = files[0];
            if (firstFile.type.startsWith('image/')) contentType = 'image';
            else if (firstFile.type.startsWith('video/')) contentType = 'video';
            else contentType = 'file';
            const payload = {
                text: text || ' ',
                media_ids: mediaIds,
                media_types: mediaTypes,
                media_names: mediaNames,
            };
            if (this.currentChatSharedKey) {
                const enc = await CryptoModule.encrypt(this.currentChatSharedKey, JSON.stringify(payload));
                const packed = CryptoModule.packEncryptedData(enc);
                encryptedContent = packed.encrypted_content;
                nonce = packed.nonce;
            }
        }
        try {
            const sentMessage = await Api.sendMessage(this.currentChatId, encryptedContent, nonce, contentType);
            if (sentMessage && sentMessage.id && mediaIds.length > 0) {
                for (const mediaId of mediaIds) {
                    await Api.put(`/media/${mediaId}`, { message_id: sentMessage.id });
                }
            }
            input.value = '';
            const previewContainer = document.getElementById('media-preview');
            if (previewContainer) previewContainer.innerHTML = '';
            if (fileInput) fileInput.value = '';
        } catch (err) {
            alert('Failed to send message: ' + err.message);
        }
    },

    updateFileProgress(fileName, percent) {
        const previewItems = document.querySelectorAll('.preview-item');
        previewItems.forEach(item => {
            const nameSpan = item.querySelector('.file-name');
            if (nameSpan && nameSpan.textContent === fileName) {
                const bar = item.querySelector('.progress-bar');
                if (bar) {
                    bar.style.width = percent + '%';
                    bar.textContent = percent + '%';
                }
            }
        });
    },

    removeFilePreview(fileName) {
        const previewItems = document.querySelectorAll('.preview-item');
        previewItems.forEach(item => {
            const nameSpan = item.querySelector('.file-name');
            if (nameSpan && nameSpan.textContent === fileName) {
                item.remove();
            }
        });
        const container = document.getElementById('media-preview');
        if (container && container.children.length === 0) {
            container.remove();
        }
    },

    async downloadMedia(msg) {
        try {
            const mediaIds = this._extractMediaIds(msg.text);
            if (!mediaIds || mediaIds.length === 0) throw new Error('No media IDs');

            let mediaTypes = [];
            let mediaNames = [];
            if (msg.text && msg.text.startsWith('{')) {
                try {
                    const data = JSON.parse(msg.text);
                    mediaTypes = data.media_types;
                    mediaNames = data.media_names;
                } catch (e) {
                    console.error('Failed to parse text', e);
                    return;
                }
            }
            for (let i = 0; i < mediaIds.length; i++) {
                const mimeType = mediaTypes[i] || 'application/octet-stream';
                const fileName = mediaNames[i] || 'Noname file';
                const url = await this.downloadAndDecryptFile(mediaIds[i], mimeType, this.currentChatSharedKey);
                const a = document.createElement('a');
                a.href = url;
                a.download = fileName;
                a.click();
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } catch (err) {
            alert('Failed to download media: ' + err.message);
        }
    },

    startEditMessage(msg) {
        const msgDiv = document.querySelector(`.message[data-message-id="${msg.id}"]`);
        if (!msgDiv) return;

        const contentDiv = msgDiv.querySelector('.message-content');
        let oldText = msg.text;
        let mediaData = {
            text: '',
            media_ids: [],
            media_types: [],
            media_names: [],
        }
        if (['image', 'video', 'file'].includes(msg.content_type) && oldText.startsWith('{')) {
            try {
                mediaData = JSON.parse(oldText);
                oldText = mediaData.text;
            } catch (e) {
                console.error('Failed to parse oldText', e);
                return;
            }
        }
        contentDiv.innerHTML = `<input type="text" class="edit-input" value="${escapeHtml(oldText)}">`;
        const input = contentDiv.querySelector('.edit-input');
        input.focus();

        const finishEdit = async () => {
            const newText = input.value.trim();
            if (newText === '' || newText === oldText) {
                contentDiv.textContent = oldText;
                return;
            }
            let newPayload;
            if (['image', 'video', 'file'].includes(msg.content_type)) {
                newPayload = JSON.stringify({
                    ...mediaData,
                    text: newText || ''
                });
            } else {
                newPayload = newText;
            }
            let encryptedContent, nonce;
            if (this.currentChatSharedKey) {
                try {
                    const enc = await CryptoModule.encrypt(this.currentChatSharedKey, newPayload);
                    const packed = CryptoModule.packEncryptedData(enc);
                    encryptedContent = packed.encrypted_content;
                    nonce = packed.nonce;
                } catch (e) {
                    alert('Encryption failed: ' + e.message);
                    return;
                }
            }
            try {
                await Api.editMessage(this.currentChatId, msg.id, encryptedContent, nonce, msg.content_type);
                msg.text = newPayload;
            } catch (err) {
                alert('Failed to edit message: ' + err.message);
                contentDiv.textContent = oldText;
                msg.text = oldText;
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

    async obtainGroupKey(chatId) {
        const members = this.currentChatDetail.members;
        const owner = members.find(m => m.role === 'owner');
        if (!owner) {
            console.error('No owner in group');
            return;
        }
        const myKeys = await KeyStorage.loadKeys(Api.userId);
        if (!myKeys) {
            console.error('No local keys');
            return;
        }

        try {
            const resp = await Api.get(`/chats/${chatId}/group-key`);
            if (resp?.encrypted_symmetric_key) {
                const combinedBuffer = CryptoModule.base64ToArrayBuffer(resp.encrypted_symmetric_key);
                const combined = new Uint8Array(combinedBuffer);
                const nonce = combined.slice(0, 12).buffer;
                const ciphertext = combined.slice(12).buffer;
                
                let sharedKeyWithOwner;
                if (owner.user_id === Api.userId) {
                    sharedKeyWithOwner = await CryptoModule.deriveSharedKey(myKeys.privateKey, myKeys.publicKey);
                } else {
                    const ownerPubResp = await Api.get(`/users/${owner.user_id}/public-key`);
                    if (!ownerPubResp?.public_key) throw new Error('Owner public key not found');
                    const ownerPublicKey = await CryptoModule.importPublicKey(JSON.parse(ownerPubResp.public_key));
                    sharedKeyWithOwner = await CryptoModule.deriveSharedKey(myKeys.privateKey, ownerPublicKey);
                }
                const rawKey = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: nonce },
                    sharedKeyWithOwner,
                    ciphertext
                );
                this.currentChatSharedKey = await crypto.subtle.importKey(
                    'raw',
                    rawKey,
                    { name: 'AES-GCM', length: 256 },
                    false,
                    ['encrypt', 'decrypt']
                );
                this.chatKeys[chatId] = this.currentChatSharedKey;
                return;
            }
        } catch (e) {
            if (owner.user_id === Api.userId) {
                await this.generateGroupKey(chatId);
                const memberIds = members.map(m => m.user_id);
                await this.distributeGroupKey(chatId, memberIds);
            } else {
                console.warn('Group key not available and user is not owner');
                this.currentChatSharedKey = null;
            }
        }
    },
    
    async generateGroupKey(chatId) {
        const aesKey = await crypto.subtle.generateKey(
            {name: 'AES-GCM', length: 256},
            true,
            ['encrypt', 'decrypt']
        );
        this.currentChatSharedKey = aesKey;
        this.chatKeys[chatId] = aesKey;
        return aesKey;
    },

    async distributeGroupKey(chatId, userIds) {
        if (!this.currentChatSharedKey) {
            console.error('No current group key to distribute');
            return;
        }
        const myKeys = await KeyStorage.loadKeys(Api.userId);
        if (!myKeys) {
            console.error('No local keys');
            return;
        }
        const rawKey = await crypto.subtle.exportKey('raw', this.currentChatSharedKey);
        for (const userId of userIds) {
            try {
                const pubResp = await Api.get(`/users/${userId}/public-key`);
                if (!pubResp?.public_key) continue;
                const partnerPublicKey = await CryptoModule.importPublicKey(JSON.parse(pubResp.public_key));
                const sharedKey = await CryptoModule.deriveSharedKey(myKeys.privateKey, partnerPublicKey);
                const enc = await CryptoModule.encryptBuffer(sharedKey, rawKey);
                const combined = new Uint8Array(enc.nonce.byteLength + enc.ciphertext.byteLength);
                combined.set(new Uint8Array(enc.nonce), 0);
                combined.set(new Uint8Array(enc.ciphertext), enc.nonce.byteLength);
                const combinedBase64 = CryptoModule.arrayBufferToBase64(combined.buffer);
                await Api.post(`/chats/${chatId}/group-key`, {
                    encrypted_symmetric_key: combinedBase64,
                    key_version: 1,
                    user_id: userId
                });
            } catch (e) {
                console.error('Failed to distribute key to', userId, e);
            }
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
                case 'chat_added':
                    this.onChatAdded(payload);
                    break;
                case 'chat_removed':
                    this.onChatRemoved(payload);
                    break;
                case 'chat_members_changed':
                    this.onMembersChanged(payload);
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

        const key = this.chatKeys[msg.chat_id] || this.currentChatSharedKey;
        let plainText = null;
        if(key) {
            const packed = CryptoModule.unpackEncryptedData(msg);
            CryptoModule.decrypt(key, packed).then(plain => {
                msg.text = plain;
                this.appendMessage(msg);
                const list = document.getElementById('messages-list');
                if (list) list.scrollTop = list.scrollHeight;
                if (['image', 'video', 'file'].includes(msg.content_type) && !this.mediaProcessed.has(msg.id)) {
                    this.mediaProcessed.add(msg.id);
                    const msgEl = document.querySelector(`.message[data-message-id="${msg.id}"]`);
                    if (msgEl) this._decryptAndDisplayMedia(msgEl, msg, key);
                }
            });
        }
    },

    onMessageUpdated(payload) {
        if (this.currentChatId !== payload.chat_id) return;

        const msgDiv = document.querySelector(`.message[data-message-id="${payload.id}"]`);
        if (!msgDiv) return;

        const updateContent = (plainText) => {
            const contentDiv = msgDiv.querySelector('.message-content');
            if (contentDiv) {
                let displayText = plainText;
                if (['image', 'video', 'file'].includes(payload.content_type) && plainText.startsWith('{')) {
                    try {
                        const mediaData = JSON.parse(plainText);
                        displayText = mediaData.text || '';
                    } catch (e) {
                        console.error('Failed to parse text', e);
                        return;
                    }
                }
                contentDiv.textContent = displayText;
            }
            const timeSpan = msgDiv.querySelector('.message-time');
            if (timeSpan) timeSpan.textContent = new Date(payload.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
        };
        if (this.currentChatSharedKey) {
            const packed = CryptoModule.unpackEncryptedData(payload);
            CryptoModule.decrypt(this.currentChatSharedKey, packed).then(updateContent);
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
            const member = this.currentChatDetail.members.find(m => m.user_id === payload.user_id);
            typingEl.textContent = `${member.display_name || member.username} is typing...`;
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
    },

    onChatAdded(payload) {
        this.loadChats();
    },

    onChatRemoved(payload) {
        this.mediaProcessed.clear();
        if (this.currentChatId === payload.chat_id) {
            this.hideChatSidebar();
            this.currentChatId = null;
            this.currentChatDetail = null;
            const main = document.getElementById('main');
            if (main) {
                main.classList.remove('chat-open');
                main.innerHTML = '<div class="chat-placeholder">Select a chat to start messaging</div>';
            }
        }
        this.chats = this.chats.filter(c => c.id !== payload.chat_id);
        this.renderChatList();
    },

    onMembersChanged(payload) {
        if (this.currentChatId !== payload.chat_id) return;
        this.loadChatDetail(this.currentChatId).then(() => {
            const sidebar = document.getElementById('chat-info-sidebar');
            if (sidebar && sidebar.style.display === 'flex') {
                this.showChatSidebar();
            }
        });
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