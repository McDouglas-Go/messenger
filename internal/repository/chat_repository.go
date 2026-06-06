package repository

import (
	"context"
	"fmt"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChatRepository interface {
	Create(ctx context.Context, chat *model.Chat, creatorID string) error
	GetByID(ctx context.Context, id string) (*model.Chat, error)
	GetUserchats(ctx context.Context, userID string) ([]*model.Chat, error)
	AddMember(ctx context.Context, chatID, userID string, role model.MemberRole) error
	GetChatMembers(ctx context.Context, chatID string) ([]*model.ChatMember, error)
}

type pgChatRepository struct {
	pool *pgxpool.Pool
}

func NewChatRepository(pool *pgxpool.Pool) ChatRepository {
	return &pgChatRepository{pool: pool}
}

func (r *pgChatRepository) Create(ctx context.Context, chat *model.Chat, creatorID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}

	defer tx.Rollback(ctx)

	insertChat := `
        INSERT INTO chats (type, name, created_by)
        VALUES ($1, $2, $3)
        RETURNING id, created_at, updated_at`

	args := []interface{}{chat.Type, chat.Name, creatorID}
	err = tx.QueryRow(ctx, insertChat, args...).Scan(
		&chat.ID,
		&chat.CreatedAt,
		&chat.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert chat: %w", err)
	}

	insertMember := `
        INSERT INTO chat_members (chat_id, user_id, role)
        VALUES ($1, $2, $3)`

	_, err = tx.Exec(ctx, insertMember, chat.ID, creatorID, model.RoleOwner)
	if err != nil {
		return fmt.Errorf("insert chat member: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit transaction: %w", err)
	}

	return nil
}

func (r *pgChatRepository) GetByID(ctx context.Context, id string) (*model.Chat, error) {
	query := `
        SELECT id, type, name, created_by, created_at, updated_at
        FROM chats
        WHERE id = $1`

	chat := &model.Chat{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&chat.ID,
		&chat.Type,
		&chat.Name,
		&chat.CreatedBy,
		&chat.CreatedAt,
		&chat.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query chat by id: %w", err)
	}

	return chat, nil
}

func (r *pgChatRepository) GetUserchats(ctx context.Context, userID string) ([]*model.Chat, error) {
	query := `
        SELECT c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at
        FROM chats c
        INNER JOIN chat_members cm ON c.id = cm.chat_id
        WHERE cm.user_id = $1
        ORDER BY c.updated_at DESC`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("query user chats; %w", err)
	}
	defer rows.Close()

	var chats []*model.Chat
	for rows.Next() {
		chat := &model.Chat{}
		err := rows.Scan(
			&chat.ID,
			&chat.Type,
			&chat.Name,
			&chat.CreatedBy,
			&chat.CreatedAt,
			&chat.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan chat: %w", err)
		}
		chats = append(chats, chat)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chats: %w", err)
	}

	return chats, nil
}

func (r *pgChatRepository) AddMember(ctx context.Context, chatID, userID string, role model.MemberRole) error {
	query := `INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1, $2, $3)`
	_, err := r.pool.Exec(ctx, query, chatID, userID, role)
	if err != nil {
		return fmt.Errorf("insert chat member: %w", err)
	}
	return nil
}

func (r *pgChatRepository) GetChatMembers(ctx context.Context, chatID string) ([]*model.ChatMember, error) {
	query := `SELECT chat_id, user_id, role, joined_at FROM chat_members WHERE chat_id = $1 ORDER BY joined_at`
	rows, err := r.pool.Query(ctx, query, chatID)
	if err != nil {
		return nil, fmt.Errorf("query chat member: %w", err)
	}
	defer rows.Close()

	var members []*model.ChatMember
	for rows.Next() {
		member := &model.ChatMember{}
		err := rows.Scan(
			&member.ChatID,
			&member.UserID,
			&member.Role,
			&member.JoinedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan members: %w", err)
		}
		members = append(members, member)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate members: %w", err)
	}

	return members, nil
}
