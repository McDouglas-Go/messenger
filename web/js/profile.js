const Profile = {
    async render(container) {
        let user;
        try {
            user = await Api.get('/me');
        } catch (err) {
            container.innerHTML = `<p class="error">Failed to load profile: ${err.message}</p>`;
            return;
        }
        let sessions = [];
        try {
            sessions = await Api.get('/sessions');
        } catch (err) {
            console.error('Failed to load sessions', err);
        }

        const html = `
            <div class="profile-page">
                <div class="profile-card">
                    <div class="profile-avatar">
                        ${user.profile_photo_url 
                            ? `<img src="${escapeHtml(user.profile_photo_url)}" alt="Avatar">`
                            : `<div class="avatar-placeholder large"></div>`
                        }
                    </div>
                    <div class="profile-details">
                        <h2>${escapeHtml(user.display_name)}</h2>
                        <p class="username">@${escapeHtml(user.username)}</p>
                        <p class="about">${escapeHtml(user.about || '')}</p>
                        <p class="created">Registered: ${new Date(user.created_at).toLocaleDateString()}</p>
                    </div>
                    <div class="profile-actions">
                        <button id="edit-profile-btn">Edit Profile</button>
                        <button id="logout-btn">Logout</button>
                        <button id="delete-account-btn" class="danger">Delete Account</button>
                    </div>
                </div>
                <div class="sessions-section">
                    <h3>Sessions</h3>
                    <div id="sessions-list">
                        ${sessions.length === 0 ? '<p>No active sessions</p>' : ''}
                        ${sessions.map(s => `
                            <div class="session-item ${s.is_current ? 'current' : ''}">
                                <div class="session-info">
                                    <span class="session-ua">${escapeHtml(s.user_agent || 'Unknown device')}</span>
                                    <span class="session-time">Created: ${new Date(s.created_at).toLocaleString()}</span>
                                    ${s.is_current ? '<span class="current-badge">Current</span>' : ''}
                                </div>
                                <button class="revoke-session-btn" data-session-id="${s.id}" ${s.is_current ? 'disabled' : ''}>Revoke</button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        container.innerHTML= html;

        document.getElementById('edit-profile-btn')?.addEventListener('click', () => this.openEditModal(user));
        document.getElementById('logout-btn')?.addEventListener('click', () => {
            if (typeof logout === 'function') logout();
        });
        document.getElementById('delete-account-btn')?.addEventListener('click', () => this.confirmDeleteAccount());

        document.querySelectorAll('.revoke-session-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const sessionId = btn.dataset.sessionId;
                if (!confirm('Revoke this session?')) return;
                try {
                    await Api.del(`/sessions/${sessionId}`);
                    const updatedSession = await Api.get('/sessions');
                    this.render(container);
                } catch (err) {
                    alert('Failed to revoke session: ' + err.message);
                }
            });
        });
    },


    openEditModal(user) {
        const html = `
            <div class="modal-content">
                <h3>Edit Profile</h3>
                <label>Display Name:</label>
                <input type="text" id="edit-display-name" value="${escapeHtml(user.display_name)}">
                <label>About:</label>
                <textarea id="edit-about">${escapeHtml(user.about || '')}</textarea>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:15px;">
                    <button id="cancel-edit-profile">Cancel</button>
                    <button id="save-edit-profile">Save</button>
                </div>
            </div>
        `;
        Modals.createModal('edit-profile-modal', html);
        Modals.show('edit-profile-modal');
        document.getElementById('cancel-edit-profile').onclick = () => Modals.hide('edit-profile-modal');
        document.getElementById('save-edit-profile').onclick = async () => {
            const displayName = document.getElementById('edit-display-name').value.trim();
            const about = document.getElementById('edit-about').value.trim();
            try {
                await Api.put('/me', { display_name: displayName, about });
                Modals.hide('edit-profile-modal');
                this.render(document.getElementById('main'));
            } catch (err) {
                alert('Failed to update profile: ' + err.message);
            }
        };
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