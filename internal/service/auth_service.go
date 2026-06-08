package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/McDouglas-Go/messenger/internal/auth"
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
	Login(ctx context.Context, input LoginInput) (string, error)
	UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (*model.User, error)
	DeleteProfile(ctx context.Context, userID string) error
}

type RegisterInput struct {
	Username        string `json:"username"`
	Email           string `json:"email"`
	Password        string `json:"password"`
	PasswordConfirm string `json:"password_confirm"`
	DisplayName     string `json:"display_name"`
}

type LoginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type UpdateProfileInput struct {
	DisplayName     *string `json:"display_name,omitempty"`
	About           *string `json:"about,omitempty"`
	ProfilePhotoURL *string `json:"profile_photo_url,omitempty"`
	PublicKey       *string `json:"public_key,omitempty"`
}

type authService struct {
	userRepo   repository.UserRepository
	jwtManager *auth.JWTManager
}

func NewAuthService(userRepo repository.UserRepository, jwtManager *auth.JWTManager) AuthSerice {
	return &authService{userRepo: userRepo, jwtManager: jwtManager}
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

func (s *authService) Login(ctx context.Context, input LoginInput) (string, error) {
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		return "", fmt.Errorf("get user by email: %w", err)
	}
	if user == nil {
		return "", fmt.Errorf("invalid email or password")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		return "", fmt.Errorf("invalid email or password")
	}

	token, err := s.jwtManager.Generate(user.ID, user.Username)
	if err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}

	return token, nil
}

func (s *authService) UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (*model.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return nil, errors.New("user nor found")
	}

	if input.DisplayName != nil {
		user.DisplayName = *input.DisplayName
	}
	if input.About != nil {
		user.About = *input.About
	}
	if input.ProfilePhotoURL != nil {
		user.ProfilePhotoURL = *input.ProfilePhotoURL
	}
	if input.PublicKey != nil {
		user.PublicKey = input.PublicKey
	}

	if len(user.DisplayName) == 0 {
		return nil, fmt.Errorf("%w: display_name must be between 1 and 100 characters", ErrValidation)
	}

	if err := s.userRepo.Update(ctx, user); err != nil {
		return nil, fmt.Errorf("update user: %w", err)
	}

	return user, nil
}

func (s *authService) DeleteProfile(ctx context.Context, userID string) error {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return errors.New("user not found")
	}

	return s.userRepo.Delete(ctx, userID)
}
