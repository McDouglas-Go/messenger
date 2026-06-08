package repository

import (
	"context"
	"fmt"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type MediaRepository interface {
	Create(ctx context.Context, media *model.Media) error
	GetByID(ctx context.Context, id string) (*model.Media, error)
	Delete(ctx context.Context, id string) error
}

type pgMediaRepository struct {
	pool *pgxpool.Pool
}

func NewMediaRepository(pool *pgxpool.Pool) MediaRepository {
	return &pgMediaRepository{pool: pool}
}

func (r *pgMediaRepository) Create(ctx context.Context, media *model.Media) error {
	query := `
        INSERT INTO media (message_id, user_id, file_path, mime_type, size_bytes)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, uploaded_at`

	args := []interface{}{
		media.MessageID,
		media.UserID,
		media.FilePath,
		media.MimeType,
		media.SizeBytes,
	}
	err := r.pool.QueryRow(ctx, query, args...).Scan(&media.ID, &media.UploadedAt)
	if err != nil {
		return fmt.Errorf("insert media: %w", err)
	}

	return nil
}

func (r *pgMediaRepository) GetByID(ctx context.Context, id string) (*model.Media, error) {
	query := `
        SELECT id, message_id, user_id, file_path, mime_type, size_bytes, uploaded_at
        FROM media
        WHERE id = $1`

	m := &model.Media{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&m.ID,
		&m.MessageID,
		&m.UserID,
		&m.FilePath,
		&m.MimeType,
		&m.SizeBytes,
		&m.UploadedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get media: %w", err)
	}

	return m, nil
}

func (r *pgMediaRepository) Delete(ctx context.Context, id string) error {
	res, err := r.pool.Exec(ctx, "DELETE FROM media WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete media: %w", err)
	}
	if res.RowsAffected() == 0 {
		return fmt.Errorf("media not found")
	}

	return nil
}
