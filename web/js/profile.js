let pendingAvatarImage = null;

const Profile = {
    _sessionClickHandler: null, 
    _pendingAvatarRemove: false,

    async render(container) {
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
                    <div class="back-btn-container">
                        <button id="back-to-chats-btn" class="icon-btn" title="Back">←</button>
                    </div>
                    <div class="profile-info">
                        <div class="profile-avatar" id="profile-avatar">
                            ${avatarUrl
                                ? `<img src="${escapeHtml(avatarUrl)}" alt="Avatar">`
                                : ''
                            }
                        </div>
                        <div class="avatar-dropdown" id="avatar-dropdown" style="display:none;">
                            <button id="change-avatar-btn">Change avatar</button>
                            <button class="danger-btn" id="remove-avatar-btn" ${!user.profile_photo_url ? 'disabled' : ''}>Delete avatar</button>
                        </div>
                        <h3 id="display-name-text">${escapeHtml(user.display_name)}</h3>
                        <p class="username">@${escapeHtml(user.username)}</p>
                        <p class="about" id="about-text">${escapeHtml(user.about || '')}</p>
                        <p class="created">Registered: ${new Date(user.created_at).toLocaleDateString()}</p>
                    </div>
                    <div class="menu-wrapper">
                        <button id="profile-menu-btn" class="icon-btn menu-trigger">⋯</button>
                        <div id="profile-dropdown" class="dropdown-menu" style="display:none;">
                            <button id="edit-profile-btn">✎ Edit Profile</button>
                            <button id="download-key-btn">ꗃ Download Private Key</button>
                            <button id="logout-btn">⎋ Logout</button>
                            <button id="delete-account-btn" class="danger-btn">⚠ Delete Account</button>
                        </div>
                    </div>
                    <div id="profile-editor-actions" class="editor-actions" style="display:none;">
                        <button id="cancel-edit-profile">Cancel</button>
                        <button id="save-edit-profile">Save</button>
                    </div>
                </div>
                <div class="sessions-section">
                    <h3>Sessions</h3>
                    <button id="load-sessions-btn">Show Sessions</button>
                    <button id="toggle-sessions-btn" style="display:none;">Hide Sessions</button>
                    <div id="sessions-list"></div>
                </div>
            </div>
        `;
        const avatarImg = document.querySelector('.profile-avatar img');
        if (avatarImg) {
            const now = new Date();
            const formattedDate = now.toISOString().replace(/:/g, '.').slice(0, 19);
            const fileName = `Media_${formattedDate}.jpg`;
            avatarImg.style.cursor = 'pointer';
            avatarImg.addEventListener('click', () => {
                Api.openMediaViewer(avatarUrl, 'image/jpeg', fileName);
            });
        }
        const backBtn = document.getElementById('back-to-chats-btn');
        backBtn.onclick = () => window.location.hash = '#chats';
        const menuBtn = document.getElementById('profile-menu-btn');
        const dropdown = document.getElementById('profile-dropdown');
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            dropdown.style.display = 'none' ? 'block' : 'none';
        };
        document.addEventListener('click', () => {
            dropdown.style.display = 'none';
        });

        let isEditing = false;
        document.getElementById('edit-profile-btn').onclick = () => {
            menuBtn.style.display = 'none';
            backBtn.style.display = 'none';
            isEditing = true;
            const displayNameText = document.getElementById('display-name-text');
            displayNameText.style.display = 'none';
            const displayInput = document.createElement('input');
            displayInput.type = 'text';
            displayInput.id = 'display-name-input';
            displayInput.className = 'profile-input';
            displayInput.value = user.display_name;
            displayNameText.parentNode.insertBefore(displayInput, displayNameText.nextSibling);

            const aboutText = document.getElementById('about-text');
            aboutText.style.display = 'none';
            const aboutInput = document.createElement('input');
            aboutInput.id = 'about-input';
            aboutInput.className = 'profile-input';
            aboutInput.value = user.about || '';
            aboutText.parentNode.insertBefore(aboutInput, aboutText.nextSibling);

            document.getElementById('profile-editor-actions').style.display = 'flex';
            document.getElementById('edit-profile-btn').style.display = 'none';
            const avatarDropdown = document.getElementById('avatar-dropdown');
            if (avatarDropdown) avatarDropdown.style.display = 'none';
            const avatarImg = document.querySelector('#profile-avatar img');
            if (avatarImg) avatarImg.style.pointerEvents = 'none';

            const avatar = document.getElementById('profile-avatar');
            avatar.onclick = (e) => {
                e.stopPropagation();
                avatar.style.cursor = 'pointer';
                avatarDropdown.style.display = avatarDropdown.style.display === 'block' ? 'none' : 'block';
            };

            document.getElementById('change-avatar-btn').onclick = () => {
                avatarDropdown.style.display = 'none';
                this.startAvatarEdit(user);
            };
            document.getElementById('remove-avatar-btn').onclick = () => {
                avatarDropdown.style.display = 'none';
                this.removeAvatar(user);
            };
        };
        const finishEdit = async (save) => {
            if (save) {
                if (this._pendingAvatarRemove) {
                    let mediaId = user.profile_photo_url;
                    const parts = mediaId.split('/');
                    mediaId = parts[parts.length - 1];
                    try {
                        await Api.del(`/media/${mediaId}`);
                        await Api.put('/me', { remove_avatar: true });
                        user.profile_photo_url = null;
                        this._pendingAvatarRemove = false;
                    } catch (e) {
                        console.error('Failed to delete avatar');
                    }
                }
                if (pendingAvatarImage) {
                    try {
                        const buffer = await pendingAvatarImage.arrayBuffer();
                        const media = await Api.uploadFile(buffer, `avatar_${user.id}.jpg`, 'image/jpeg', () => {});
                        await Api.put('/me', { profile_photo_url: media.id });
                        user.profile_photo_url = media.id;
                        const newUrl = URL.createObjectURL(pendingAvatarImage);
                        const avatarContainer = document.getElementById('profile-avatar');
                        if (avatarContainer) {
                            avatarContainer.innerHTML = `<img src="${escapeHtml(newUrl)}" alt="Avatar">`;
                            avatarContainer.classList.add('has-image');
                        }
                    } catch (err) {
                        alert('Failed to upload avatar: ' + err.message);
                    }
                    pendingAvatarImage = null;
                }

                const newDisplayName = document.getElementById('display-name-input')?.value.trim() || '';
                const newAbout = document.getElementById('about-input')?.value.trim() || '';
                try {
                    await Api.put('/me', { display_name: newDisplayName, about: newAbout });
                    user.display_name = newDisplayName;
                    user.about = newAbout;
                    document.getElementById('display-name-text').textContent = newDisplayName;
                    document.getElementById('about-text').textContent = newAbout;
                } catch (err) {
                    alert('Failed to update profile: ' + err.message);
                }
            } else {
                pendingAvatarImage = null;
                if (this._pendingAvatarRemove) {
                    const avatarContainer = document.getElementById('profile-avatar');
                    if (avatarContainer) {
                        const restoredUrl = await Api.loadMediaUrl(user.profile_photo_url);
                        if (restoredUrl) {
                            avatarContainer.innerHTML = `<img src="${escapeHtml(restoredUrl)}" alt="Avatar">`;
                        } else {
                            avatarContainer.innerHTML = '';
                        }
                    }
                    this._pendingAvatarRemove = false;
                    const removeBtn = document.getElementById('remove-avatar-btn');
                    if (removeBtn) removeBtn.disabled = !user.profile_photo_url;
                }
            }
            document.getElementById('display-name-input')?.remove();
            document.getElementById('about-input')?.remove();
            document.getElementById('display-name-text').style.display = '';
            document.getElementById('about-text').style.display = '';
            document.getElementById('profile-editor-actions').style.display = 'none';
            document.getElementById('edit-profile-btn').style.display = '';
            const avatarDropdown = document.getElementById('avatar-dropdown');
            if (avatarDropdown) avatarDropdown.style.display = 'none';
            const avatarImg = document.querySelector('#profile-avatar img');
            if (avatarImg) avatarImg.style.pointerEvents = '';
            const avatar = document.getElementById('profile-avatar');
            if (avatar) avatar.onclick = null;
            menuBtn.style.display = 'flex';
            backBtn.style.display = 'flex';
            isEditing = false;
        };
        document.getElementById('cancel-edit-profile').onclick = () => finishEdit(false);
        document.getElementById('save-edit-profile').onclick = () => finishEdit(true);

        document.getElementById('download-key-btn')?.addEventListener('click', () => this.downloadPrivateKey(user));
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            if (typeof logout === 'function') logout();
        });
        document.getElementById('delete-account-btn')?.addEventListener('click', () => this.confirmDeleteAccount());

        document.getElementById('load-sessions-btn')?.addEventListener('click', () => this.loadAndShowSessions());
        document.getElementById('toggle-sessions-btn')?.addEventListener('click', () => this.hideSessions());
    },

    async loadAndShowSessions() {
        const sessions = await Api.get('/sessions');
        this.renderSessionList(sessions);
        this.attachSessionHandlers();
        document.getElementById('load-sessions-btn').style.display = 'none';
        document.getElementById('toggle-sessions-btn').style.display = 'inline-block';
    },

    hideSessions() {
        document.getElementById('sessions-list').innerHTML = '';
        document.getElementById('toggle-sessions-btn').style.display = 'none';
        document.getElementById('load-sessions-btn').style.display = 'inline-block';
        if (this._sessionClickHandler) {
            document.getElementById('sessions-list').removeEventListener('click', this._sessionClickHandler);
        }
    },

    renderSessionList(sessions) {
        const container = document.getElementById('sessions-list');
        if (!container) return;
        container.innerHTML = sessions.length === 0
            ? '<p>No active sessions</p>'
            : sessions.map(s => `
                <div class="session-item ${s.is_current ? 'current' : ''}">
                    <div class="session-info">
                        <span class="session-ua">${escapeHtml(s.user_agent || 'Unknown device')}</span>
                        <span class="session-time">Created: ${new Date(s.created_at).toLocaleString()}</span>
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

    async removeAvatar(user) {
        if (!confirm('Remove current avatar?')) return;
        this._pendingAvatarRemove = true;
        const avatarContainer = document.getElementById('profile-avatar');
        if (avatarContainer) {
            avatarContainer.classList.remove('has-image');
            avatarContainer.innerHTML = '';
        }

        const removeBtn = document.getElementById('remove-avatar-btn');
        if (removeBtn) removeBtn.disabled = true;
    },

    async startAvatarEdit(user) {
        const profileCard = document.querySelector('.profile-card');
        if (!profileCard) return;
        const profileInfo = profileCard.querySelector('.profile-info');
        if (profileInfo) profileInfo.style.display = 'none';
        const profileActions = profileCard.querySelector('.panel-actions');
        if (profileActions) profileActions.style.display = 'none';
        const sessionsSection = document.querySelector('.sessions-section');
        if (sessionsSection) sessionsSection.style.display = 'none';
        const editorActions = document.getElementById('profile-editor-actions');
        if (editorActions) editorActions.style.display = 'none';

        let avatarEditor = document.getElementById('avatar-editor-inline');
        if (!avatarEditor) {
            avatarEditor = document.createElement('div');
            avatarEditor.id = 'avatar-editor-inline';
            avatarEditor.className = 'avatar-editor-inline';
            avatarEditor.innerHTML = `
                <canvas id="avatar-canvas" width="300" height="300"></canvas>
                <input type="range" id="avatar-zoom-slider" min="1" max="4" step="0.1" value="1">
                <div class="editor-actions">
                    <button id="cancel-avatar-edit-inline">Cancel</button>
                    <button id="next-avatar-inline">Next</button>
                </div>
            `;
            profileCard.appendChild(avatarEditor);
        } else {
            avatarEditor.style.display = 'block';
        }

        const canvas = document.getElementById('avatar-canvas');
        const ctx = canvas.getContext('2d');
        const slider = document.getElementById('avatar-zoom-slider');
        const displaySize = canvas.width;

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = 600;
        outputCanvas.height = 600;
        const outputCtx = outputCanvas.getContext('2d');

        let currentImage = null;
        let baseScale = 1, zoomFactor = 1;
        let currentOffsetX = 0, currentOffsetY = 0;

        const drawImage = () => {
            if (!currentImage) return;
            ctx.clearRect(0, 0, displaySize, displaySize);
            const size = Math.min(currentImage.width, currentImage.height);
            const sx = (currentImage.width - size) / 2;
            const sy = (currentImage.height - size) / 2;
            const currentScale = baseScale * zoomFactor;
            const scaledSize = size * currentScale;
            const dx = (displaySize - scaledSize) / 2 + currentOffsetX;
            const dy = (displaySize - scaledSize) / 2 + currentOffsetY;
            ctx.drawImage(currentImage, sx, sy, size, size, dx, dy, scaledSize, scaledSize);
        };

        const computeBaseScale = () => {
            if (!currentImage) return 1;
            const size = Math.min(currentImage.width, currentImage.height);
            return displaySize / size;
        };

        slider.addEventListener('input', () => {
            zoomFactor = parseFloat(slider.value);
            drawImage();
        })

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) {
                document.body.removeChild(fileInput);
                return;
            }
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

        canvas.addEventListener('mousedown', (e) => {
            const startX = e.clientX, startY = e.clientY;
            const startOffX = currentOffsetX, startOffY = currentOffsetY;
            const onMouseMove = (e) => {
                currentOffsetX = startOffX + (e.clientX - startX);
                currentOffsetY = startOffY + (e.clientY - startY);
                drawImage();
            };
            const onMouseUp = () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        document.getElementById('cancel-avatar-edit-inline').onclick = () => {
            if (profileInfo) profileInfo.style.display = '';
            if (sessionsSection) sessionsSection.style.display = '';
            if (editorActions) editorActions.style.display = 'flex';
            avatarEditor.style.display = 'none';
        };

        document.getElementById('next-avatar-inline').onclick = async () => {
            if (!currentImage) {
                alert('Please select an image');
                return;
            }
            try {
                const outputScale = 2;
                outputCtx.clearRect(0, 0, 600, 600);
                const size = Math.min(currentImage.width, currentImage.height);
                const sx = (currentImage.width - size) / 2;
                const sy = (currentImage.height - size) / 2;
                const currentScale = baseScale * zoomFactor * outputScale;
                const scaledSize = size * currentScale;
                const dx = (600 - scaledSize) / 2 + currentOffsetX * outputScale;
                const dy = (600 - scaledSize) / 2 + currentOffsetY * outputScale;
                outputCtx.drawImage(currentImage, sx, sy, size, size, dx, dy, scaledSize, scaledSize);
                outputCanvas.toBlob((blob) => {
                    if (blob) {
                        pendingAvatarImage = blob;
                    }
                }, 'image/jpeg', 0.9);

                const tempBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
                const tempUrl = URL.createObjectURL(tempBlob);
                const avatarContainer = document.getElementById('profile-avatar');
                if (avatarContainer) {
                    avatarContainer.innerHTML = `<img src="${escapeHtml(tempUrl)}" alt="Avatar">`;
                    avatarContainer.classList.add('has-image');
                }

            } catch (err) {
                alert('Failed to upload avatar: ' + err.message);
            }
            if (profileInfo) profileInfo.style.display = '';
            if (profileActions) profileActions.style.display = '';
            if (sessionsSection) sessionsSection.style.display = '';
            if (editorActions) editorActions.style.display = 'flex';
            if (avatarEditor) avatarEditor.style.display = 'none';
        };
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