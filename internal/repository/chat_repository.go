package repository

import (
	"context"
	"fmt"
	"os"
	"strings"

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
	Update(ctx context.Context, chat *model.Chat, oldMediaIDs []string) error
	Delete(ctx context.Context, id string) error
	RemoveMember(ctx context.Context, chatID, userID string) error
	GetMember(ctx context.Context, chatID, userID string) (*model.ChatMember, error)
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
        SELECT id, type, name, group_photo_url, group_photo_original_url, created_by, created_at, updated_at
        FROM chats
        WHERE id = $1`

	chat := &model.Chat{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&chat.ID,
		&chat.Type,
		&chat.Name,
		&chat.GroupPhotoURL,
		&chat.GroupPhotoOriginalURL,
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
        SELECT c.id, c.type, c.name, c.group_photo_url, c.created_by, c.created_at, c.updated_at
        FROM chats c
        INNER JOIN chat_members cm ON c.id = cm.chat_id
        WHERE cm.user_id = $1
        ORDER BY COALESCE(
			(SELECT MAX(m.sent_at) FROM messages m WHERE m.chat_id = c.id),
			c.created_at
		) DESC`

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
			&chat.GroupPhotoURL,
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

func (r *pgChatRepository) Update(ctx context.Context, chat *model.Chat, oldMediaIDs []string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var oldPaths []string
	if len(oldMediaIDs) > 0 {
		if strings.TrimSpace(oldMediaIDs[0]) != "" && strings.TrimSpace(oldMediaIDs[1]) != "" {
			rows, err := tx.Query(ctx, `SELECT file_path FROM media WHERE id = ANY($1)`, oldMediaIDs)
			if err != nil {
				return fmt.Errorf("query old media paths: %w", err)
			}
			defer rows.Close()

			for rows.Next() {
				var path string
				if err := rows.Scan(&path); err != nil {
					return fmt.Errorf("scan path: %w", err)
				}
				oldPaths = append(oldPaths, path)
			}
			if len(oldPaths) > 0 {
				if _, err = tx.Exec(ctx, `DELETE FROM media WHERE id = ANY($1)`, oldMediaIDs); err != nil {
					return fmt.Errorf("delete old media records: %w", err)
				}
			}
		}
	}
	query := `
        UPDATE chats
        SET name = $1,
			group_photo_url = $2,
			group_photo_original_url = $3,
            updated_at = now()
        WHERE id = $4
        RETURNING updated_at`

	err = tx.QueryRow(ctx, query, chat.Name, chat.GroupPhotoURL, chat.GroupPhotoOriginalURL, chat.ID).Scan(&chat.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update chat: %w", err)
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	if len(oldPaths) > 0 {
		for _, path := range oldPaths {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return fmt.Errorf("failed to remove old media file: %w", err)
			}
		}
	}

	return nil
}

func (r *pgChatRepository) Delete(ctx context.Context, id string) error {
	result, err := r.pool.Exec(ctx, "DELETE FROM chats WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete chat: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("chat not found")
	}

	return nil
}

func (r *pgChatRepository) RemoveMember(ctx context.Context, chatID, userID string) error {
	result, err := r.pool.Exec(ctx, "DELETE FROM chat_members WHERE chat_id = $1 AND user_id = $2", chatID, userID)
	if err != nil {
		return fmt.Errorf("remove member: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("member not found")
	}

	return nil
}

func (r *pgChatRepository) GetMember(ctx context.Context, chatID, userID string) (*model.ChatMember, error) {
	query := `SELECT chat_id, user_id, role, joined_at FROM chat_members WHERE chat_id = $1 AND user_id = $2`
	member := &model.ChatMember{}
	err := r.pool.QueryRow(ctx, query, chatID, userID).Scan(
		&member.ChatID,
		&member.UserID,
		&member.Role,
		&member.JoinedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get member: %w", err)
	}

	return member, nil
}
