package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SessionRepository interface {
	Create(ctx context.Context, session *model.Session) error
	GetByRefreshTokenHash(ctx context.Context, hash string) (*model.Session, error)
	Delete(ctx context.Context, id string) error
	DeleteByUserID(ctx context.Context, userID string) error
}

type pgSessionRepository struct {
	pool *pgxpool.Pool
}

func NewSessionRepository(pool *pgxpool.Pool) SessionRepository {
	return &pgSessionRepository{pool: pool}
}

func (r *pgSessionRepository) Create(ctx context.Context, session *model.Session) error {
	query := `
        INSERT INTO sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, created_at`

	args := []interface{}{
		session.UserID,
		session.RefreshTokenHash,
		session.UserAgent,
		session.IPAddress,
		session.ExpiresAt,
	}
	err := r.pool.QueryRow(ctx, query, args...).Scan(&session.ID, &session.CreatedAt)
	if err != nil {
		return fmt.Errorf("create session: %w", err)
	}

	return nil
}

func (r *pgSessionRepository) GetByRefreshTokenHash(ctx context.Context, hash string) (*model.Session, error) {
	query := `
        SELECT id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, created_at
        FROM sessions
        WHERE refresh_token_hash = $1`

	s := &model.Session{}
	err := r.pool.QueryRow(ctx, query, hash).Scan(
		&s.ID,
		&s.UserID,
		&s.RefreshTokenHash,
		&s.UserAgent,
		&s.IPAddress,
		&s.ExpiresAt,
		&s.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get session by hash: %w", err)
	}
	if time.Now().After(s.ExpiresAt) {
		_ = r.Delete(ctx, s.ID)
		return nil, nil
	}
	return s, nil
}

func (r *pgSessionRepository) Delete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, "DELETE FROM sessions WHERE id = $1", id)
	return err
}

func (r *pgSessionRepository) DeleteByUserID(ctx context.Context, userID string) error {
	_, err := r.pool.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userID)
	return err
}
