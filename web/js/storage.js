const KeyStorage = {
    DB_NAME: 'messenger-keys',
    STORE_NAME: 'keys',

    async _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, 1);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME, {keyPath: 'userId'});
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async saveKeys(userId, privateKeyJwk, publicKeyJwk) {
        const db = await this._openDB();
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);

        const putRequest = store.put({userId, privateJwk: privateKeyJwk, publicJwk: publicKeyJwk});
        return new Promise((resolve, reject) => {
            putRequest.onsuccess = () => {
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e,target.error);
            };
            putRequest.onerror = (e) => reject(e.target.error);
        });
    },

    async loadKeys(userId) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(userId);
            request.onsuccess = async () => {
                const entry = request.result;
                if (!entry || !entry.privateJwk || !entry.publicJwk) {
                    resolve(null);
                    return;
                }
                try {
                    const privateJwkObj = JSON.parse(entry.privateJwk);
                    const publicJwkObj = JSON.parse(entry.publicJwk);
                    const privateKey = await CryptoModule.importPrivateKey(privateJwkObj);
                    const publicKey = await CryptoModule.importPublicKey(publicJwkObj);

                    resolve({ privateKey, publicKey });
                } catch (e) {
                    console.error('Failed to import stored keys:', e);
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    },

    async deleteKeys(userId) {
        const db = await this._openDB();
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        store.delete(userId);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }
};