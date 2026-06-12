const Api = {
    authToken: null,

    setToken(token) {
        this.authToken = token;
    },

    clearToken() {
        this.authToken = null;
    },

    async request(method, url, body = null, isPublic = false) {
        const headers = { 'Content-Type': 'application/json' };
        if (!isPublic && this.authToken) {
            headers['Authorization'] = `Bearer ${this.authToken}`;
        }

        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);

        let response = await fetch(url, options);

        if (response.status === 401 && !isPublic && this.authToken) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                headers['Authorization'] = `Bearer ${this.authToken}`;
                options.headers = headers;
                response = await fetch(url, options);
            } else {
                window.location.hash = '#login';
                throw new Error('Session expired');
            }
        }

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Request failed');
        }

        return response.status === 204 ? null : response.json();
    },

    async refreshToken() {
        try {
            const resp = await fetch('/refresh', { method: 'POST' });
            if (!resp.ok) return false;
            const data = await resp.json();
            this.setToken(data.access_token);
            return true;
        } catch (e) {
            return false;
        }
    },

    get(url) { 
        return this.request('GET', url); 
    },
    post(url, body, isPublic = false) { 
        return this.request('POST', url, body, isPublic); 
    },
    put(url, body) { 
        return this.request('PUT', url, body); 
    },
    del(url) { 
        return this.request('DELETE', url); 
    },
    getChats() {
        return this.get('/chats');
    },
    createPrivateChat(userId) {
        return this.post('/chats/private', { user_id: userId });
    },
    createGroupChat(name, memberIds) {
        return this.post('/chats/group', { name, member_ids: memberIds });
    },
    getMessages(chatId, limit = 50, offset = 0) {
        return this.get(`/chats/${chatId}/messages?limit=${limit}&offset=${offset}`);
    },
    sendMessage(chatId, encryptedContent, nonce, contentType, encryptionKeyId = null) {
        return this.post(`/chats/${chatId}/messages`, {
            encrypted_content: encryptedContent,
            nonce: nonce,
            content_type: contentType,
            encryption_key_id: encryptionKeyId
        });
    },
    editMessage(chatID, messageID, encryptedContent, nonce, contentType, encryptionKeyId = null) {
        return this.put(`/chats/${chatId}/messages/${messageId}`, {
            encrypted_content: encryptedContent,
            nonce: nonce,
            content_type: contentType,
            encryption_key_id: encryptionKeyId
        });
    },
    deleteMessage(chatID, messageID) {
        return this.del(`/chats/${chatId}/messages/${messageId}`);
    }
};