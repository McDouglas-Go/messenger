package repository

import (
	"context"
	"fmt"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MessageRepository interface {
	Create(ctx context.Context, msg *model.EncryptedMessage) error
	GetChatMessages(ctx context.Context, chatID string, limit, offset int) ([]*model.EncryptedMessage, error)
}

type pgMessageRepository struct {
	pool *pgxpool.Pool
}

func NewMessageRepository(pool *pgxpool.Pool) MessageRepository {
	return &pgMessageRepository{pool: pool}
}

func (r *pgMessageRepository) Create(ctx context.Context, msg *model.EncryptedMessage) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	query := `
        INSERT INTO messages (chat_id, sender_id, encrypted_content, nonce, encryption_key_id, content_type)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, sent_at`

	err = tx.QueryRow(ctx, query,
		msg.ChatID,
		msg.SenderID,
		msg.EncryptedContent,
		msg.Nonce,
		msg.EncryptionKeyID,
		msg.ContentType,
	).Scan(&msg.ID, &msg.SentAt)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}

	_, err = tx.Exec(ctx, "UPDATE chats SET updated_at = now() WHERE id = $1", msg.ChatID)
	if err != nil {
		return fmt.Errorf("update chat updated_at: %w", err)
	}

	return tx.Commit(ctx)
}

func (r *pgMessageRepository) GetChatMessages(ctx context.Context, chatID string, limit, offset int) ([]*model.EncryptedMessage, error) {
	query := `
        SELECT id, chat_id, sender_id, encrypted_content, nonce, encryption_key_id, content_type, sent_at, edited_at
        FROM messages
        WHERE chat_id = $1
        ORDER BY sent_at ASC
        LIMIT $2 OFFSET $3`

	rows, err := r.pool.Query(ctx, query, chatID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}
	defer rows.Close()

	var messages []*model.EncryptedMessage
	for rows.Next() {
		m := &model.EncryptedMessage{}
		err := rows.Scan(
			&m.ID,
			&m.ChatID,
			&m.SenderID,
			&m.EncryptedContent,
			&m.Nonce,
			&m.EncryptionKeyID,
			&m.ContentType,
			&m.SentAt,
			&m.EditedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate messages: %w", err)
	}

	return messages, nil
}
