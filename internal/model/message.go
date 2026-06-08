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
	ID               string
	ChatID           string
	SenderID         string
	EncryptedContent []byte
	Nonce            []byte
	EncryptionKeyID  *string
	ContentType      ContentType
	SentAt           time.Time
	EditedAt         *time.Time
}
