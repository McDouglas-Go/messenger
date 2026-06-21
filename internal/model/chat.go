package model

import "time"

type ChatType string

const (
	ChatTypePrivate ChatType = "private"
	ChatTypeGroup   ChatType = "group"
)

type Chat struct {
	ID        string    `json:"id"`
	Type      ChatType  `json:"type"`
	Name      *string   `json:"name"`
	CreatedBy string    `json:"created_by"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
