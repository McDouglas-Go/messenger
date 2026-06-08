package model

import "time"

type Media struct {
	ID         string
	MessageID  *string
	UserID     *string
	FilePath   string
	MimeType   string
	SizeBytes  int64
	UploadedAt time.Time
}
