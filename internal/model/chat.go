package model

import "time"

type ChatType string

const (
	ChatTypePrivate ChatType = "private"
	ChatTypeGroup   ChatType = "group"
)

type Chat struct {
	ID        string
	Type      ChatType
	Name      *string
	CreatedBy string
	CreatedAt time.Time
	UpdatedAt time.Time
}
