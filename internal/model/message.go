package model

import "time"

type ContentType string
type MessageStatus string

const (
	ContentTypeText  ContentType = "text"
	ContentTypeImage ContentType = "image"
	ContentTypeVideo ContentType = "video"
	ContentTypeFile  ContentType = "file"
)

const (
	StatusSent      MessageStatus = "sent"
	StatusDelivered MessageStatus = "delivered"
	StatusRead      MessageStatus = "read"
)

type EncryptedMessage struct {
	ID               string        `json:"id"`
	ChatID           string        `json:"chat_id"`
	SenderID         string        `json:"sender_id"`
	EncryptedContent []byte        `json:"encrypted_content"`
	Nonce            []byte        `json:"nonce"`
	ContentType      ContentType   `json:"content_type"`
	Status           MessageStatus `json:"status"`
	SentAt           time.Time     `json:"sent_at"`
	EditedAt         *time.Time    `json:"edited_at,omitempty"`
}
