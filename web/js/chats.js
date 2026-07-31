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
            let avatarHtml = '';
            if (chat.type === 'private' && chat.other_user) {
                title = chat.other_user.display_name || chat.other_user.username;
                const avatarUrl = await Api.getUserAvatar(chat.other_user.id, chat.other_user.profile_photo_url);
                if (avatarUrl) avatarHtml = `<img src="${escapeHtml(avatarUrl)}" alt="Avatar"">`;
            } else {
                title = chat.name;
            }

            let lastMsgText = await this.formatLastMessage(chat);

            li.innerHTML = `
                <div class="chat-avatar">${avatarHtml}</div>
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

    async selectChat(chatId) {
        this.mediaProcessed.clear();
        if (this.currentChatId === chatId) return;
        this.currentChatId = chatId;
        this.currentChatSharedKey = null;
        await this.renderChatList();
        this.hideInfoPanel();
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
                    <button id="back-from-group-create" class="icon-btn" title="Back">←</button>
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
                <button id="back-to-chats-btn" class="icon-btn" title="Back">←</button>
                ${avatarHtml}
                <div class="chat-header-info">
                    <div class="chat-header-title">${escapeHtml(title)}</div>
                    <div class="chat-header-subtitle">${subtitle}</div>
                </div>
            </div>
            <div class="chat-header-arrow" id="chat-header-arrow">︾ ︾ ︾</div>
            <div class="menu-wrapper">
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
                <button class="edit-panel-btn icon-btn" title="Edit">✎</button>
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
                this.loadChats();
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
            document.getElementById('main').innerHTML = '<div class="placeholder">Select a chat to start messaging</div>';
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
                <button id="back-to-chat-info-btn" class="icon-btn" title="Back">←</button>
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
                    <button type="button" id="attach-btn" title="Attach file">📎</button>
                    <input type="file" id="file-input" accept="image/*,video/*,.pdf,.doc,.docx" style="display:none" multiple>
                    <input type="text" id="message-input" placeholder="Message…" autocomplete="off" disabled>
                    <div class="send-btn-container" id="send-btn-container">
                        <button type="submit" id="send-message-btn" disabled>
                            <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                        </button>
                    </div>
                </form>
            </div>
            <div id="chat-info-panel" class="chat-info-panel"></div>
        `;

        const list = document.getElementById('messages-list');
        let lastDateLabel = null;
        messages.forEach(msg => {
            const currentDateLabel = this._getDateLabel(msg.sent_at);
            if (currentDateLabel !== lastDateLabel) {
                const sep = document.createElement('div');
                sep.className = 'date-separator';
                sep.textContent = currentDateLabel;
                list.appendChild(sep);
                lastDateLabel = currentDateLabel;
            }
            this.appendMessage(msg, list);
        });
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
                msgInput.placeholder = 'Waiting for encryption keys…';
            } else {
                msgInput.disabled = false;
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
                    this.updateSendBtn();
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

        const isOwn = (Api.userId && msg.sender_id === Api.userId);
        const isGroup = this.currentChatDetail && this.currentChatDetail.chat.type === 'group';
        const wrapper = document.createElement('div');
        wrapper.className = 'message-wrapper' + (isOwn ? ' own' : '');

        if (isGroup && !isOwn) {
            const avatarDiv = document.createElement('div');
            avatarDiv.className = 'message-avatar';
            avatarDiv.dataset.userId = msg.sender_id;
            wrapper.appendChild(avatarDiv);

            const member = this.currentChatDetail?.members.find(m => m.user_id === msg.sender_id);
            if (member) {
                this.loadAvatar(avatarDiv, msg.sender_id, member.profile_photo_url);
            }
        }

        const div = document.createElement('div');
        div.className = 'message ' + (isOwn ? 'own' : '');
        div.setAttribute('data-message-id', msg.id);
        div.dataset.senderId = msg.sender_id;

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
        wrapper.appendChild(div);
        container.appendChild(wrapper);
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
                        img.addEventListener('click', () => Api.openMediaViewer(url, mimeType, fileName, mediaText));
                        mediaContainer.appendChild(img);
                    } else if (mimeType.startsWith('video/')) {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'video-preview-wrapper';
                        const video = document.createElement('video');
                        video.src = url;
                        video.className = 'media-preview-video';
                        video.addEventListener('click', (e) => {
                            e.stopPropagation();
                            Api.openMediaViewer(url, mimeType, fileName, mediaText);
                        })
                        wrapper.appendChild(video);
                        const playIcon = document.createElement('div');
                        playIcon.textContent = '▶';
                        playIcon.className = 'play-icon';
                        wrapper.appendChild(playIcon);
                        mediaContainer.appendChild(wrapper);
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
            this.updateSendBtn();
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
                    true,
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
        this.renderChatList();
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