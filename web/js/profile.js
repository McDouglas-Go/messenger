const Profile = {
    _sessionClickHandler: null, 

    async render(container) {
        this._renderSidebarTabs();
        this.showTab('profile');
    },

    _renderSidebarTabs() {
        const chatList = document.getElementById('chat-list');
        if (!chatList) return;
        chatList.style.display = 'none';
        const createChatBtn = document.getElementById('create-chat-btn');
        if (createChatBtn) createChatBtn.style.display = 'none';

        let tabsContainer = document.getElementById('profile-tabs');
        if (!tabsContainer) {
            tabsContainer = document.createElement('div');
            tabsContainer.id = 'profile-tabs';
            tabsContainer.className = 'profile-tabs';
            chatList.parentNode.insertBefore(tabsContainer, chatList.nextSibling);
        }
        tabsContainer.style.display = 'block';
        tabsContainer.innerHTML = `
            <div class="profile-tab" data-tab="profile">
                <div class="tab-avatar-small" id="tab-avatar"></div>
                <div class="tab-info">
                    <span class="tab-name" id="tab-display-name"></span>
                    <span class="tab-username" id="tab-username"></span>
                </div>
            </div>
            <div class="profile-tab" data-tab="accounts">
                <span>Accounts</span>
            </div>
            <div class="profile-tab" data-tab="sessions">
                <span>Sessions</span>
            </div>
            <div class="profile-tab" data-tab="notifications">
                <span>Notifications</span>
            </div>
            <div class="profile-tab" data-tab="security">
                <span>Security & Privacy</span>
            </div>
        `;

        Api.get('/me').then(user => {
            document.getElementById('tab-display-name').textContent = user.display_name;
            document.getElementById('tab-username').textContent = '@' + user.username;
            if (user.profile_photo_url) {
                Api.loadMediaUrl(user.profile_photo_url).then(url => {
                    if (url) {
                        document.getElementById('tab-avatar').innerHTML = `<img src="${escapeHtml(url)}" alt="Avatar">`;
                    }
                });
            }
        });
        tabsContainer.querySelectorAll('.profile-tab').forEach(tab => {
            tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
        });
    },

    showTab(tabName) {
        const main = document.getElementById('main');
        if (!main) return;

        document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.profile-tab[data-tab="${tabName}"]`);
        if (activeTab) activeTab.classList.add('active');
        switch (tabName) {
            case 'profile':
                this.renderProfileTab(main);
                break;
            case 'accounts':
                this.renderPlaceholder(main, 'Accounts', 'Manage multiple accounts on this device. Coming soon.');
                break;
            case 'sessions':
                this.renderSessionsTab(main);
                break;
            case 'notifications':
                this.renderPlaceholder(main, 'Notifications', 'Configure notification settings. Coming soon.');
                break;
            case 'security':
                this.renderSecurityTab(main);
                break;
        }
    },

    async renderProfileTab(container) {
        let user;
        try {
            user = await Api.get('/me');
        } catch (err) {
            container.innerHTML = `<p class="error">Failed to load profile: ${err.message}</p>`;
            return;
        }
        
        const avatarUrl = await Api.loadMediaUrl(user.profile_photo_url);
        container.innerHTML = `
            <div class="profile-page">
                <div class="profile-card">
                    <div class="menu-wrapper" id="profile-menu-wrapper">
                        <button id="profile-menu-btn" class="icon-btn menu-trigger">⋯</button>
                        <div id="profile-dropdown" class="dropdown-menu" style="display:none;">
                            <button id="edit-profile-btn">✎ Edit Profile</button>
                            <button id="logout-btn">🚪 Logout</button>
                            <button id="delete-account-btn" class="danger-btn">⚠ Delete Account</button>
                        </div>
                    </div>
                    <div class="edit-actions" style="display:none;">
                        <button class="save-panel-btn icon-btn" title="Save">✓</button>
                        <button class="cancel-panel-btn icon-btn" title="Cancel">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>

                    <div class="profile-info">
                        <div class="profile-avatar-container">
                            <div class="profile-avatar" id="profile-avatar">
                                ${avatarUrl
                                    ? `<img src="${escapeHtml(avatarUrl)}" alt="Avatar">`
                                    : ''}
                            </div>
                            <div id="avatar-action-menu" class="avatar-action-menu dropdown-menu" style="display:none;"></div>
                        </div>
                        <h3 id="display-name-text">${escapeHtml(user.display_name)}</h3>
                        <input type="text" class="profile-input" id="display-name-input" value="${escapeHtml(user.display_name)}" style="display:none;">
                        <p class="username">@${escapeHtml(user.username)}</p>
                        <p class="about" id="about-text">${escapeHtml(user.about || '')}</p>
                        <textarea class="profile-input" id="about-input" style="display:none;">${escapeHtml(user.about || '')}</textarea>
                        <p class="created">Registered: ${new Date(user.created_at).toLocaleDateString()}</p>
                    </div>
                </div>
            </div>
        `;

        const menuWrapper = document.getElementById('profile-menu-wrapper');
        const menuBtn = document.getElementById('profile-menu-btn');
        const dropdown = document.getElementById('profile-dropdown');
        
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
        };

        document.addEventListener('click', () => dropdown.style.display = 'none');

        const avatarImg = document.querySelector('.profile-avatar img');
        if (avatarImg) {
            avatarImg.style.cursor = 'pointer';
            const openUrl = await Api.loadMediaUrl(user.profile_photo_original_url);
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const fileName = `picture_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.jpg`;
            avatarImg.addEventListener('click', () => {
                Api.openMediaViewer(openUrl, 'image/jpeg', fileName);
            });
        }

        const editActions = document.querySelector('.edit-actions');
        const saveBtn = document.querySelector('.save-panel-btn');
        const cancelBtn = document.querySelector('.cancel-panel-btn');

        document.getElementById('edit-profile-btn')?.addEventListener('click', () => {
            dropdown.style.display = 'none';
            menuWrapper.style.display = 'none';
            editActions.style.display = 'flex';
            let pendingAvatarBlob = null;
            let pendingAvatarOriginal = null;
            let pendingAvatarDelete = false;
            const displayNameText = document.getElementById('display-name-text');
            const displayNameInput = document.getElementById('display-name-input');
            displayNameText.style.display = 'none';
            displayNameInput.style.display = 'block';
            displayNameInput.value = user.display_name;
            displayNameInput.focus();
            const aboutText = document.getElementById('about-text');
            const aboutInput = document.getElementById('about-input');
            aboutText.style.display = 'none';
            aboutInput.style.display = 'block';
            aboutInput.value = user.about || '';

            const avatarImg = document.querySelector('#profile-avatar img');
            if (avatarImg) avatarImg.style.pointerEvents = 'none';
            const avatarContainer = document.getElementById('profile-avatar');
            avatarContainer.classList.add('avatar-editing');
            avatarContainer.style.cursor = 'pointer';
            const avatarMenu = document.getElementById('avatar-action-menu');

            avatarContainer.onclick = (e) => {
                e.stopPropagation();
                let menuHtml = `<button id="change-avatar-btn">Change Avatar</button>`;
                if (user.profile_photo_url) {
                    menuHtml += `<button id="remove-avatar-btn">Remove Avatar</button>`;
                }
                avatarMenu.innerHTML = menuHtml;
                avatarMenu.style.display = 'block';

                document.getElementById('change-avatar-btn').onclick = async () => {
                    avatarMenu.style.display = 'none';
                    const result = await this.startAvatarEdit('profile');
                    if (result) {
                        pendingAvatarBlob = result.croppedBlob;
                        pendingAvatarOriginal = result.originalFile;
                        pendingAvatarDelete = false;
                        const tempUrl = URL.createObjectURL(pendingAvatarBlob);
                        if (avatarContainer) {
                            avatarContainer.innerHTML = `<img src="${tempUrl}" alt="Avatar">`;
                        }
                    }
                };
                const removeBtn = document.getElementById('remove-avatar-btn');
                if (removeBtn) {
                    removeBtn.onclick = () => {
                        avatarMenu.style.display = 'none';
                        if (!confirm('Remove current avatar?')) return;
                        pendingAvatarDelete = true;
                        pendingAvatarBlob = null;
                        pendingAvatarOriginal = null;
                        if (avatarContainer) {
                            avatarContainer.innerHTML = '';
                        }
                    };
                }
            };

            document.addEventListener('click', (e) => {
                if (!avatarContainer.contains(e.target)) {
                    avatarMenu.style.display = 'none';
                }
            });

            const resetUI = async () => {
                menuWrapper.style.display = '';
                editActions.style.display = 'none';
                displayNameText.style.display = '';
                displayNameInput.style.display = 'none';
                aboutText.style.display = '';
                aboutInput.style.display = 'none';
                avatarContainer.classList.remove('avatar-editing');
                avatarContainer.onclick = null;
                avatarMenu.style.display = 'none';
                pendingAvatarBlob = null;
                pendingAvatarOriginal = null;
                pendingAvatarDelete = false;
                const url = await Api.loadMediaUrl(user.profile_photo_url);
                if (avatarContainer && url) {
                    avatarContainer.innerHTML = `<img src="${escapeHtml(url)}" alt="Avatar">`;
                }
            };

            cancelBtn.onclick = () => resetUI();

            saveBtn.onclick = async () => {
                const newDisplayName = displayNameInput.value.trim() || '';
                const newAbout = aboutInput.value.trim() || '';
                const hasTextChanged = newDisplayName !== user.display_name || newAbout !== (user.about || '');
                const hasAvatarChanged = pendingAvatarBlob !== null || pendingAvatarDelete;

                if (!hasTextChanged && !hasAvatarChanged) {
                    await resetUI();
                    return;
                }
                try {
                    const payload = {};

                    if (hasTextChanged) {
                        payload.display_name = newDisplayName;
                        payload.about = newAbout;
                    }
                    if (pendingAvatarDelete) { 
                        payload.remove_avatar = true;
                    } else if (pendingAvatarBlob && pendingAvatarOriginal) {
                        const avatarBuffer = await pendingAvatarBlob.arrayBuffer();
                        const avatarMedia = await Api.uploadFile(avatarBuffer, pendingAvatarBlob.name, pendingAvatarBlob.type, () => {});
                        const originalBuffer = await pendingAvatarOriginal.arrayBuffer();
                        const originalMedia = await Api.uploadFile(originalBuffer, pendingAvatarOriginal.name, pendingAvatarOriginal.type, () => {});
                        payload.profile_photo_url = avatarMedia.id;
                        payload.profile_photo_original_url = originalMedia.id;
                    }

                    await Api.put('/me', payload);

                    if (hasTextChanged) {
                        user.display_name = newDisplayName;
                        user.about = newAbout;
                    }
                    if (pendingAvatarDelete) {
                        user.profile_photo_url = null;
                        user.profile_photo_original_url = null;
                    } else if (payload.profile_photo_url) {
                        user.profile_photo_url = payload.profile_photo_url;
                        user.profile_photo_original_url = payload.profile_photo_original_url;
                    }
                    Profile.render(document.getElementById('main'));
                } catch (err) {
                    alert('Failed to update profile: ' + err.message);
                    resetUI();
                }
            };
        });

        document.getElementById('logout-btn')?.addEventListener('click', () => {
            dropdown.style.display = 'none';
            if (typeof logout === 'function') logout();
        });
        document.getElementById('delete-account-btn')?.addEventListener('click', () => {
            dropdown.style.display = 'none';
            this.confirmDeleteAccount()
        });
    },

    renderSessionsTab(container) {
        container.innerHTML = `
            <div class="profile-page">
                <div class="profile-card">
                    <h3>Active sessions</h3>
                    <button id="revoke-all-sessions-btn" class="danger-btn" style="display:none;">Revoke All Other Sessions</button>
                    <div id="sessions-list">Loading sessions…</div>
                </div>
            </div>
        `;
        this.loadSessions();
        document.getElementById('revoke-all-sessions-btn').onclick = () => this.revokeAllOtherSessions();
    },

    renderSecurityTab(container) {
        container.innerHTML = `
            <div class="profile-page">
                <div class="profile-card">
                    <h3>Security & Privacy</h3>
                    <button id="download-key-btn" class="download-key-btn">
                        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
                        Download Private Key
                    </button>
                    <p class="security-warning">⚠︎ Use this key only for other sessions on this account. Never share your private key with anyone. It grants full access to your encrypted messages.</p>
                </div>
            </div>
        `;

        document.getElementById('download-key-btn').onclick = () => this.downloadPrivateKey();
    },

    renderPlaceholder(container, title, message) {
        container.innerHTML = `
            <div class="profile-page">
                <div class="profile-card">
                    <h3>${escapeHtml(title)}</h3>
                    <p>${escapeHtml(message)}</p>
                </div>
            </div>
        `;
    },

    _restoreSidebar() {
        const tabsContainer = document.getElementById('profile-tabs');
        if (tabsContainer) tabsContainer.style.display = 'none';
        const chatList = document.getElementById('chat-list');
        if (chatList) chatList.style.display = '';
        const createChatBtn = document.getElementById('create-chat-btn');
        if (createChatBtn) createChatBtn.style.display = '';
    },

    async loadSessions() {
        try {
            const sessions = await Api.get('/sessions');
            this.renderSessionList(sessions);
            this.attachSessionHandlers();
        } catch (err) {
            document.getElementById('sessions-list').innerHTML = `<p class="error">Failed to load sessions: ${err.message}</p>`;
        }
    },

    renderSessionList(sessions) {
        const container = document.getElementById('sessions-list');
        if (!container) return;
        container.innerHTML = sessions.length === 0
            ? '<p>Failed to load sessions</p>'
            : sessions.map(s => `
                <div class="session-item ${s.is_current ? 'current' : ''}">
                    <div class="session-info">
                        <span class="session-ua">${escapeHtml(s.user_agent || 'Unknown device')}</span>
                        <span class="session-time">Created: ${new Date(s.created_at).toLocaleString()}</span>
                        <span class="session-expires">Expires: ${new Date(s.expires_at).toLocaleString()}</span>
                        ${s.is_current ? '<span class="current-badge">Current</span>' : ''}
                    </div>
                    <button class="revoke-session-btn" data-session-id="${s.id}" ${s.is_current ? 'disabled' : ''}>Revoke</button>
                </div>
            `).join('');
    },

    attachSessionHandlers() {
        const container = document.getElementById('sessions-list');
        if (!container) return;

        if (this._sessionClickHandler) {
            container.removeEventListener('click', this._sessionClickHandler);
        }

        this._sessionClickHandler = async (e) => {
            const btn = e.target.closest('.revoke-session-btn');
            if (!btn) return;
            const sessionId = btn.dataset.sessionId;
            if (!confirm('Revoke this session?')) return;
            try {
                await Api.del(`/sessions/${sessionId}`);
                const updatedSessions = await Api.get('/sessions');
                this.renderSessionList(updatedSessions);
            } catch (err) {
                alert('Failed to revoke session: ' + err.message);
            }
        };

        container.addEventListener('click', this._sessionClickHandler);
    },

    async revokeAllOtherSessions() {
        if (!confirm('Are you sure you want to revoke all other sessions?')) return;
        try {
            const sessions = await Api.get('/sessions');
            const currentSesison = sessions.find(s => s.is_current);
            const otherSessions = sessions.filter(s => !s.is_current);
            if (otherSessions.length === 0) {
                alert('No other sessions to revoke.');
                return;
            }
            for (const session of otherSessions) {
                try {
                    await Api.del(`/sessions/${session.id}`);
                } catch (e) {
                    console.error('Failed to revoke session', session.id, e);
                }
            }
            await this.loadSessions();
        } catch (err) {
            alert('Failed to revoke sessions: ' + err.message);
        }
    },

    async startAvatarEdit(context) {
        return new Promise((resolve) => {
            const container = document.getElementById('main');
            if (!container) {
                resolve(null);
                return;
            }
            let card = null;
            if (context === 'profile') {
                card = container.querySelector('.profile-card') || container;
                const profileInfo = card?.querySelector('.profile-info');
                if (profileInfo) profileInfo.style.display = 'none';
                const profileActions = card?.querySelector('.panel-actions');
                if (profileActions) profileActions.style.display = 'none';
                const sessionsSection = container.querySelector('.sessions-section');
                if (sessionsSection) sessionsSection.style.display = 'none';
                const editorActions = container.querySelector('#profile-editor-actions');
                if (editorActions) editorActions.style.display = 'none';
            } else {
                card = container.querySelector('#chat-info-panel .panel-content') || container;
                const groupInfo = container.querySelector('.group-info');
                if (groupInfo) groupInfo.style.display = 'none';
                const membersSection = card.querySelector('.members-section');
                if (membersSection) membersSection.style.display = 'none';
            }
            let avatarEditor = document.getElementById('avatar-editor-inline');
            if (!avatarEditor) {
                avatarEditor = document.createElement('div');
                avatarEditor.id = 'avatar-editor-inline';
                avatarEditor.className = 'avatar-editor-inline';
                avatarEditor.innerHTML = `
                    <div class="avatar-canvas-wrapper">
                        <canvas id="avatar-canvas" width="300" height="300"></canvas>
                    </div>
                    <input type="range" id="avatar-zoom-slider" min="1" max="4" step="0.1" value="1">
                    <div class="editor-actions">
                        <button id="cancel-avatar-edit-inline">Cancel</button>
                        <button id="next-avatar-inline">Next</button>
                    </div>
                `;
                card.appendChild(avatarEditor);
            } else {
                avatarEditor.style.display = 'block';
            }

            const canvas = document.getElementById('avatar-canvas');
            const ctx = canvas.getContext('2d');
            const slider = document.getElementById('avatar-zoom-slider');
            const displaySize = canvas.width;

            let currentImage = null;
            let zoomFactor = 1;
            let currentOffsetX = 0, currentOffsetY = 0;

            const drawImage = () => {
                if (!currentImage) return;
                ctx.clearRect(0, 0, displaySize, displaySize);
                const baseScale = computeBaseScale();
                const currentScale = baseScale * zoomFactor;
                const scaledWidth = currentImage.width * currentScale
                const scaledHeight = currentImage.height * currentScale;
                const dx = (displaySize - scaledWidth) / 2 + currentOffsetX;
                const dy = (displaySize - scaledHeight) / 2 + currentOffsetY;
                ctx.drawImage(currentImage, dx, dy, scaledWidth, scaledHeight);
            };

            const computeBaseScale = () => {
                if (!currentImage) return 1;
                const scaleX = displaySize / currentImage.width;
                const scaleY = displaySize / currentImage.height;
                return Math.max(scaleX, scaleY);
            };

            const clampOffsets = () => {
                if (!currentImage) return;
                const baseScale = computeBaseScale();
                const currentScale = baseScale * zoomFactor;
                const scaledWidth = currentImage.width * currentScale;
                const scaledHeight = currentImage.height * currentScale;
                const maxOffsetX = (scaledWidth - displaySize) / 2;
                const maxOffsetY = (scaledHeight - displaySize) / 2;
                currentOffsetX = Math.max(-maxOffsetX, Math.min(maxOffsetX, currentOffsetX));
                currentOffsetY = Math.max(-maxOffsetY, Math.min(maxOffsetY, currentOffsetY));
            };

            canvas.addEventListener('mousedown', (e) => {
                const startX = e.clientX, startY = e.clientY;
                const startOffX = currentOffsetX, startOffY = currentOffsetY;
                const onMouseMove = (e) => {
                    currentOffsetX = startOffX + (e.clientX - startX);
                    currentOffsetY = startOffY + (e.clientY - startY);
                    clampOffsets();
                    drawImage();
                };
                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);
                };
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            slider.addEventListener('input', () => {
                zoomFactor = parseFloat(slider.value);
                clampOffsets();
                drawImage();
            })

            let selectedFile = null;
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = 'image/*';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) {
                    document.body.removeChild(fileInput);
                    restoreUI();
                    resolve(null);
                    return;
                }
                selectedFile = file;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    currentImage = new Image();
                    currentImage.src = ev.target.result;
                    currentImage.onload = () => {
                        baseScale = computeBaseScale();
                        zoomFactor = 1;
                        currentOffsetX = 0;
                        currentOffsetY = 0;
                        slider.value = 1;
                        drawImage();
                    };
                };
                reader.readAsDataURL(file);
                document.body.removeChild(fileInput);
            };
            fileInput.click();

            const restoreUI = () => {
                if (context === 'profile') {
                    const profileInfo = card.querySelector('.profile-info');
                    if (profileInfo) profileInfo.style.display = '';
                    const profileActions = card.querySelector('.panel-actions');
                    if (profileActions) profileActions.style.display = '';
                    const sessionsSection = container.querySelector('.sessions-section');
                    if (sessionsSection) sessionsSection.style.display = '';
                    const editorActions = container.querySelector('#profile-editor-actions');
                    if (editorActions) editorActions.style.display = '';
                } else {
                    const groupInfo = container.querySelector('.group-info');
                    if (groupInfo) groupInfo.style.display = '';
                    const membersSection = card.querySelector('.members-section');
                    if (membersSection) membersSection.style.display = '';
                }
                selectedFile = null;
                avatarEditor.style.display = 'none';
            }

            document.getElementById('cancel-avatar-edit-inline').onclick = () => {
                restoreUI();
                resolve(null);
            };

            document.getElementById('next-avatar-inline').onclick = async () => {
                if (!currentImage || !selectedFile) {
                    alert('Please select an image');
                    return;
                }
                const originalFile = selectedFile;
                const croppedBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
                restoreUI();
                resolve({croppedBlob, originalFile});
            };
        });
    },

    async downloadPrivateKey(user) {
        const keys = await KeyStorage.loadKeys(Api.userId);
        if (!keys) {
            alert('No private key found');
            return;
        }
        const jwkStr = await CryptoModule.exportPrivateKey(keys.privateKey);
        const blob = new Blob([jwkStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${escapeHtml(user.username)}-${user.id}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },

    confirmDeleteAccount() {
        if (!confirm('Are you sure you want to delete your account? This cannot be undone.')) return;
        if (!confirm('Really delete? All data will be lost.')) return;
        Api.del('/me')
            .then(() => {
                alert('Account deleted.');
                if (typeof logout === 'function') logout();
            })
            .catch(err => alert('Failed to delete account: ' + err.message));
    }
};