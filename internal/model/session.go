package model

import "time"

type Session struct {
	ID               string
	UserID           string
	RefreshTokenHash string
	UserAgent        string
	ExpiresAt        time.Time
	CreatedAt        time.Time
}
