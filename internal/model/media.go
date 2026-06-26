package model

import "time"

type Media struct {
	ID         string    `json:"id"`
	MessageID  *string   `json:"message_id"`
	UserID     *string   `json:"user_id"`
	FilePath   string    `json:"file_path"`
	MimeType   string    `json:"mime_type"`
	SizeBytes  int64     `json:"size_bytes"`
	UploadedAt time.Time `json:"uploaded_at"`
}
