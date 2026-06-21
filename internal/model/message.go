package model

import "time"

type ContentType string

const (
	ContentTypeText  ContentType = "text"
	ContentTypeImage ContentType = "image"
	ContentTypeVideo ContentType = "video"
	ContentTypeFile  ContentType = "file"
)

type EncryptedMessage struct {
	ID               string      `json:"id"`
	ChatID           string      `json:"chat_id"`
	SenderID         string      `json:"sender_id"`
	EncryptedContent []byte      `json:"encrypted_content"`
	Nonce            []byte      `json:"nonce"`
	EncryptionKeyID  *string     `json:"encryption_key_id,omitempty"`
	ContentType      ContentType `json:"content_type"`
	SentAt           time.Time   `json:"sent_at"`
	EditedAt         *time.Time  `json:"edited_at,omitempty"`
}
