package model

import (
	"time"
)

type User struct {
	ID                      string
	Username                string
	Email                   string
	PasswordHash            string
	DisplayName             string
	About                   string
	ProfilePhotoURL         string
	ProfilePhotoOriginalURL string
	PublicKey               *string
	CreatedAt               time.Time
	UpdatedAt               time.Time
}
