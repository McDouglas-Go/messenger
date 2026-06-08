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
	SearchByUsername(ctx context.Context, query string, limit int) ([]*model.User, error)
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

func (r *pgUserRepository) SearchByUsername(ctx context.Context, query string, limit int) ([]*model.User, error) {
	sql := `
        SELECT id, username, email, password_hash, display_name, about, profile_photo_url, public_key, created_at, updated_at
        FROM users
        WHERE username ILIKE $1
        ORDER BY username
        LIMIT $2`
	rows, err := r.pool.Query(ctx, sql, "%"+query+"%", limit)
	if err != nil {
		return nil, fmt.Errorf("search user: %w", err)
	}
	defer rows.Close()

	var users []*model.User
	for rows.Next() {
		user := &model.User{}
		err := rows.Scan(
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
			return nil, fmt.Errorf("scan user row: %w", err)
		}

		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}
	return users, nil
}

func (r *pgUserRepository) Update(ctx context.Context, user *model.User) error {
	query := `
        UPDATE users
        SET display_name = $1,
            about = $2,
            profile_photo_url = $3,
            public_key = $4,
            updated_at = now()
        WHERE id = $5
        RETURNING updated_at`

	args := []interface{}{
		user.DisplayName,
		user.About,
		user.ProfilePhotoURL,
		user.PublicKey,
		user.ID,
	}
	if err := r.pool.QueryRow(ctx, query, args...).Scan(&user.UpdatedAt); err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("user not found")
		}
		return fmt.Errorf("update user: %w", err)
	}

	return nil
}

func (r *pgUserRepository) Delete(ctx context.Context, id string) error {
	result, err := r.pool.Exec(ctx, "DELETE FROM users WHERE id = $1", id)
	if err != nil {
		return fmt.Errorf("delete user: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("user not found")
	}

	return nil
}
