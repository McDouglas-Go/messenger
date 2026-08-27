const Chats = {
    chats: [],
    currentChatId: null,
    ws: null,
    currentChatDetail: null,
    currentChatSharedKey: null,
    _messageObserver: null,
    chatKeys: {},
    mediaProcessed: new Set(),
    mediaUrlCache: new Map(),
    currentOffset: 0,
    allMessagesLoaded: false,
    isLoadingMessage: false,
    replyToMsg: null, 
    _chatScrollHandler: null, 
    _chatKeyTimeout: null, 
    selectedMessages: new Set(),
    selectionModeActive: false,
    _ignoreNextClick: false,

    async init() {
        await this.loadChats();
        this.connectWebSocket();
    },

    async loadChats() {
        try {
            const data = await Api.getChats();
            this.chats = data.map(chat => ({
                ...chat,
                unreadCount: chat.unread_count, 
            }));
            await this.renderAllChats();
            this.updateChatsButtonBadge();
            this.initChatKeyLoading();
        } catch (err) {
            console.error('Failed to load chats:', err);
        }
    },

    async loadAvatar(container, userId, profilePhotoUrl) {
        if (!container || !userId) return;
        if (!profilePhotoUrl) {
            container.innerHTML = '';
            return;
        }
        const url = await Api.getUserAvatar(userId, profilePhotoUrl);
        if (url) {
            container.innerHTML = `<img src="${escapeHtml(url)}" alt="Avatar">`;
        } else {
            container.innerHTML = '';
        }
    },

    async renderChatInfo(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        const li = document.getElementById(`chat-${chatId}`);
        if (!li) return;

        let title = '';
        const avatarDiv = li.querySelector('.chat-avatar');
        const titleDiv = li.querySelector('.chat-title');
        if (chat.type === 'private' && chat.other_user) {
            title = chat.other_user.display_name || chat.other_user.username;
            const avatarUrl = await Api.getUserAvatar(chat.other_user.id, chat.other_user.profile_photo_url);
            if (avatarDiv) {
                avatarDiv.innerHTML = avatarUrl
                    ? `<img src="${escapeHtml(avatarUrl)}" alt="Avatar">`
                    : '';
            }
        } else {
            title = chat.name;
            if (avatarDiv) avatarDiv.innerHTML = '';
        }

        if (titleDiv) titleDiv.textContent = title;
    },

    async loadChatKey(chatId) {
        if (this.chatKeys[chatId]) return;
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;

        if (chat.type === 'private') {
            await this.obtainPrivateChatKey(chatId);
        } else {
            await this.obtainGroupKey(chatId);
        }
    },

    initChatKeyLoading() {
        const list = document.getElementById('chat-list');
        if (!list) return;
        
        if (this._chatScrollHandler) {
            list.removeEventListener('scroll', this._chatScrollHandler);
        }
        const loadVisibleKeys = () => {
            const listRect = list.getBoundingClientRect();
            const visibleIds = [];
            list.querySelectorAll('li[id^="chat-"]').forEach(li => {
                const liRect = li.getBoundingClientRect();
                if (liRect.bottom > listRect.top && liRect.top < listRect.bottom) {
                    visibleIds.push(li.id.replace('chat-', ''));
                }
            });
            visibleIds.forEach(chatId => {
                if (!this.chatKeys[chatId]) {
                    this.loadChatKey(chatId).then(() => {
                        if (this.chatKeys[chatId]) this.renderLastMessage(chatId);
                    }).catch(e => console.warn('Failed to load key for chat', chatId, e));
                }
            });
        };

        loadVisibleKeys();

        this._chatScrollHandler = () => {
            clearTimeout(this._chatKeyTimeout);
            this._chatKeyTimeout = setTimeout(loadVisibleKeys, 200);
        };
        list.addEventListener('scroll', this._chatScrollHandler);
    },
 
    async renderLastMessage(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        const li = document.getElementById(`chat-${chatId}`);
        if (!li) return;
        const lastMsgEl = li.querySelector('.chat-last-msg');
        if (!lastMsgEl) return;
        const oldStatus = lastMsgEl.querySelector('.message-status');
        if (oldStatus) oldStatus.remove();

        let lastMsgText = await this.formatLastMessage(chat);
        let statusIndicator = '';
        if (chat.last_message && chat.last_message.sender_id === Api.userId) {
            const st = chat.last_message.status;
            if (st === 'read') {
                statusIndicator = '<span class="message-status read">✓✓</span>';
            } else if (st === 'delivered') {
                statusIndicator = '<span class="message-status delivered">✓</span>';
            } else {
                statusIndicator = '<span class="message-status sent">✓</span>';
            }
        }
        lastMsgEl.innerHTML = `${escapeHtml(lastMsgText)} ${statusIndicator}`;

        const badgeEl = li.querySelector('.unread-badge');
        if (badgeEl) {
            if (chat.unreadCount && chat.unreadCount > 0) {
                badgeEl.textContent = chat.unreadCount > 99 ? '99+' : chat.unreadCount;
                badgeEl.style.display = 'inline-flex';
            } else {
                badgeEl.style.display = 'none';
            }
        }
    },

    async renderChatItem(chatId) {
        await this.renderChatInfo(chatId);
        await this.renderLastMessage(chatId);
    },

    async renderAllChats() {
        const list = document.getElementById('chat-list');
        if (!list) return;
        list.innerHTML = '';
        for (const chat of this.chats) {
            const li = document.createElement('li');
            li.id = `chat-${chat.id}`;
            li.className = 'chat-item';
            if (chat.id === this.currentChatId) li.classList.add('active');
            li.addEventListener('click', () => this.selectChat(chat.id));

            li.innerHTML = `
                <div class="chat-avatar"></div>
                <div class="chat-info">
                    <div class="chat-title"></div>
                    <div class="chat-last-msg"></div>
                </div>
                <div class="chat-meta">
                    <div class="chat-time"></div>
                    <span class="unread-badge" style="display:none;"></span>
                </div>
            `;
            list.appendChild(li);
            await this.renderChatItem(chat.id);
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
                plain = '...';
            }
        } else {
            plain = '...';
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

    async selectChat(chatId) {
        this.mediaProcessed.clear();
        if (this.currentChatId === chatId) return;
        this.currentChatId = chatId;
        this.currentChatSharedKey = this.chatKeys[chatId] || null;
        this.currentChatDetail = null;
        this.currentOffset = 0;
        this.allMessagesLoaded = false;
        this.isLoadingMessage = false;
        if (this._messageObserver) {
            this._messageObserver.disconnect();
            this._messageObserver = null;
        }
        this.hideInfoPanel();
        const activeChat = document.querySelector('#chat-list .active');
        if (activeChat) activeChat.classList.remove('active');
        const activeLi = document.getElementById(`chat-${this.currentChatId}`);
        if (activeLi) activeLi.classList.add('active');
        await this.renderChatItem(chatId);
        await this.loadChatDetail(chatId);
        await this.loadMessages(chatId);
    },

    showCreateChatMenu() {
        const menu = document.getElementById('create-chat-dropdown');
        if (!menu) return;
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        if (menu.children.length === 0) {
            menu.innerHTML = `
                <button id="create-private-btn">Private Chat</button>
                <button id="create-group-btn">Group Chat</button>
            `;

            document.getElementById('create-private-btn').onclick = () => {
                menu.style.display = 'none';
                Chats.showPrivateChatCreator();
            };
            document.getElementById('create-group-btn').onclick = () => {
                menu.style.display = 'none';
                Chats.showGroupChatCreator();
            };
        }
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
        const main = document.getElementById('main');
        if (!main) return;
        main.classList.add('chat-open');
        main.innerHTML = `
            <div class="chat-header-empty">
                <div class="chat-header-left">
                    <button id="back-from-group-create" class="icon-btn back-btn" title="Back">←</button>
                    <span class="chat-header-title">New Group</span>
                </div>
            </div>
            <div class="group-create-form">
                <input type="text" id="group-name-input" placeholder="Name" class="form-input">
                <div id="group-members-container">
                    <div class="member-list" id="group-members-list"></div>
                </div>
                <div id="add-members-search">
                    <input type="text" id="member-search-input" placeholder="Search users...">
                    <ul id="search-results-list"></ul>
                </div>
                <button id="create-group-submit" class="btn-primary">Create</button>
            </div>
        `;
        const selectedMembers = new Map();
        const nameInput = document.getElementById('group-name-input');
        const searchInput = document.getElementById('member-search-input');
        const resultsList = document.getElementById('search-results-list');
        const membersList = document.getElementById('group-members-list');
        const submitBtn = document.getElementById('create-group-submit');
        const updateSubmitBtn = () => {
            submitBtn.disabled = !(nameInput.value.trim() && selectedMembers.size > 0);
        };
        nameInput.addEventListener('input', updateSubmitBtn);

        const renderSelected = () => {
            membersList.innerHTML = '';
            for (const [id, info] of selectedMembers) {
                const li = document.createElement('li');
                li.className =  'member-item';
                li.innerHTML = `
                    <div class="member-avatar"></div>
                    <div class="member-info">
                        <span class="member-name">${escapeHtml(info.display_name || info.username)}</span>
                    </div>
                    <div class="member-actions">
                        <button class="remove-member-btn" data-user-id="${id}">⌫</button>
                    </div>
                `;
                const avatarDiv = li.querySelector('.member-avatar');
                this.loadAvatar(avatarDiv, id, info.profile_photo_url);
                li.querySelector('.remove-member-btn').onclick = (e) => {
                    e.stopPropagation();
                    selectedMembers.delete(id);
                    renderSelected();
                    updateSubmitBtn();
                };
                membersList.appendChild(li);
            }
        };

        let searchTimeout;
        searchInput.addEventListener('input', () => {
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
                        .filter(u => u.id !== Api.userId && !selectedMembers.has(u.id))
                        .map(u =>  `
                            <li class="search-result-item" 
                                data-user-id="${u.id}" 
                                data-username="@${escapeHtml(u.username)}" 
                                data-displayname="${escapeHtml(u.display_name)}"
                                data-profile-photo="${u.profile_photo_url || ''}">
                                <span>${escapeHtml(u.username)} (${escapeHtml(u.display_name)})</span>
                            </li>
                        `).join('');
                    resultsList.querySelectorAll('li').forEach(li => {
                        li.addEventListener('click', () => {
                            const userId = li.dataset.userId;
                            const username = li.dataset.username;
                            const displayName = li.dataset.displayname;
                            const profilePhoto = li.dataset.profilePhoto || '';
                            selectedMembers.set(userId, { 
                                username, 
                                display_name: displayName,
                                profile_photo_url: profilePhoto,
                            });
                            renderSelected();
                            updateSubmitBtn();
                            resultsList.innerHTML = '';
                            searchInput.value = '';
                        });
                    });
                } catch (err) {
                    console.error('User search failed:', err);
                }
            }, 300);
        });
        
        document.getElementById('back-from-group-create').onclick = () => {
            this.currentChatId = null;
            this.hideInfoPanel();
            main.innerHTML = '<div class="chat-placeholder">Select a chat to start messaging</div>';
            main.classList.remove('chat-open');
        };

        submitBtn.onclick = async () => {
            const name = nameInput.value.trim();
            const memberIds = Array.from(selectedMembers.keys());
            if (!name || memberIds.length === 0) return;
            try {
                const chat = await Api.createGroupChat(name, memberIds);
                this.loadChats();
                this.selectChat(chat.id);
            } catch (err) {
                alert('Failed to create group: ' + err.message);
            }
        };
    },

    updateChatsButtonBadge() {
        const btn = document.getElementById('chats-btn');
        if (!btn) return;
        const chatsWithUnread = this.chats.filter(chat => chat.unreadCount > 0).length;
        const existingBadge = btn.querySelector('.badge');
        if (existingBadge) existingBadge.remove();
        if (chatsWithUnread > 0) {
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.textContent = chatsWithUnread > 99 ? '99+' : chatsWithUnread;
            btn.appendChild(badge);
        }
    },

    async loadChatDetail(chatId) {
        try {
            const detail = await Api.get(`/chats/${chatId}`);
            this.currentChatDetail = detail;
            this.renderChatHeader();
            if (detail.chat.type === 'private') {
                await this.obtainPrivateChatKey(chatId);
            } else {
                await this.obtainGroupKey(chatId);
            }
        } catch (err) {
            console.error('Failed to load chat detail', err);
        }
    },

    async renderChatHeader() {
        const header = document.getElementById('chat-header');
        if (!header || !this.currentChatDetail) return;

        const { chat, members, current_role } = this.currentChatDetail;
        let title = '';
        let subtitle = '';
        let avatarHtml = `<div id="header-avatar" class="header-avatar"></div>`;
        if (chat.type === 'private') {
            const other = members.find(m => m.user_id !== Api.userId);
            if (other) {
                title = other.display_name || other.username;
                subtitle = 'last seen recently';
                setTimeout(() => {
                    const container = document.getElementById('header-avatar');
                    this.loadAvatar(container, other.user_id, other.profile_photo_url);
                }, 0);
            } 
        } else {
            title = chat.name;
            subtitle = `${members.length} members`;
        }
        header.innerHTML = `
            <div class="chat-header-left">
                <button id="back-to-chats-btn" class="icon-btn back-btn" title="Back">←</button>
                ${avatarHtml}
                <div class="chat-header-info">
                    <div class="chat-header-title">${escapeHtml(title)}</div>
                    <div class="chat-header-subtitle">${subtitle}</div>
                </div>
            </div>
            <div class="chat-header-arrow" id="chat-header-arrow">︾ ︾ ︾</div>
            <div class="menu-wrapper" id="header-menu-wrapper">
                <button id="chat-menu-btn" class="icon-btn menu-trigger">⋯</button>
                <div id="chat-menu-dropdown" class="dropdown-menu"></div>
            </div>
        `;
        document.getElementById('back-to-chats-btn').onclick = () => {
            this.currentChatId = null;
            this.currentChatDetail = null;
            this.hideInfoPanel();
            const main = document.getElementById('main');
            if (main) {
                main.classList.remove('chat-open');
                main.innerHTML = '<div class="chat-placeholder">Select a chat to start messaging</div>';
            }
            document.querySelectorAll('#chat-list .active').forEach(li => li.classList.remove('active'));
        };

        const menuBtn = document.getElementById('chat-menu-btn');
        const menuDropdown = document.getElementById('chat-menu-dropdown');
        if (menuBtn && menuDropdown) {
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                menuDropdown.style.display = menuDropdown.style.display === 'block' ? 'none' : 'block';
                if (menuDropdown.style.display === 'block') {
                    const actions = [];
                    if (chat.type === 'private') {
                        actions.push({ text: '⚠︎ Delete Chat', action: () => this.deleteCurrentChat() });
                    } else {
                        if (current_role !== 'owner') {
                            actions.push({ text: '✈ Leave Chat', action: () => this.leaveChat() });
                        }
                        if (current_role === 'owner') {
                            actions.push({ text: '⚠︎ Delete Chat', action: () => this.deleteCurrentChat() });
                        }
                    }
                    menuDropdown.innerHTML = actions.map(a => `<button>${a.text}</button>`).join('');
                    menuDropdown.querySelectorAll('button').forEach((btn, index) => {
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            menuDropdown.style.display = 'none';
                            actions[index].action();
                        };
                    });
                }
            };
        }

        document.getElementById('chat-header').onclick = () => this.toggleInfoPanel();
        document.addEventListener('click', () => menuDropdown.style.display = 'none');
        this.updateInfoPanelArrow();
    },

    toggleInfoPanel() {
        const panel = document.getElementById('chat-info-panel');
        if (!panel) return;
        if (panel.classList.contains('open')) {
            this.hideInfoPanel();
        } else {
            this.showInfoPanel();
        }
    },

    updateInfoPanelArrow() {
        const arrow = document.getElementById('chat-header-arrow');
        const panel = document.getElementById('chat-info-panel');
        if (!arrow || !panel) return;
        if (panel.classList.contains('open')) {
            arrow.textContent = '︽ ︽ ︽';
            arrow.classList.add('open');
        } else {
            arrow.textContent = '︾ ︾ ︾';
            arrow.classList.remove('open');
        }
    },

    async showInfoPanel() {
        if (!this.currentChatDetail) return;
        const panel = document.getElementById('chat-info-panel');
        if (!panel) return;
        const { chat, members, current_role } = this.currentChatDetail;
        let contentHtml = '';

        if (chat.type === 'private') {
            const other = members.find(m => m.user_id !== Api.userId);
            if (other) {
                contentHtml = `
                    <div class="profile-info">
                        <div class="panel-avatar" id="panel-avatar"></div>
                        <h3>${escapeHtml(other.display_name || other.username)}</h3>
                        <p class="status">offline</p>
                        <p class="username">@${escapeHtml(other.username)}</p>
                        ${other.about ? `<p class="about">${escapeHtml(other.about)}</p>` : ''}
                    </div>
                `;
            } else {
                contentHtml = '<p>Error: user not found</p>';
            }
        } else {
            const membersListHtml = members.map(m => `
                <li class="member-item" data-user-id="${m.user_id}">
                    <div class="member-avatar" id="member-avatar-${m.user_id}"></div>
                    <div class="member-info">
                        <span class="member-name">${escapeHtml(m.display_name || m.username)}</span>
                        <span class="member-role">${m.role}</span>
                    </div>
                    ${(current_role === 'owner' || current_role === 'admin') && m.user_id !== Api.userId ? `
                        <div class="member-actions">
                            <div class="member-actions-dropdown">
                                <button class="member-actions-btn">⋯</button>
                                <div class="member-actions-menu dropdown-menu" style="display:none;">
                                    <button class="kick-member-btn" data-user-id="${m.user_id}">Remove</button>
                                    <button class="make-admin-btn" disabled>Make Admin</button>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                </li>
            `).join('')
            contentHtml = `
                ${current_role === 'owner' || current_role === 'admin' ? `<button class="edit-panel-btn icon-btn" title="Edit">✎</button>` : '' }
                <div class="group-info">
                    <div class="panel-avatar" id="panel-avatar"></div>
                    <div class="group-name-container">
                        <span class="group-name-text">${escapeHtml(chat.name)}</span>
                    </div>
                    <h3>
                        Members - ${members.length}
                        ${current_role === 'owner' || current_role === 'admin' ? `<button id="add-members-inline-btn" title="Add member">+</button>` : ''}
                    </h3>
                    <ul class="member-list">${membersListHtml}</ul>
                </div>
            `;
        }

        panel.innerHTML = `<div class="panel-content">${contentHtml}</div>`;
        panel.classList.add('open');
        this.updateInfoPanelArrow();

        let avatarUrl = '';

        if (chat.type === 'private') {
            const other = members.find(m => m.user_id !== Api.userId);
            if (other) {
                const container = document.getElementById('panel-avatar');
                this.loadAvatar(container, other.user_id, other.profile_photo_url);
                avatarUrl = await Api.loadMediaUrl(other.profile_photo_url);
            }
        } else {
            for (const m of members) {
                const container = document.getElementById(`member-avatar-${m.user_id}`);
                this.loadAvatar(container, m.user_id, m.profile_photo_url);
            }
        }

        if (chat.type === 'private') {
            const avatarImg = document.querySelector('.panel-avatar img');
            if (avatarImg) {
                const now = new Date();
                const formattedDate = now.toISOString().replace(/:/g, '.').slice(0, 19);
                const fileName = `Media_${formattedDate}.jpg`;
                const other = members.find(m => m.user_id !== Api.userId);
                avatarImg.style.cursor = 'pointer';
                avatarImg.addEventListener('click', () => {
                    Api.openMediaViewer(avatarUrl, 'image/jpeg', fileName);
                });
            }
        } else {
            const editBtn = document.querySelector('.edit-panel-btn');
            if (editBtn) {
                editBtn.addEventListener('click', () => this.startEditGroup());
            }

            document.getElementById('add-members-inline-btn')?.addEventListener('click', () => this.showAddMembersModal());

            document.querySelectorAll('.member-actions-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const menu = btn.nextElementSibling;
                    if (menu) {
                        menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
                    }
                });
            });

            document.querySelectorAll('.kick-member-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.removeMember(btn.dataset.userId);
                };
            });

            document.addEventListener('click', () => {
                document.querySelectorAll('.member-actions-menu').forEach(menu => {
                    menu.style.display = 'none';
                });
            });

            document.querySelectorAll('.member-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('.member-actions-btn') || e.target.closest('.kick-member-btn')) return;
                    this.showUserProfile(item.dataset.userId);
                });
            });
        }
    },

    hideInfoPanel() {
        const panel = document.getElementById('chat-info-panel');
        if (panel) {
            panel.classList.remove('open');
            this.updateInfoPanelArrow();
        }
    },

    async startEditGroup() {
        const panel = document.getElementById('chat-info-panel');
        if (!panel) return;

        const nameContainer = panel.querySelector('.group-name-container');
        const nameText = panel.querySelector('.group-name-text');
        const editBtn = panel.querySelector('.edit-panel-btn');
        if (!nameText || !nameContainer || !editBtn) return;

        const oldName = nameText.textContent.trim();
        nameText.style.display = 'none';
        editBtn.style.display = 'none';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'edit-group-name-input';
        input.value = oldName;
        nameContainer.appendChild(input);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-panel-btn icon-btn';
        saveBtn.textContent = '✓';
        saveBtn.title = 'Save';
        nameContainer.appendChild(saveBtn);
        input.focus();

        const finishEdit = async () => {
            const newName = input.value.trim();
            if (!newName || newName === oldName) {
                input.remove();
                saveBtn.remove();
                nameText.style.display = '';
                editBtn.style.display = '';
                return;
            }
            try {
                await Api.put(`/chats/${this.currentChatId}`, { name: newName });
                nameText.textContent = newName;
                input.remove();
                saveBtn.remove();
                nameText.style.display = '';
                editBtn.style.display = '';
                this.loadChatDetail(this.currentChatId);
                this.renderChatInfo(this.currentChatId);
            } catch (err) {
                alert('Failed to rename: ' + err.message);
                input.remove();
                saveBtn.remove();
                nameText.style.display = '';
                editBtn.style.display = '';
            }
        };
        saveBtn.addEventListener('click', finishEdit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                   e.preventDefault();
                finishEdit();
            } else if (e.key === 'Escape') {
                input.remove();
                saveBtn.remove();
                nameText.style.display = '';
                editBtn.style.display = '';
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
            document.getElementById('main').innerHTML = '<div class="chat-placeholder">>Select a chat to start messaging</div>';
            this.hideInfoPanel();
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
                await this.distributeGroupKey(this.currentChatId, selectedIds);
            } catch (err) {
                alert('Failed to add members: ' + err.message);
            }
        }, 'Add members');
    },

    async removeMember(userId) {
        if (!confirm('Remove this member?')) return;
        try {
            await Api.del(`/chats/${this.currentChatId}/members`, { user_id: userId });
            await this.loadChatDetail(this.currentChatId);
            await Api.del(`/chats/${this.currentChatId}/group-key/${userId}`);
        } catch (err) {
            alert('Failed to remove member: ' + err.message);
        }
    },

    async showUserProfile(userId) {
        const panel = document.getElementById('chat-info-panel');
        if (!panel) return;
        const member = this.currentChatDetail?.members.find(m => m.user_id === userId);
        if (!member) return;
        const isSelf = userId === Api.userId;

        const contentHtml = `
            <div class="back-btn-container">
                <button id="back-to-chat-info-btn" class="icon-btn back-btn" title="Back">←</button>
            </div>
            <div class="profile-info">
                <div class="panel-avatar" id="user-profile-avatar"></div>
                <h3>${escapeHtml(member.display_name || member.username)}</h3>
                <p class="status">offline</p>
                <p class="username">@${escapeHtml(member.username)}</p>
                ${member.about ? `<p class="about">${escapeHtml(member.about)}</p>` : ''}
            </div>
            ${!isSelf ? `
            <div class="panel-actions">
                <button id="write-message-btn">✉ Write</button>
            </div>` : ''}
        `;
        let avatarUrl = '';
        panel.querySelector('.panel-content').innerHTML = contentHtml;
        const container = document.getElementById('user-profile-avatar');
        this.loadAvatar(container, member.user_id, member.profile_photo_url);
        avatarUrl = await Api.loadMediaUrl(member.profile_photo_url);

        document.getElementById('back-to-chat-info-btn').onclick = () => {
            this.showInfoPanel();
        };
        const avatarImg = document.querySelector('.panel-avatar img');
        if (avatarImg) {
            const now = new Date();
            const formattedDate = now.toISOString().replace(/:/g, '.').slice(0, 19);
            const fileName = `Media_${formattedDate}.jpg`;
            avatarImg.style.cursor = 'pointer';
            avatarImg.addEventListener('click', () => {
                Api.openMediaViewer(avatarUrl, 'image/jpeg', fileName);
            });
        }
        if (!isSelf) {
            document.getElementById('write-message-btn').onclick = async () => {
                try {
                    const chat = await Api.createPrivateChat(userId);
                    this.hideInfoPanel();
                    this.loadChats();
                    this.selectChat(chat.id);
                } catch (err) {
                    alert('Could not open chat: ' + err.message);
                }
            };
        }
    },

    scrollToBottomBtn(list) {
        const scrollBtn = document.getElementById('scroll-to-bottom-btn');
        if (!scrollBtn || !list) return;
        scrollBtn.addEventListener('click', () => {
            list.scrollTo({top: list.scrollHeight, behavior: 'smooth'});
        });
        const updateBtnVisibility = () => {
            const distanceToBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
            if (distanceToBottom > 200) {
                scrollBtn.classList.add('visible');
            } else {
                scrollBtn.classList.remove('visible');
            }
        };
        list.addEventListener('scroll', updateBtnVisibility);
        updateBtnVisibility;
    },

    async loadMessages(chatId, append = false) {
        const main = document.getElementById('main');
        if (!append) {
            main.classList.remove('chat-open');
            main.innerHTML = '<div class="loading">Loading messages…</div>';
        }
        const embed = ['reply_preview'];

        try {
            const messages = await Api.getMessages(chatId, 50, this.currentOffset, embed);
            messages.reverse(); 
            if (!append) this.currentOffset = 0;
            this.currentOffset += messages.length;
            if (messages.length < 50) this.allMessagesLoaded = true;
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
            this.renderMessages(decryptedMessages, append);
        } catch (err) {
            main.innerHTML = `<div class="error">Failed to load messages: ${err.message}</div>`;
        }
    },

    async loadMoreMessages(list) {
        if (this.allMessagesLoaded || this.isLoadingMessage) return;
        this.isLoadingMessage = true;

        const firstVisible = list.firstElementChild;
        const anchorTop = firstVisible ? firstVisible.getBoundingClientRect().top : null;

        await this.loadMessages(this.currentChatId, true);

        if (firstVisible && anchorTop !== null) {
            const newTop = firstVisible.getBoundingClientRect().top;
            list.scrollTop += newTop - anchorTop;
            console.log('new top', list.scrollTop);
        }
        this.isLoadingMessage = false;
        this.updateFloatingDate();
        this.scrollToBottomBtn(list);
    },

    renderMessages(messages, append = false) {
        const main = document.getElementById('main');
        if (!append) {
            main.classList.add('chat-open');
            main.innerHTML = `
                <div id="chat-header"></div>
                <div id="messages-container">
                    <div id="messages-list"></div>
                    <div id="floating-date" class="floating-date"></div>
                    <button id="scroll-to-bottom-btn" class="scroll-to-bottom-btn">︾ ︾ ︾</button>
                    <div id="typing-indicator" class="typing-indicator" style="display:none;"></div>
                    <form id="message-form">
                        <button type="button" id="attach-btn" title="Attach file">📎</button>
                        <input type="file" id="file-input" accept="image/*,video/*,.pdf,.doc,.docx" style="display:none" multiple>
                        <textarea id="message-input" placeholder="Message…" autocomplete="off" disabled rows="1"></textarea>
                        <div class="send-btn-container" id="send-btn-container">
                            <button type="submit" id="send-message-btn" disabled>
                                <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                            </button>
                        </div>
                        <button type="button" id="selection-delete-btn" class="selection-action-btn" title="Delete" style="display:none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
                        </button>
                        <span id="selection-count" class="selection-count" style="display:none;">0 selected</span>
                        <button type="button" id="selection-cancel-btn" class="selection-action-btn" title="Cancel" style="display:none;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                        <div id="selection-actions" class="selection-actions"></div>
                    </form>
                </div>
                <div id="chat-info-panel" class="chat-info-panel"></div>
            `;

            const attachBtn = document.getElementById('attach-btn');
            const fileInput = document.getElementById('file-input');

            if (attachBtn && fileInput) {
                attachBtn.addEventListener('click', () => {
                    fileInput.click();
                });
                fileInput.addEventListener('change', () => {
                    this.handleFilesSelect(fileInput.files);
                    this.updateSendBtn();
                });
            }

            const msgInput = document.getElementById('message-input');

            if (msgInput) {
                if (!this.currentChatSharedKey) {
                    msgInput.disabled = true;
                    fileInput.disabled = true;
                    msgInput.placeholder = 'Waiting for encryption keys…';
                } else {
                    msgInput.disabled = false;
                    fileInput.disabled = false;
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
                const adjustHeight = () => {
                    const maxInputHeight = Math.min(window.innerHeight * 0.5, 250);
                    msgInput.style.height = 'auto';
                    msgInput.style.height = Math.min(msgInput.scrollHeight, maxInputHeight) + 'px';
                }
                msgInput.addEventListener('input', () => {
                    adjustHeight();
                    this.updateSendBtn();
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

                msgInput.addEventListener('keydown', (e) => {
                    clearTimeout(typingTimer);
                    if (Chats.ws && Chats.ws.readyState === WebSocket.OPEN) {
                        Chats.ws.send(JSON.stringify({
                            event: 'stop_typing',
                            data: { chat_id: Chats.currentChatId }
                        }));
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const form = document.getElementById('message-form');
                        if (form) form.requestSubmit();
                    }
                });
            }
            this.renderChatHeader();
        }
        const list = document.getElementById('messages-list');
        if (!list) return;

        const elementsToInsert = [];
        let lastDateLabel = null;
        if (append) {
            const existingChildren = list.children;
            for (let i = 0; i <= existingChildren.length; i++) {
                const el = existingChildren[i];
                if (el.classList.contains('date-separator')) {
                    lastDateLabel = el.textContent;
                    break;
                }
                const msgEl = el.classList.contains('message-wrapper') ? el.querySelector('.message') : el;
                if (msgEl && msgEl.dataset.sentAt) {
                    lastDateLabel = this._getDateLabel(msgEl.dataset.sentAt);
                    break;
                }
            }
        }
        messages.forEach(msg => {
            const currentDateLabel = this._getDateLabel(msg.sent_at);
            if (currentDateLabel !== lastDateLabel) {
                const sep = document.createElement('div');
                sep.className = 'date-separator';
                sep.textContent = currentDateLabel;
                elementsToInsert.push(sep);
                lastDateLabel = currentDateLabel;
            }
            const msgElement = this.appendMessage(msg, null);
            if (msgElement) elementsToInsert.push(msgElement);
        });

        if (append) {
            list.prepend(...elementsToInsert);
        } else  {
            elementsToInsert.forEach(el => list.appendChild(el));
            list.scrollTop = list.scrollHeight;
            console.log('old top', list.scrollTop);
            this.observeMessages();
            this.updateFloatingDate();
            this.scrollToBottomBtn(list);
            list.addEventListener('scroll', () => {
                if (list.scrollTop === 0 && !this.allMessagesLoaded && !this.isLoadingMessage) {
                    this.loadMoreMessages(list);
                }
                this.updateFloatingDate();
            });
        }
        this.cleanupDateSeparators(list);
        this._decryptReplyPreviews(messages);
    },

    cleanupDateSeparators(list) {
        const children = Array.from(list.children);
        for (let i = 1; i < children.length; i++) {
            const prev = children[i - 1];
            const curr = children[i];
            if (prev.classList.contains('date-separator') && curr.classList.contains('date-separator') && prev.textContent === curr.textContent) {
                prev.remove();
                children.splice(i - 1, 1);
                i--;
            }
        }
        const firstContentEl = list.firstElementChild;
        if (firstContentEl && firstContentEl.classList.contains('date-separator')) {
            const nextEl = firstContentEl.nextElementSibling;
            if (nextEl && (nextEl.classList.contains('message') || nextEl.classList.contains('message-wrapper'))) {
                firstContentEl.remove();
            }
        }
    },

    updateSendBtn() {
        const input = document.getElementById('message-input');
        const fileInput = document.getElementById('file-input');
        const btn = document.getElementById('send-message-btn');
        if (!btn) return;

        const hasText = input && input.value.trim().length > 0;
        const hasFiles = fileInput && fileInput.files && fileInput.files.length > 0;
        if (hasText || hasFiles) {
            btn.classList.add('visible');
            btn.disabled = false;
        } else {
            btn.classList.remove('visible');
            btn.disabled = true;
        }
    },

    updateFloatingDate() {
        const list = document.getElementById('messages-list');
        const indicator = document.getElementById('floating-date');
        if (!list || !indicator) return;

        const messages = list.querySelectorAll('.message-wrapper, .message');
        let topMessageDate = '';
        for (const msg of messages) {
            const rect = msg.getBoundingClientRect();
            const containerRect = list.getBoundingClientRect();
            if (rect.bottom > containerRect.top) {
                const el = msg.classList.contains('message-wrapper') ? msg : msg.querySelector('.message') || msg;
                const sentAt = el.dataset.sentAt;
                if (sentAt) topMessageDate = this._getDateLabel(sentAt);
                break;
            }
        }
        indicator.textContent = topMessageDate;
        indicator.style.display = topMessageDate ? 'block' : 'none';

        const scrollbarWidth = list.offsetWidth - list.clientWidth;
        indicator.style.left = scrollbarWidth > 0 ? `calc(50% - ${scrollbarWidth / 2}px)` : '50%';

        const separators = document.querySelectorAll('.date-separator');
        const indicatorRect = indicator.getBoundingClientRect();
        separators.forEach(sep => {
            const sepRect = sep.getBoundingClientRect();
            const isIntersecting = !(sepRect.bottom < indicatorRect.top || sepRect.top > indicatorRect.bottom);
            sep.classList.toggle('hidden', isIntersecting);
        });
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
                    let ext = '';
                    const dotIndex = file.name.lastIndexOf('.');
                    if (dotIndex !== -1) {
                        ext = file.name.substring(dotIndex + 1).toUpperCase();
                    } else {
                        ext = file.type.split('/')[1]?.toUpperCase() || 'FILE';
                    }

                    const fileDiv = document.createElement('div');
                    fileDiv.className = 'preview-item file-item';
                    fileDiv.innerHTML = `
                        <div class="file-icon">
                            <span class="file-ext">${escapeHtml(ext)}</span>
                        </div>
                        <span class="file-name">${escapeHtml(file.name)}</span>
                    `;
                    div.appendChild(fileDiv);
                }

                const nameSpan = document.createElement('span');
                nameSpan.className = 'file-name-hidden';
                nameSpan.textContent = file.name;
                nameSpan.style.display = 'none';
                div.appendChild(nameSpan);

                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-preview';
                removeBtn.innerHTML = '✕';
                removeBtn.onclick = () => {
                    div.remove();
                    if (previewContainer.children.length === 0) {
                        previewContainer.remove();
                        const fileInput = document.getElementById('file-input');
                        fileInput.value = '';
                        this.updateSendBtn();
                    }
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
        if (!container) return null;

        const isOwn = (Api.userId && msg.sender_id === Api.userId);
        const isGroup = this.currentChatDetail && this.currentChatDetail.chat.type === 'group';
        const isAdmin = this.currentChatDetail.current_role === 'admin' || this.currentChatDetail.current_role === 'owner';
        let member = null;
        let wrapper = null;

        if (isGroup && !isOwn) {
            member = this.currentChatDetail?.members.find(m => m.user_id === msg.sender_id)
            wrapper = document.createElement('div');
            wrapper.className = 'message-wrapper';
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'message-avatar';
            avatarDiv.dataset.userId = msg.sender_id;
            this.loadAvatar(avatarDiv, msg.sender_id, member.profile_photo_url);
            wrapper.appendChild(avatarDiv);
        }

        const div = document.createElement('div');
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.setAttribute('data-message-id', msg.id);
        div.dataset.senderId = msg.sender_id;
        const replyBlockHtml = msg.reply_to_id
            ? `<div class="reply-block" data-reply-id="${msg.reply_to_id}">
                <span class="reply-sender">${escapeHtml(msg.reply_sender_name || 'Unknown')}</span>
                <span class="reply-text">...</span>
            </div>`
            : '';
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
                    const mediaTypes = mediaData.media_types || [];
                    const mediaNames = mediaData.media_names || [];
                    const mediaContainer = div.querySelector('.media-container');
                    if (mediaContainer) {
                        mediaContainer.dataset.mediaTypes = JSON.stringify(mediaTypes);
                        mediaContainer.dataset.mediaNames = JSON.stringify(mediaNames);
                    }
                    div.classList.add('has-media');
                } catch (e) {
                    console.error('Failed to parse media metadata', e);
                    displayText = '';
                }
            } else {
                mediaHtml = '<div class="media-attachment">📎 Media attachment</div>';
            }
        } else displayText = msg.text;

        if (mediaHtml) div.classList.add('has-media');

        const timeStr = new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        let editedStr = '';
        if (msg.edited_at) {
            const editedTime = new Date(msg.edited_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            editedStr = `<span class="edited-at">edited at ${editedTime}</span>`;
        }
        let senderName = '';
        if (isGroup && !isOwn) {
            senderName = member ? (member.display_name || member.username) : 'Unknown';
        }
        let statusHtml = ''
        if (isOwn) {
            if (msg.status === 'read') {
                statusHtml = '<span class="message-status read">✓✓</span>';
            } else if (msg.status === 'delivered') {
                statusHtml = '<span class="message-status delivered">✓</span>';
            } else {
                statusHtml = '<span class="message-status sent">✓</span>';
            }
        } else {
            const readClass = (msg.status === 'read') ? 'read' : '';
            statusHtml = `<span class="message-status ${readClass}" style="display:none;"></span>`;
        }
        div.innerHTML = `
            ${senderName ? `<div class="sender-name">${escapeHtml(senderName)}</div>` : ''}
            ${replyBlockHtml}
            ${mediaHtml}
            ${displayText ? `<div class="message-content">${escapeHtml(displayText)}</div>` : ''}
            <div class="message-meta">
                <span class="message-time">${timeStr}</span>
                ${editedStr}
                ${statusHtml}
            </div>
        `;

        if (mediaHtml && this.currentChatSharedKey && !this.mediaProcessed.has(msg.id)) {
            this.mediaProcessed.add(msg.id);
            this._decryptAndDisplayMedia(div, msg, this.currentChatSharedKey);
        }

        if (this._messageObserver && !isOwn) {
            this._messageObserver.observe(div);
        }

        div.addEventListener('click', (e) => {
            if (this._ignoreNextClick) {
                this._ignoreNextClick = false;
                return;
            }
            if (!this.selectionModeActive) return;
            if (e.target.closest('button, a, img, video, .file-preview, .play-icon, .video-preview-wrapper')) return;
            e.stopPropagation();
            this.toggleSelectMessage(msg.id);
        });

        let longPressTimer;
        div.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            longPressTimer = setTimeout(() => {
                if (!this.selectionModeActive) {
                    this._ignoreNextClick = true;
                    this.startSelection(msg.id);
                }
                longPressTimer = null;
            }, 500);
        })

        div.addEventListener('mouseup', () => clearTimeout(longPressTimer));
        div.addEventListener('mouseleave', () => clearTimeout(longPressTimer));

        if (msg.reply_to_id) {
            const replyBlock = div.querySelector('.reply-block');
            if (replyBlock) {
                replyBlock.addEventListener('click', () => {
                    this.scrollToReplyOriginal(msg.reply_to_id);
                });
            }
        }

        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.selectionModeActive) return;
            this.showContextMenu(e, msg);
        });
        if (wrapper) {
            wrapper.dataset.sentAt = msg.sent_at;
            wrapper.appendChild(div);
            container.appendChild(wrapper);
            return wrapper;
        } else {
            div.dataset.sentAt = msg.sent_at;
            container.appendChild(div);
            return div;
        }
    },

    async scrollToReplyOriginal(replyId) {
        const list = document.getElementById('messages-list');
        if (!list) return;

        const scrollToOriginal = () => {
            const original = document.querySelector(`.message[data-message-id="${replyId}"]`);
            if (original) {
                original.scrollIntoView({ behavior: 'smooth', block: 'center' });
                original.style.transition = 'background 0.3s';
                original.style.background = '#e6f2ff';
                setTimeout(() => { original.style.background = ''; }, 2000);
                return true;
            }
            return false;
        };
        if (scrollToOriginal()) return;

        while (!this.allMessagesLoaded) {
            await this.loadMoreMessages(list);
            await new Promise(resolve => setTimeout(resolve, 300));
            if (scrollToOriginal()) return;
        }
    },

    async _decryptReplyPreviews(messages) {
        for (const msg of messages) {
            if (!msg.reply_to_id || !msg.reply_preview) continue;
            const replyBlock = document.querySelector(`.message[data-message-id="${msg.id}"] .reply-block`);
            if (!replyBlock) continue;
            try {
                const preview = JSON.parse(msg.reply_preview);
                let replyText = '';
                if (this.currentChatSharedKey) {
                    const packed = CryptoModule.unpackEncryptedData({
                        encrypted_content: preview.encrypted_content,
                        nonce: preview.nonce
                    });
                    replyText = await CryptoModule.decrypt(this.currentChatSharedKey, packed);
                }
                let content = '';
                if (replyText.startsWith('{')) {
                    let mediaType = '';
                    try {
                        const data = JSON.parse(replyText);
                        const mime = data.media_types ? data.media_types[0].split('/')[0] : 'file';
                        if (mime === 'image') mediaType = '📷 Image';
                        else if (mime === 'video') mediaType = '🎬 Video';
                        else mediaType = '📄 File'
                        if (data.text !== '') {
                            content = `${mediaType} · ${data.text || ''}`.trim();
                        } else {
                            content = `${mediaType}`.trim();
                        }
                    } catch (e) {
                        content = 'Media';
                    }
                } else {
                    content = replyText;
                }
                replyBlock.innerHTML = `
                    <span class="reply-sender">${escapeHtml(msg.reply_sender_name || 'Unknown')}</span>
                    <span class="reply-text">${escapeHtml(content)}</span>
                `;
            } catch (e) {
                console.error('Failed to decrypt reply preview', e);
            }
        }
    },

    async downloadAndDecryptFile(mediaId, mimeType, key) {
        const cacheKey = `${mediaId}:${mimeType || 'default'}`;
        if (this.mediaUrlCache.has(cacheKey)) {
            return this.mediaUrlCache.get(cacheKey);
        }

        const fetchWithAuth = async (token) => {
            return await fetch(`/media/${mediaId}`, {
                headers: { 'Authorization': `Bearer ${Api.authToken}` }
            });
        };
        let response = await fetchWithAuth(Api.authToken);

        if (response.status === 401) {
            const refreshed = await Api.refreshToken();
            if (refreshed) {
                response = await fetchWithAuth(Api.authToken)
            } else {
                window.location.hash = '#login';
                throw new Error('Session expired');
            }
        }
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
            const visualMedia = [];
            const fileMedia = [];
            mediaIds.forEach((id, idx) => {
                const mimeType = mediaTypes[idx] || 'application/octet-stream';
                if (mimeType.startsWith('image/') || mimeType.startsWith('video/')) {
                    visualMedia.push({id, mimeType, fileName: mediaNames[idx] || 'Noname file' });
                } else {
                    fileMedia.push({id, mimeType, fileName: mediaNames[idx] || 'Noname file' });
                }
            });
            const mediaContainer = msgElement.querySelector('.media-container');
            if (mediaContainer) {
                mediaContainer.innerHTML = '';
                if (visualMedia.length > 0) {
                    const visualContainer = document.createElement('div');
                    visualContainer.className = 'media-grid';
                    if (visualMedia.length === 1) {
                        visualContainer.classList.add('single-media');
                    }
                    mediaContainer.appendChild(visualContainer);

                    const cells = [];
                    if (mediaIds.length > 1) {
                        for (let i = 0; i < visualMedia.length; i++) {
                            const cell = document.createElement('div');
                            cell.className = 'grid-cell';
                            cells.push(cell);
                            visualContainer.appendChild(cell);
                        }
                    }
                    for (let idx = 0; idx < visualMedia.length; idx++) {
                        const {id, mimeType, fileName} = visualMedia[idx];
                        const parent = cells.length > 0 ? cells[idx] : mediaContainer;
                        const url = await this.downloadAndDecryptFile(id, mimeType, key);
                        if (mimeType.startsWith('image/')) {
                            const img = document.createElement('img');
                            img.src = url;
                            img.className = 'media-preview-img';
                            img.addEventListener('click', (e) => {
                                if (this.selectionModeActive) {
                                    e.stopPropagation();
                                    this.toggleSelectMessage(msg.id);
                                    return;
                                }
                                Api.openMediaViewer(url, mimeType, fileName, mediaText);
                            });
                            parent.appendChild(img);
                        } else if (mimeType.startsWith('video/')) {
                            const wrapper = document.createElement('div');
                            wrapper.className = 'video-preview-wrapper';
                            const video = document.createElement('video');
                            video.src = url;
                            video.className = 'media-preview-video';
                            video.muted = false;
                            video.playsInline = true;
                            video.addEventListener('loadedmetadata', () => {
                                const duration = video.duration;
                                if (isFinite(duration)) {
                                    const minutes = Math.floor(duration / 60);
                                    const seconds = Math.floor(duration % 60);
                                    const durText = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                                    durationEl.textContent = durText;
                                }
                            })
                            video.addEventListener('click', (e) => {
                                if (this.selectionModeActive) {
                                    this.toggleSelectMessage(msg.id);
                                    return;
                                }
                                e.stopPropagation();
                                Api.openMediaViewer(url, mimeType, fileName, mediaText);
                            })
                            wrapper.appendChild(video);
                            const playIcon = document.createElement('div');
                            playIcon.textContent = '▶';
                            playIcon.className = 'play-icon';
                            wrapper.appendChild(playIcon);
                            const durationEl = document.createElement('div');
                            durationEl.className = 'video-duration';
                            wrapper.appendChild(durationEl);

                            parent.appendChild(wrapper);
                        }
                    }
                }
                if (fileMedia.length > 0) {
                    const fileList = document.createElement('div');
                    fileList.className = 'file-list';
                    mediaContainer.appendChild(fileList);

                    for (let idx = 0; idx < fileMedia.length; idx++) {
                        const {id, mimeType, fileName} = fileMedia[idx];
                        const url = await this.downloadAndDecryptFile(id, mimeType, key);
                        let ext = '';
                        const dotIndex = fileName.lastIndexOf('.');
                        if (dotIndex !== -1) {
                            ext = fileName.substring(dotIndex + 1).toUpperCase();
                        } else {
                            const parts = mimeType.split('/');
                            ext = parts[1] ? parts[1].toUpperCase() : 'FILE';
                        }

                        const link = document.createElement('a');
                        link.href = url;
                        link.className = 'file-preview';
                        link.setAttribute('download', fileName);
                        link.innerHTML = `
                            <div class="file-icon">
                                <span class="file-ext">${escapeHtml(ext)}</span>
                                <svg class="download-icon" viewBox="0 0 24 24" width="16" height="16">
                                    <path fill="white" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                                </svg>
                            </div>
                            <span class="file-name">${escapeHtml(fileName)}</span>
                        `;
                        link.addEventListener('click', (e) => {
                            if (this.selectionModeActive) {
                                e.preventDefault();
                                e.stopPropagation();
                                this.toggleSelectMessage(msg.id);
                                return;
                            }
                        });
                        fileList.appendChild(link);
                    }
                }
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
        const mediaIds = mediaData.media_ids || [];
        const mediaTypes = mediaData.media_types || [];
        const mediaNames = mediaData.media_names || [];
        let cellsHtml = '';
        for (let i = 0; i < mediaIds.length; i++) {
            const mime = mediaTypes[i] || 'application/octet-stream';
            const isImage = mime.startsWith('image/');
            const isVideo = mime.startsWith('video/');
            const className = isImage ? 'grid-cell image-cell' : isVideo ? 'grid-cell video-cell' : 'grid-cell file-cell';
            cellsHtml += `<div class="${className}" data-media-id="${mediaIds[i]}"></div>`;
        }
        return `
            <div class="media-container" 
                data-media-ids="${mediaIds.join(',')}"
                data-media-types='${JSON.stringify(mediaTypes)}'
                data-media-names='${JSON.stringify(mediaNames)}'>
                <div class="media-grid">
                    ${cellsHtml}
                </div>
            </div>
        `;
    },

    _getDateLabel(sentAt) {
        const now = new Date();
        const date = new Date(sentAt);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yeaterday = new Date(today.getTime() - 86400000);
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (target.getTime() === today.getTime()) return 'Today';
        if (target.getTime() === yeaterday.getTime()) return 'Yesterday';

        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();

        if (year === now.getFullYear()) {
            return `${day} ${month}`;
        } else {
            return `${day} ${month} ${year}`;
        }

    },

    startSelection(msgId) {
        this.selectionModeActive = true;
        this.selectedMessages.add(msgId);
        this.updateSelectionUI();
    },

    toggleSelectMessage(msgId) {
        if (!this.selectionModeActive) this.selectionModeActive = true;
        if (this.selectedMessages.has(msgId)) {
            this.selectedMessages.delete(msgId);
        } else {
            this.selectedMessages.add(msgId);
        }

        if (this.selectedMessages.size === 0) {
            this.selectionModeActive = false;
        }
        this.updateSelectionUI();
    },

    clearSelection() {
        this.selectedMessages.clear();
        this.selectionModeActive = false;
        this.updateSelectionUI();
    },

    collectSelectedMessagesInfo() {
        const infos = [];
        for (const id of this.selectedMessages) {
            const msgDiv = document.querySelector(`.message[data-message-id="${id}"]`);
            if (!msgDiv) continue;
            const info = {
                id: id,
                senderId: msgDiv.dataset.senderId,
                text: msgDiv.querySelector('.message-content')?.textContent.trim() || '',
                isOwn: msgDiv.dataset.senderId === Api.userId,
                mediaItems: [],
                content_type: 'text'
            };
            const mediaContainer = msgDiv.querySelector('.media-container');
            if (mediaContainer) {
                const mediaIdsStr = mediaContainer.dataset.mediaIds;
                if (mediaIdsStr) {
                    const mediaIds = mediaIdsStr.split(',');
                    const mediaTypes = JSON.parse(mediaContainer.dataset.mediaTypes || '[]');
                    const mediaNames = JSON.parse(mediaContainer.dataset.mediaNames || '[]');
                    mediaIds.forEach((id, index) => {
                        info.mediaItems.push({
                            id: id,
                            mimeType: mediaTypes[index] || 'application/octet-stream',
                            fileName: mediaNames[index] || 'Noname file'
                        });
                    });
                    info.content_type = 'media';
                }
            }
            infos.push(info);
        }
        infos.sort((a, b) => {
            const elA = document.querySelector(`.message[data-message-id="${a.id}"]`);
            const elB = document.querySelector(`.message[data-message-id="${b.id}"]`);
            if (!elA || !elB) return 0;
            return (elA.compareDocumentPosition(elB) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
        });
        return infos;
    },

    async handleSelectionAction(action) {
        const selectedInfos = this.collectSelectedMessagesInfo();
        switch (action) {
            case 'delete': {
                await this.deleteSelectedMessages();
                break;
            }
            case 'copy-text': {
                const texts = selectedInfos.map(info => info.text).filter(Boolean);
                if (texts.length > 0) {
                    await navigator.clipboard.writeText(texts.join('\n'));
                }
                break;
            }
            case 'download-media': {
                for (const info of selectedInfos) {
                    await this.downloadMediaItems(info.mediaItems);
                }
                break;
            }
            case 'reply': {
                if (selectedInfos.length === 1) {
                    const info = selectedInfos[0];
                    this.showReplyTo({
                        id: info.id, 
                        sender_id: info.senderId, 
                        text: info.text, 
                        mediaItems: info.mediaItems,
                    });
                    this.clearSelection();
                }
                break;
            }
            case 'edit': {
                if (selectedInfos.length === 1 && selectedInfos[0].isOwn) {
                    const info = selectedInfos[0];
                    this.startEditMessage({ 
                        id: info.id, 
                        content_type: info.content_type, 
                        text: info.text 
                    });
                    this.clearSelection();
                }
                break;
            }
            case 'cancel': {
                this.clearSelection();
                break;
            }
        }
    },

    async downloadMediaItems(mediaItems) {
        for (let i = 0; i < mediaItems.length; i++) {
            const item = mediaItems[i];
            const url = await this.downloadAndDecryptFile(item.id, item.mimeType, this.currentChatSharedKey);
            const a = document.createElement('a');
            a.href = url;
            a.download = item.fileName;
            a.click();
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    },

    updateSelectionUI() {
        const actionPanel = document.getElementById('selection-actions');
        const count = this.selectedMessages.size;
        const attachBtn = document.getElementById('attach-btn');
        const msgInput = document.getElementById('message-input');
        const sendBtnContainer = document.getElementById('send-btn-container');
        const selectionCount = document.getElementById('selection-count');
        const selectionDeleteBtn = document.getElementById('selection-delete-btn');
        const selectionCancelBtn = document.getElementById('selection-cancel-btn');
        const main = document.getElementById('main');
        if (main) {
            main.classList.toggle('selection-mode', count > 0);
        }

        if (count > 0) {
            attachBtn.style.display = 'none';
            msgInput.style.display = 'none';
            sendBtnContainer.style.display = 'none';
            selectionCount.style.display = 'inline';
            selectionCancelBtn.style.display = 'inline';
            selectionDeleteBtn.style.display = 'inline';

            const selectedInfos = this.collectSelectedMessagesInfo();
            const canDelete = selectedInfos.every(info => info.isOwn) || ['admin', 'owner'].includes(this.currentChatDetail?.current_role);
            const hasSingle = count === 1;
            const hasMedia = selectedInfos.some(info => info.mediaItems.length > 0);
            const allText = selectedInfos.map(info => info.text).filter(Boolean).join('\n');
            actionPanel.classList.add('open');
            let panelHtml = '';

            if (hasSingle) {
                const info = selectedInfos[0];
                if (info.isOwn) {
                    panelHtml += `<button class="selection-action-btn" data-action="edit" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>`;
                }
                panelHtml += `<button class="selection-action-btn" data-action="reply" title="Reply">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>
                </button>`;
            }
            if (allText.trim()) {
                panelHtml += `<button class="selection-action-btn" data-action="copy-text" title="Copy text">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>`;
            }
            if (hasMedia) {
                   panelHtml += `<button class="selection-action-btn" data-action="download-media" title="Download media">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                   </button>`;
            }
            actionPanel.innerHTML = panelHtml;

            selectionDeleteBtn.style.display = 'inline-block';
            if (canDelete) {
                selectionDeleteBtn.style.visibility = 'visible';
                selectionDeleteBtn.onclick = () => this.handleSelectionAction('delete');
            } else {
                selectionDeleteBtn.style.visibility = 'hidden';
            }
            selectionCount.textContent = `${count} selected`;
            selectionCancelBtn.onclick = () => this.handleSelectionAction('cancel');

            actionPanel.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => this.handleSelectionAction(btn.dataset.action));
            });
        } else {
            attachBtn.style.display = '';
            msgInput.style.display = '';
            sendBtnContainer.style.display = '';
            selectionCount.style.display = 'none';
            selectionDeleteBtn.style.display = 'none';
            selectionCancelBtn.style.display = 'none';
            actionPanel.classList.remove('open');
            actionPanel.innerHTML = '';
        }
        document.querySelectorAll('.message').forEach(div => {
            div.classList.toggle('selected', this.selectedMessages.has(div.dataset.messageId));
        });
    },

    async deleteSelectedMessages() {
        if (!confirm('Are you sure you want to delete this message?')) return;
        if (this.selectedMessages.size === 0) return;

        const messageIds = Array.from(this.selectedMessages);
        try {
            await Api.post(`/chats/${this.currentChatId}/messages/delete-bulk`, {message_ids: messageIds});
            messageIds.forEach(id => {
                const msgDiv = document.querySelector(`.message[data-message-id="${id}"]`);
                if (msgDiv) msgDiv.remove();
            });
            this.clearSelection();
            const list = document.getElementById('messages-list');
            if (list) this.cleanupDateSeparators(list);
            this.renderLastMessage(this.currentChatId);
        } catch (err) {
            alert('Failed to delete selected messages: ' + err.message);
        }
    },

    showContextMenu(e, msg) {
        e.preventDefault();
        const existing = document.getElementById('context-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';

        const items = [];

        const isAdmin = this.currentChatDetail?.current_role === 'admin' || this.currentChatDetail?.current_role === 'owner';

        let textToCopy = msg.text;
        const replyData = {
            id: msg.id,
            sender_id: msg.sender_id,
            text: msg.text,
            mediaItems: [],
        }
        if (['image', 'video', 'file'].includes(msg.content_type) && textToCopy.startsWith('{')) {
            try {
                const mediaData = JSON.parse(textToCopy);
                textToCopy = mediaData.text;
                const mediaTypes = mediaData.media_types || [];
                const mediaNames = mediaData.media_names || [];
                const ids = mediaData.media_ids || [];
                replyData.mediaItems = ids.map((mid, idx) => ({
                    id: mid,
                    mimeType: mediaTypes[idx] || 'application/octet-stream',
                    fileName: mediaNames[idx] || 'Noname file',
                }));
            } catch (e) {
                replyData.mediaItems = [];
                return;
            }
        }

        items.push({
            text: 'Reply',
            action: () => this.showReplyTo(replyData)
        });

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
        }

        items.push({ text: 'Select', action: () => this.startSelection(msg.id) });

        if (msg.sender_id === Api.userId || isAdmin) {
            items.push({ text: 'Delete', action: () => this.deleteMessage(msg) });
        }

        if (items.length === 0) return;

        items.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'context-menu-item';
            if (item.text === 'Delete') itemEl.classList.add('delete-item');
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

        let replyToId = null;
        if (this.replyToMsg) {
            replyToId = this.replyToMsg.id;
            this.replyToMsg = null;
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
            const sentMessage = await Api.sendMessage(this.currentChatId, encryptedContent, nonce, contentType, replyToId);
            if (sentMessage && sentMessage.id && mediaIds.length > 0) {
                for (const mediaId of mediaIds) {
                    await Api.put(`/media/${mediaId}`, { message_id: sentMessage.id });
                }
            }
            this.cancelReply();
            input.value = '';
            input.style.height = 'auto';
            const previewContainer = document.getElementById('media-preview');
            if (previewContainer) previewContainer.innerHTML = '';
            if (fileInput) fileInput.value = '';
            this.updateSendBtn();
        } catch (err) {
            alert('Failed to send message: ' + err.message);
            this.cancelReply();
        }
    },

    observeMessages() {
        if (!this._messageObserver) {
            this._messageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const msgDiv = entry.target;
                        const messageId = msgDiv.dataset.messageId;
                        const senderId = msgDiv.dataset.senderId;
                        const statusEl = msgDiv.querySelector('.message-status');
                        if (senderId !== Api.userId && statusEl && !statusEl.classList.contains('read')) {
                            statusEl.classList.add('read');
                            Api.post(`/chats/${this.currentChatId}/messages/${messageId}/read`).then(() => {
                                const chat = this.chats.find(c => c.id === this.currentChatId);
                                if (chat && chat.unreadCount > 0) {
                                    chat.unreadCount--;
                                    this.renderLastMessage(chat.id);
                                    this.updateChatsButtonBadge();
                                }
                            }).catch(e => console.error('Failed to mark read', e));
                            this._messageObserver.unobserve(msgDiv);
                        }
                    }
                });
            }, { threshold: 0.5 });
        }

        document.querySelectorAll('.message[data-message-id]').forEach(msgDiv => {
            this._messageObserver.observe(msgDiv);
        });
    },

    showReplyTo(replyData) {
        const {id, sender_id, text, mediaItems} = replyData;
        this.replyToMsg = {id, sender_id, text, mediaItems};
        let content = text || '';

        if (mediaItems && mediaItems.length > 0) {
            const first = mediaItems[0];
            const mime = first.mimeType || 'application/octet-stream';
            let mediaType = '';
            if (mime.startsWith('image/')) mediaType = '📷 Image';
            else if (mime.startsWith('video/')) mediaType = '🎬 Video';
            else mediaType = '📄 File'
            content = mediaType + (text ? ` · ${text}` : '');
        }
        let previewContainer = document.getElementById('reply-preview');
        if (!previewContainer) {
            previewContainer = document.createElement('div');
            previewContainer.id = 'reply-preview';
            previewContainer.className = 'reply-preview';
            const form = document.getElementById('message-form');
            form.parentNode.insertBefore(previewContainer, form);
        }

        const member = this.currentChatDetail?.members.find(m => m.user_id === sender_id);
        previewContainer.innerHTML = `
            <div class="reply-preview-content">
                <span class="reply-preview-name">${escapeHtml(member ? (member.display_name || member.username) : 'Unknown')}</span>
                <span class="reply-preview-text">${escapeHtml(content)}</span>
            </div>
            <button id="cancel-reply-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        previewContainer.style.display = 'flex';

        document.getElementById('cancel-reply-btn').onclick = () => this.cancelReply();
        document.getElementById('message-input').focus();
    },

    cancelReply() {
        this.replyToMsg = null;
        const preview = document.getElementById('reply-preview');
        if (preview) preview.style.display = 'none';
    },

    updateFileProgress(fileName, percent) {
        const previewItems = document.querySelectorAll('.preview-item');
        previewItems.forEach(item => {
            const nameSpan = item.querySelector('.file-name-hidden');
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
            const nameSpan = item.querySelector('.file-name-hidden');
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
        const rect = contentDiv.getBoundingClientRect();
        const oldWidth = rect.width;
        const oldHeight = rect.height;
        const textarea = document.createElement('textarea');
        textarea.className = 'edit-textarea';
        textarea.value = escapeHtml(oldText);
        textarea.style.width = oldWidth + 'px';
        textarea.style.height = Math.max(oldHeight, 24) + 'px';
        contentDiv.innerHTML = '';
        contentDiv.appendChild(textarea);

        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
        };
        textarea.addEventListener('input', adjustHeight);
        adjustHeight();

        const finishEdit = async () => {
            const newText = textarea.value.trim();
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
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finishEdit();
            } else if (e.key === 'Escape') {
                contentDiv.textContent = oldText;
            }
        });
        textarea.addEventListener('blur', finishEdit);
        textarea.focus();
    },

    async deleteMessage(msg) {
        if (!confirm('Are you sure you want to delete this message?')) return;
        try {
            await Api.deleteMessage(this.currentChatId, msg.id);
        } catch (err) {
            alert('Failed to delete message: ' + err.message);
        }
    },

    async obtainPrivateChatKey(chatId) {
        if (this.chatKeys[chatId]) this.currentChatSharedKey = this.chatKeys[chatId];

        let otherUserId = null;
        if (this.currentChatDetail && this.currentChatDetail.chat.id === chatId) {
            const other = this.currentChatDetail.members.find(m => m.user_id !== Api.userId);
            if (other) otherUserId = other.user_id;
        }
        if (!otherUserId) {
            const chat = this.chats.find(c => c.id === chatId);
            if (chat) otherUserId = chat.other_user.id;
        }
        if (!otherUserId) {
            try {
                const detail = await Api.get(`/chats/${chatId}`);
                const other = detail.members.find(m => m.user_id !== Api.userId);
                if (other) otherUserId = other.user_id;
            } catch (e) {
                console.error('Failed to load private chat details', e);
                return;
            }
        }
        if (!otherUserId) return;

        try {
            const pubResp = await Api.get(`/users/${otherUserId}/public-key`);
            if (!pubResp?.public_key) return;

            const partherPublicKey = await CryptoModule.importPublicKey(JSON.parse(pubResp.public_key));
            const myKeys = await KeyStorage.loadKeys(Api.userId);
            if (!myKeys) return;

            const sharedKey = await CryptoModule.deriveSharedKey(myKeys.privateKey, partherPublicKey);
            this.chatKeys[chatId] = sharedKey;
            this.currentChatSharedKey = sharedKey;
            return;
        } catch (e) {
            console.error('Failed to set up encryption for private chat', e);
            return;
        }
    },

    async obtainGroupKey(chatId) {
        if (this.chatKeys[chatId]) {
            this.currentChatSharedKey = this.chatKeys[chatId];
            return;
        }
        let members;
        if (this.currentChatDetail?.members) {
            members = this.currentChatDetail.members;
        } else {
            const detail = await Api.get(`/chats/${chatId}`);
            members = detail.members;
        } 
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
                const key = await crypto.subtle.importKey(
                    'raw',
                    rawKey,
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                this.chatKeys[chatId] = key;
                this.currentChatSharedKey = key;
                return;
            }
        } catch (e) {
            console.warn('No existing group key for', chatId, e);
            if (owner.user_id === Api.userId) {
                await this.generateGroupKey(chatId);
                const allMemberIds = members.map(m => m.user_id);
                await this.distributeGroupKey(chatId, allMemberIds);
            }
            return;
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
            if (event.code !== 1000) {
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
                case 'message_delivered':
                    this.onMessageDelivered(payload);
                    break;
                case 'messages_read':
                    this.onMessagesRead(payload);
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
                case 'avatar_updated':
                    this.onAvatarUpdated(payload);
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

        if (msg.sender_id !== Api.userId) {
            Api.post(`/chats/${msg.chat_id}/messages/${msg.id}/delivered`)
                .catch(e => console.error('Failed to mark delivered', e));
        } else {
            msg.status = 'sent';
        }
        if (this.currentChatId !== msg.chat_id) return;

        const key = this.chatKeys[msg.chat_id] || this.currentChatSharedKey;
        let plainText = null;
        if(key) {
            const packed = CryptoModule.unpackEncryptedData(msg);
            CryptoModule.decrypt(key, packed).then(plain => {
                msg.text = plain;
                const list = document.getElementById('messages-list');
                if (!list) return;
                const currentDate = this._getDateLabel(msg.sent_at);
                let hassameDate = false;
                const existingEls = list.querySelectorAll('.date-separator, .message[data-sent-at]');
                for (const el of existingEls) {
                    if (el.classList.contains('date-separator')) {
                        if (el.textContent === currentDate) {
                            hassameDate = true;
                            break;
                        }
                    } else if (el.dataset.sentAt) {
                        if (this._getDateLabel(el.dataset.sentAt) === currentDate) {
                            hassameDate = true;
                            break;
                        }
                    }
                }
                const appendEl = this.appendMessage(msg);
                if (!appendEl) return;

                if (!hassameDate) {
                    const sep = document.createElement('div');
                    sep.className = 'date-separator';
                    sep.textContent = currentDate;
                    appendEl.parentNode.insertBefore(sep, appendEl);
                }
                if (msg.sender_id === Api.userId || (list.scrollTop + list.clientHeight >= list.scrollHeight - 150)) {
                    list.scrollTop = list.scrollHeight;
                }
                this.scrollToBottomBtn(list);
                if (msg.sender_id !== Api.userId) {
                    const chat = this.chats.find(c => c.id === msg.chat_id);
                    if (chat) {
                        chat.unreadCount = (chat.unreadCount || 0) + 1;
                        this.renderLastMessage(chat.id);
                        this.updateChatsButtonBadge();
                    }
                }
                if (['image', 'video', 'file'].includes(msg.content_type) && !this.mediaProcessed.has(msg.id)) {
                    this.mediaProcessed.add(msg.id);
                    const msgEl = document.querySelector(`.message[data-message-id="${msg.id}"]`);
                    if (msgEl) this._decryptAndDisplayMedia(msgEl, msg, key);
                }
                if (msg.reply_to_id) this._decryptReplyPreviews([msg]);
            });
        }
    },

    onMessageUpdated(payload) {
        const chat = this.chats.find(c => c.id === payload.chat_id);
        if (chat && chat.last_message && chat.last_message.id === payload.id) {
            chat.last_message.encrypted_content = payload.encrypted_content;
            chat.last_message.nonce = payload.nonce;
            chat.last_message.edited_at = payload.edited_at;
            if (payload.status) chat.last_message.status = payload.status;
        }
        this.renderLastMessage(payload.chat_id);
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
        if (this.currentChatId === payload.chat_id){
            const contextMenu = document.getElementById('context-menu');
            if (contextMenu) contextMenu.remove();
            
            if (this.replyToMsg && this.replyToMsg.id === payload.message_id) this.cancelReply();
            const msgDiv = document.querySelector(`.message[data-message-id="${payload.message_id}"]`);
            if (msgDiv) {
                const wrapper = msgDiv.closest('.message-wrapper') || msgDiv;
                wrapper.classList.add('deleting');
                wrapper.addEventListener('animationend', () => {
                    const prevSep = wrapper.previousElementSibling;
                    const nextSep = wrapper.nextElementSibling;
                    wrapper.remove();
                    if (prevSep && prevSep.classList.contains('date-separator')) {
                        let hasSameDate = false;
                        let el = prevSep.nextElementSibling;
                        while (el && el !== nextSep) {
                            const msgEl = el.classList.contains('message-wrapper') ? el.querySelector('.message') : el;
                            if (msgEl && msgEl.dataset.sentAt) {
                                if (this._getDateLabel(msgEl.dataset.sentAt) === prevSep.textContent) {
                                    hasSameDate = true;
                                    break;
                                }
                            }
                            el = el.nextElementSibling;
                        }
                        if (!hasSameDate) prevSep.remove();
                    }
                    if (prevSep && nextSep && prevSep.classList.contains('date-separator') && nextSep.classList.contains('date-separator')) {
                        if (prevSep.textContent === nextSep.textContent) nextSep.remove();
                    }
                }, {once: true});
            }
        }
        this.renderLastMessage(payload.chat_id);
    },

    onMessageDelivered(payload) {
        const chat = this.chats.find(c => c.id === payload.chat_id);
        if (chat) chat.last_message.status = 'delivered';
        this.renderLastMessage(payload.chat_id);
        if (this.currentChatId !== payload.chat_id) return;
        const msgDiv = document.querySelector(`.message[data-message-id="${payload.message_id}"]`);
        if (msgDiv) {
            const statusEl = msgDiv.querySelector('.message-status');
            if (statusEl) {
                statusEl.textContent = '✓';
                statusEl.className = 'message-status delivered';
            }
        }
    },

    onMessagesRead(payload) {
        const chat = this.chats.find(c => c.id === payload.chat_id);
        if (chat) chat.last_message.status = 'read';
        this.renderLastMessage(payload.chat_id);
        if (this.currentChatId !== payload.chat_id) return;
        document.querySelectorAll('.message.own').forEach(msgDiv => {
            const statusEl = msgDiv.querySelector('.message-status');
            if (statusEl) {
                statusEl.textContent = '✓✓';
                statusEl.className = 'message-status read';
            }
        });
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
            this.hideInfoPanel();
            this.currentChatId = null;
            this.currentChatDetail = null;
            const main = document.getElementById('main');
            if (main) {
                main.classList.remove('chat-open');
                main.innerHTML = '<div class="chat-placeholder">Select a chat to start messaging</div>';
            }
        }
        this.chats = this.chats.filter(c => c.id !== payload.chat_id);
        this.loadChats();
    },

    onMembersChanged(payload) {
        if (this.currentChatId !== payload.chat_id) return;
        this.loadChatDetail(this.currentChatId).then(() => {
            const panel = document.getElementById('chat-info-panel');
            if (panel && panel.style.display === 'flex') {
                this.showInfoPanel();
            }
        });
    },
    onAvatarUpdated(payload) {
        Api.avatarCache.delete(payload.user_id);
        this.chats.forEach(chat => {
            if (chat.other_user && chat.other_user.id === payload.user_id) {
                chat.other_user.profile_photo_url = payload.profile_photo_url || null;
                this.renderChatInfo(chat.id);
            }
            if (chat.members) {
                chat.members.forEach(m => {
                    if (m.user_id === payload.user_id) {
                        m.profile_photo_url = payload.profile_photo_url || null;
                    }
                });
            }
        });
        if (this.currentChatDetail) {
            const member = this.currentChatDetail.members.find(m => m.user_id === payload.user_id);
            if (member) {
                const memberAvatarContainer = document.querySelector(`.member-item[data-user-id="${payload.user_id}"] .member-avatar`);
                if (memberAvatarContainer) memberAvatarContainer.forEach(container => {
                    this.loadAvatar(container, payload.user_id, payload.profile_photo_url);
                });
            }
            if (this.currentChatDetail.chat.type === 'private') {
                const other = this.currentChatDetail.members.find(m => m.user_id !== Api.userId);
                const headerContainer = document.getElementById('header-avatar');
                const profileAvatarContainer = document.querySelector('.panel-avatar');
                if (other && other.user_id === payload.user_id) {
                    if (headerContainer) {
                        this.loadAvatar(headerContainer, payload.user_id, payload.profile_photo_url);
                    }
                    if (profileAvatarContainer) {
                        this.loadAvatar(profileAvatarContainer, payload.user_id, payload.profile_photo_url);
                    }
                }
            }
        }

        const msgAvatars = document.querySelectorAll(`.message[data-sender-id="${payload.user_id}"] .message-avatar`);
        msgAvatars.forEach(container => {
            this.loadAvatar(container, payload.user_id, payload.profile_photo_url);
        });
    },
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