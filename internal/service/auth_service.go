package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrValidation    = errors.New("validation error")
	ErrEmailTaken    = errors.New("email already exists")
	ErrUsernameTaken = errors.New("username alredy taken")
)

type AuthSerice interface {
	Register(ctx context.Context, input RegisterInput) (*model.User, error)
}

type RegisterInput struct {
	Username        string `json:"username"`
	Email           string `json:"email"`
	Password        string `json:"password"`
	PasswordConfirm string `json:"password_confirm"`
	DisplayName     string `json:"display_name"`
}

type authService struct {
	userRepo repository.UserRepository
}

func NewAuthService(userRepo repository.UserRepository) AuthSerice {
	return &authService{userRepo: userRepo}
}

func (s *authService) Register(ctx context.Context, input RegisterInput) (*model.User, error) {
	if err := validateRegisterInput(input); err != nil {
		return nil, err
	}
	existing, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		return nil, fmt.Errorf("check email uniqueness: %w", err)
	}
	if existing != nil {
		return nil, ErrEmailTaken
	}
	existing, err = s.userRepo.GetByUsername(ctx, input.Username)
	if err != nil {
		return nil, fmt.Errorf("check username uniquenes: %w", err)
	}
	if existing != nil {
		return nil, ErrUsernameTaken
	}
	hashedPassword, err := hashPassword(input.Password)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	user := &model.User{
		Username:        input.Username,
		Email:           input.Email,
		PasswordHash:    hashedPassword,
		DisplayName:     input.DisplayName,
		About:           "",
		ProfilePhotoURL: "",
		PublicKey:       nil,
	}

	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, fmt.Errorf("create user: %w", err)
	}

	return user, nil
}

func validateRegisterInput(input RegisterInput) error {
	if strings.TrimSpace(input.Email) == "" {
		return fmt.Errorf("%w email is required", ErrValidation)
	}
	if !strings.Contains(input.Email, "@") {
		return fmt.Errorf("%w invalid email", ErrValidation)
	}
	if strings.TrimSpace(input.Username) == "" {
		return fmt.Errorf("%w username is required", ErrValidation)
	}
	if len(input.Username) < 3 || len(input.Username) > 30 {
		return fmt.Errorf("%w username must be between 3 and 30 characters", ErrValidation)
	}
	for _, r := range input.Username {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '-' {
			return fmt.Errorf("%w username can only contain letters, digits, dashes and underscores", ErrValidation)
		}
	}

	if input.Password == "" {
		return fmt.Errorf("%w password is required", ErrValidation)
	}
	if len(input.Password) < 8 {
		return fmt.Errorf("%w password must contains 8 or more characters", ErrValidation)
	}
	if input.Password != input.PasswordConfirm {
		return fmt.Errorf("%w passwords do not match", ErrValidation)
	}
	if len(input.DisplayName) > 100 {
		return fmt.Errorf("%w display name must be less than 100 characters", ErrValidation)
	}

	return nil
}

func hashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", nil
	}
	return string(bytes), nil
}
