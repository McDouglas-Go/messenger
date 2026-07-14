package repository

import (
	"context"
	"fmt"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type GroupKeyRepository interface {
	SetKey(ctx context.Context, key *model.GroupEncryptionKey) error
	GetKey(ctx context.Context, chatID, userID string) (*model.GroupEncryptionKey, error)
}

type pgGroupKeyRepository struct {
	pool *pgxpool.Pool
}

func NewGroupKeyRepository(pool *pgxpool.Pool) GroupKeyRepository {
	return &pgGroupKeyRepository{pool: pool}
}

func (r *pgGroupKeyRepository) SetKey(ctx context.Context, key *model.GroupEncryptionKey) error {
	query := `
        INSERT INTO group_encryption_keys (chat_id, user_id, encrypted_symmetric_key, key_version)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (chat_id, user_id) DO UPDATE SET
            encrypted_symmetric_key = EXCLUDED.encrypted_symmetric_key,
            key_version = EXCLUDED.key_version,
            created_at = NOW()
        RETURNING created_at`

	err := r.pool.QueryRow(ctx, query, key.ChatID, key.UserID, key.EncryptedSymmetricKey, key.KeyVersion).Scan(&key.CreatedAt)
	if err != nil {
		return fmt.Errorf("set group key: %w", err)
	}
	return nil
}

func (r *pgGroupKeyRepository) GetKey(ctx context.Context, chatID, userID string) (*model.GroupEncryptionKey, error) {
	query := `
        SELECT chat_id, user_id, encrypted_symmetric_key, key_version, created_at
        FROM group_encryption_keys
        WHERE chat_id = $1 AND user_id = $2`

	key := &model.GroupEncryptionKey{}
	err := r.pool.QueryRow(ctx, query, chatID, userID).Scan(
		&key.ChatID,
		&key.UserID,
		&key.EncryptedSymmetricKey,
		&key.KeyVersion,
		&key.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get group key: %w", err)
	}
	return key, nil
}
