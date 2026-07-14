package model

import "time"

type GroupEncryptionKey struct {
	ChatID                string    `json:"chat_id"`
	UserID                string    `json:"user_id"`
	EncryptedSymmetricKey []byte    `json:"encrypted_symmetric_key"`
	KeyVersion            int       `json:"key_version"`
	CreatedAt             time.Time `json:"created_at"`
}
