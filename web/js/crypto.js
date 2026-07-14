const CryptoModule = {
    async generateKeyPair() {
        const keyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey']
        );
        return keyPair;
    },

    async exportPublicKey(publicKey) {
        const jwk = await crypto.subtle.exportKey('jwk', publicKey);
        return JSON.stringify(jwk);
    },

    async importPublicKey(jwk) {
        return await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            []
        );
    },

    async importPrivateKey(jwk) {
        return await crypto.subtle.importKey(
            'jwk',
            jwk,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveKey']
        );
    },

    async exportPrivateKey(privateKey) {
        const jwk = await crypto.subtle.exportKey('jwk', privateKey);
        return JSON.stringify(jwk);
    },

    async deriveSharedKey(privateKey, publicKey) {
        const derived = await crypto.subtle.deriveKey(
            { name: 'ECDH', public: publicKey },
            privateKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
        return derived;
    },

    async encrypt(sharedKey, plaintext) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plaintext);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            sharedKey,
            data
        );
        return { ciphertext: encrypted, nonce: iv };
    },

    async decrypt(sharedKey, encryptedData) {
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: encryptedData.nonce },
            sharedKey,
            encryptedData.ciphertext
        );
        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    },

    packEncryptedData({ ciphertext, nonce }) {
        return {
            encrypted_content: this.arrayBufferToBase64(ciphertext),
            nonce: this.arrayBufferToBase64(nonce)
        };
    },

    unpackEncryptedData(msg) {
        return {
            ciphertext: this.base64ToArrayBuffer(msg.encrypted_content),
            nonce: this.base64ToArrayBuffer(msg.nonce)
        };
    },

    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        const binary = Array.from(bytes, b => String.fromCharCode(b)).join('');
        return btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    },

    async encryptBuffer(sharedKey, buffer) {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            {name: 'AES-GCM', iv},
            sharedKey,
            buffer
        );
        return {ciphertext: encrypted, nonce: iv};
    },

    async decryptBuffer(sharedKey, encryptedData) {
        return await crypto.subtle.decrypt(
            {name: 'AES-GCM', iv: encryptedData.nonce},
            sharedKey,
            encryptedData.ciphertext
        );
    },
};