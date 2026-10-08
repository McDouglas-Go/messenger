function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c =>
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) {
        return null;
    }
}

let refreshPromise = null;

const Api = {
    authToken: null,
    userId: null,
    currentUsername: null,
    avatarCache: new Map(),

    setToken(token) {
        this.authToken = token;
        const payload = parseJwt(token);
        if (payload) {
            this.userId = payload.user_id;
            this.currentUsername = payload.username;
        }
    },

    clearToken() {
        this.authToken = null;
        this.userId = null;
        this.currentUsername = null;
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
                throw new Error('Not authenticated');
            }
        }

        if (!response.ok) {
            const error = await response.text();
            throw new Error(error || 'Request failed');
        }

        if (response.status === 204) return null;

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            try {
                return await response.json();
            } catch (e) {
                throw new Error('Invalid JSON response');
            }
        } else {
            const text = await response.text();
            return text === '' ? null : text;
        }
    },

    async refreshToken() {
        if (refreshPromise) {
            return refreshPromise;
        }
        refreshPromise = (async () => {
            try {
                const resp = await fetch('/refresh', { method: 'POST' });
                if (!resp.ok) return false;
                const data = await resp.json();
                this.setToken(data.access_token);
                return true;
            } catch (e) {
                return false;
            } finally {
                setTimeout(() => {
                    refreshPromise = null;
                }, 1000);
            }
        })();

        return refreshPromise;
    },

    async login(email, password) {
        const data = await this.post('/login', { email, password }, true);
        this.setToken(data.access_token);
        return data;
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
    del(url, body = null) { 
        return this.request('DELETE', url, body); 
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
        let url = `/chats/${chatId}/messages?limit=${limit}&offset=${offset}`;
        return this.get(url);
    },
    sendMessage(chatId, encryptedContent, nonce, contentType, replyToId = null) {
        return this.post(`/chats/${chatId}/messages`, {
            encrypted_content: encryptedContent,
            nonce: nonce,
            content_type: contentType,
            reply_to_id: replyToId,
        });
    },
    editMessage(chatId, messageId, encryptedContent, nonce, contentType) {
        return this.put(`/chats/${chatId}/messages/${messageId}`, {
            encrypted_content: encryptedContent,
            nonce: nonce,
            content_type: contentType,
        });
    },
    deleteMessage(chatId, messageId) {
        return this.del(`/chats/${chatId}/messages/${messageId}`);
    },

    uploadFile(fileBuffer, fileName, mimeType, onProgress) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/media', true);
            xhr.setRequestHeader('Authorization', `Bearer ${Api.authToken}`);
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = Math.round(e.loaded / e.total * 100);
                    if (onProgress) onProgress(percent);
                }
            };
            xhr.onload = () => {
                if (xhr.status === 201 || xhr.status === 200) {
                    try {
                        const resp = JSON.parse(xhr.responseText);
                        resolve(resp);
                    } catch (e) {
                        reject(new Error('Invalid server response'));
                    }
                } else {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Network error'));
            xhr.onabort = () => reject(new Error('Upload aborted'));

            const formData = new FormData();
            const blob = new Blob([fileBuffer], {type: mimeType || 'application/octet-stream'});

            formData.append('file', blob, fileName);
            xhr.send(formData);
        });
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
            video.autoplay = true;
            video.muted = false;
            video.playsInline = true;
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
            a.download = fileName || 'Noname media';
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

    async loadMediaUrl(mediaUrl) {
        if (!mediaUrl || !mediaUrl.trim()) return null;

        const fetchWithAuth = async (token) => {
            return await fetch(mediaUrl, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
        };

        let response = await fetchWithAuth(this.authToken);

        if (response.status === 401) {
            const refreshed = await this.refreshToken();
            if (refreshed) {
                response = await fetchWithAuth(this.authToken);
            } else {
                window.location.hash = '#login';
                return null;
            }
        }
        if (!response.ok) {
            console.error('Failed to load media', response.status);
            return null;
        }
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    },

    async getAvatar(objectId, photoUrl) {
        if (!objectId || !photoUrl) return null;
        const cached = this.avatarCache.get(objectId);
        if (cached) return cached;
        const blobUrl = await this.loadMediaUrl(photoUrl);
        if (blobUrl) this.avatarCache.set(objectId, blobUrl);
        return blobUrl;
    },
};