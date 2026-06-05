package model

import "time"

type MemberRole string

const (
	RoleOwner  MemberRole = "owner"
	RoleAdmin  MemberRole = "admin"
	RoleMember MemberRole = "member"
)

type ChatMember struct {
	ChatID   string
	UserID   string
	Role     MemberRole
	JoinedAt time.Time
}
