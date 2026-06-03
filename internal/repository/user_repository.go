package repository

import (
	"context"
	"fmt"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserRepository interface {
	Create(ctx context.Context, user *model.User) error
	GetByEmail(ctx context.Context, email string) (*model.User, error)
	GetByUsername(ctx context.Context, username string) (*model.User, error)
	GetByID(ctx context.Context, id string) (*model.User, error)
	Update(ctx context.Context, user *model.User) error
	Delete(ctx context.Context, id string) error
}

type pgUserRepository struct {
	pool *pgxpool.Pool
}

func NewUserRepository(pool *pgxpool.Pool) UserRepository {
	return &pgUserRepository{pool: pool}
}

func (r *pgUserRepository) Create(ctx context.Context, user *model.User) error {
	query := `
	INSERT INTO users (username, email, password_hash, display_name, about, profile_photo_url, public_key)
	VALUES ($1, $2, $3, $4, $5, $6, $7)
	RETURNING id, created_at, updated_at`

	args := []interface{}{
		user.Username,
		user.Email,
		user.PasswordHash,
		user.DisplayName,
		user.About,
		user.ProfilePhotoURL,
		user.PublicKey,
	}

	err := r.pool.QueryRow(ctx, query, args...).Scan(
		&user.ID,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("insert user: %w", err)
	}
	return nil
}

func (r *pgUserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	query := `
        SELECT id, username, email, password_hash, display_name, about, profile_photo_url, public_key, created_at, updated_at
        FROM users
        WHERE email = $1`

	user := &model.User{}
	err := r.pool.QueryRow(ctx, query, email).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.DisplayName,
		&user.About,
		&user.ProfilePhotoURL,
		&user.PublicKey,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query user by email: %w", err)
	}
	return user, nil
}

func (r *pgUserRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	query := `
        SELECT id, username, email, password_hash, display_name, about, profile_photo_url, public_key, created_at, updated_at
        FROM users
        WHERE username = $1`

	user := &model.User{}
	err := r.pool.QueryRow(ctx, query, username).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.DisplayName,
		&user.About,
		&user.ProfilePhotoURL,
		&user.PublicKey,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query user by username: %w", err)
	}
	return user, nil
}

func (r *pgUserRepository) GetByID(ctx context.Context, id string) (*model.User, error) {
	query := `
        SELECT id, username, email, password_hash, display_name, about, profile_photo_url, public_key, created_at, updated_at
        FROM users
        WHERE id = $1`

	user := &model.User{}
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.PasswordHash,
		&user.DisplayName,
		&user.About,
		&user.ProfilePhotoURL,
		&user.PublicKey,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("query user by id: %w", err)
	}
	return user, nil
}

func (r *pgUserRepository) Update(ctx context.Context, user *model.User) error {
	return fmt.Errorf("not ready")
}

func (r *pgUserRepository) Delete(ctx context.Context, id string) error {
	return fmt.Errorf("not ready")
}
