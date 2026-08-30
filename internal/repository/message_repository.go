package repository

import (
	"context"
	"fmt"
	"os"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MessageRepository interface {
	Create(ctx context.Context, msg *model.EncryptedMessage) error
	GetChatMessages(ctx context.Context, chatID string, limit, offset int) ([]*model.EncryptedMessage, error)
	GetByID(ctx context.Context, id string) (*model.EncryptedMessage, error)
	GetLastMessage(ctx context.Context, chatID string) (*model.EncryptedMessage, error)
	GetAllMessages(ctx context.Context, chatID string) ([]*model.EncryptedMessage, error)
	GetUnreadCountByChat(ctx context.Context, chatID, userID string) (int, error)
	MarkDelivered(ctx context.Context, messageID string) error
	MarkAsRead(ctx context.Context, messageID, userID string) (bool, error)
	Update(ctx context.Context, msg *model.EncryptedMessage) error
	Delete(ctx context.Context, messageID string) error
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
		INSERT INTO messages (chat_id, sender_id, encrypted_content, nonce, content_type, status, reply_to_id)
		VALUES ($1, $2, $3, $4, $5, 'sent', $6)
		RETURNING id, sent_at`

	err = tx.QueryRow(ctx, query,
		msg.ChatID,
		msg.SenderID,
		msg.EncryptedContent,
		msg.Nonce,
		msg.ContentType,
		msg.ReplyToID,
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
        SELECT id, chat_id, sender_id, encrypted_content, nonce, content_type, status, sent_at, edited_at, reply_to_id
        FROM messages
        WHERE chat_id = $1
        ORDER BY sent_at DESC
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
			&m.ContentType,
			&m.Status,
			&m.SentAt,
			&m.EditedAt,
			&m.ReplyToID,
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

func (r *pgMessageRepository) GetByID(ctx context.Context, id string) (*model.EncryptedMessage, error) {
	query := `
        SELECT id, chat_id, sender_id, encrypted_content, nonce, content_type, status, sent_at, edited_at, reply_to_id
        FROM messages
        WHERE id = $1`

	msg := &model.EncryptedMessage{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&msg.ID,
		&msg.ChatID,
		&msg.SenderID,
		&msg.EncryptedContent,
		&msg.Nonce,
		&msg.ContentType,
		&msg.Status,
		&msg.SentAt,
		&msg.EditedAt,
		&msg.ReplyToID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get message by id: %w", err)
	}

	return msg, nil
}

func (r *pgMessageRepository) GetLastMessage(ctx context.Context, chatID string) (*model.EncryptedMessage, error) {
	query := `
        SELECT id, chat_id, sender_id, encrypted_content, nonce, content_type, status, sent_at, edited_at, reply_to_id
        FROM messages
        WHERE chat_id = $1
        ORDER BY sent_at DESC
        LIMIT 1`

	msg := &model.EncryptedMessage{}
	err := r.pool.QueryRow(ctx, query, chatID).Scan(
		&msg.ID,
		&msg.ChatID,
		&msg.SenderID,
		&msg.EncryptedContent,
		&msg.Nonce,
		&msg.ContentType,
		&msg.Status,
		&msg.SentAt,
		&msg.EditedAt,
		&msg.ReplyToID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get last message: %w", err)
	}
	return msg, nil
}

func (r *pgMessageRepository) GetAllMessages(ctx context.Context, chatID string) ([]*model.EncryptedMessage, error) {
	query := `
        SELECT id, chat_id, sender_id, encrypted_content, nonce, content_type, status, sent_at, edited_at, reply_to_id
        FROM messages
        WHERE chat_id = $1
        ORDER BY sent_at`
	rows, err := r.pool.Query(ctx, query, chatID)
	if err != nil {
		return nil, fmt.Errorf("query all messages: %w", err)
	}
	defer rows.Close()

	var messages []*model.EncryptedMessage
	for rows.Next() {
		msg := &model.EncryptedMessage{}
		err := rows.Scan(
			&msg.ID,
			&msg.ChatID,
			&msg.SenderID,
			&msg.EncryptedContent,
			&msg.Nonce,
			&msg.ContentType,
			&msg.Status,
			&msg.SentAt,
			&msg.EditedAt,
			&msg.ReplyToID,
		)
		if err != nil {
			return nil, fmt.Errorf("scan message: %w", err)
		}
		messages = append(messages, msg)
	}
	return messages, nil
}

func (r *pgMessageRepository) GetUnreadCountByChat(ctx context.Context, chatID, userID string) (int, error) {
	var count int
	query := `
        SELECT COUNT(*)
        FROM messages m
        LEFT JOIN message_reads mr ON m.id = mr.message_id AND mr.user_id = $2
        WHERE m.chat_id = $1
          AND m.sender_id != $2
          AND mr.message_id IS NULL
    `
	err := r.pool.QueryRow(ctx, query, chatID, userID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count unread messages: %w", err)
	}

	return count, nil
}

func (r *pgMessageRepository) MarkDelivered(ctx context.Context, messageID string) error {
	_, err := r.pool.Exec(ctx, "UPDATE messages SET status = $1 WHERE id = $2", model.StatusDelivered, messageID)
	if err != nil {
		return fmt.Errorf("mark delivered: %w", err)
	}

	return nil
}

func (r *pgMessageRepository) MarkAsRead(ctx context.Context, messageID, userID string) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	query := `
        INSERT INTO message_reads (message_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING`

	result, err := tx.Exec(ctx, query, messageID, userID)
	if err != nil {
		return false, fmt.Errorf("insert message read: %w", err)
	}

	isFirstRead := result.RowsAffected() > 0
	if isFirstRead {
		_, err = tx.Exec(ctx, `UPDATE messages SET status = 'read' WHERE id = $1`, messageID)
		if err != nil {
			return false, fmt.Errorf("update read_by_some: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit transaction: %w", err)
	}

	return isFirstRead, nil
}

func (r *pgMessageRepository) Update(ctx context.Context, msg *model.EncryptedMessage) error {
	query := `
        UPDATE messages
        SET encrypted_content = $1,
            nonce = $2,
            content_type = $3,
            edited_at = now()
        WHERE id = $4
        RETURNING edited_at`

	err := r.pool.QueryRow(ctx, query,
		msg.EncryptedContent,
		msg.Nonce,
		msg.ContentType,
		msg.ID,
	).Scan(&msg.EditedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("message not found")
		}
		return fmt.Errorf("update message: %w", err)
	}

	return nil
}

func (r *pgMessageRepository) Delete(ctx context.Context, messageID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var mediaList []*model.Media
	rows, err := tx.Query(ctx, `SELECT id, file_path FROM media WHERE message_id = $1`, messageID)
	if err != nil {
		return fmt.Errorf("query media: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		media := &model.Media{}
		if err := rows.Scan(&media.ID, &media.FilePath); err != nil {
			return fmt.Errorf("scan media: %w", err)
		}
		mediaList = append(mediaList, media)
	}

	for _, media := range mediaList {
		if err := os.Remove(media.FilePath); err != nil {
			return fmt.Errorf("failed to remove media file %s: %v", media.FilePath, err)
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM media WHERE message_id = $1`, messageID); err != nil {
		return fmt.Errorf("delete media records: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE messages SET reply_to_id = NULL WHERE reply_to_id = $1`, messageID); err != nil {
		return fmt.Errorf("clear reply references: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM messages WHERE id = $1`, messageID); err != nil {
		return fmt.Errorf("delete message: %w", err)
	}

	return tx.Commit(ctx)
}
