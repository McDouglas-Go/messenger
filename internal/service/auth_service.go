package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
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
	userRepo    repository.UserRepository
	sessionRepo repository.SessionRepository
	jwtManager  *auth.JWTManager
	refreshTTL  time.Duration
	logger      *slog.Logger
}

type AuthSerice interface {
	Register(ctx context.Context, input RegisterInput) (*model.User, error)
	Login(ctx context.Context, input LoginInput, userAgent, ip string) (string, string, error)
	RefreshToken(ctx context.Context, refreshToken, userAgent string) (string, string, error)
	Logout(ctx context.Context, refreshToken string) error
	UpdateProfile(ctx context.Context, userID string, input UpdateProfileInput) (*model.User, error)
	DeleteProfile(ctx context.Context, userID string) error
	ListSessions(ctx context.Context, userID string) ([]*model.Session, error)
	RevokeSession(ctx context.Context, userID, sessionID, currentTokenHash string) (bool, error)
}

func NewAuthService(
	userRepo repository.UserRepository,
	sessionRepo repository.SessionRepository,
	jwtManager *auth.JWTManager,
	refreshTTL time.Duration,
	logger *slog.Logger,
) AuthSerice {
	return &authService{
		userRepo:    userRepo,
		sessionRepo: sessionRepo,
		jwtManager:  jwtManager,
		refreshTTL:  refreshTTL,
		logger:      logger,
	}
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

func GenerateRefreshToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate random bytes: %w", err)
	}
	return hex.EncodeToString(b), nil
}

func (s *authService) Login(ctx context.Context, input LoginInput, userAgent, ip string) (string, string, error) {
	user, err := s.userRepo.GetByEmail(ctx, input.Email)
	if err != nil {
		return "", "", fmt.Errorf("get user by email: %w", err)
	}
	if user == nil {
		return "", "", fmt.Errorf("invalid email or password")
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		return "", "", fmt.Errorf("invalid email or password")
	}

	accessToken, err := s.jwtManager.Generate(user.ID, user.Username)
	if err != nil {
		return "", "", fmt.Errorf("generate access token: %w", err)
	}
	refreshToken, err := GenerateRefreshToken()
	if err != nil {
		return "", "", err
	}

	hash := auth.HashToken(refreshToken)

	session := &model.Session{
		UserID:           user.ID,
		RefreshTokenHash: hash,
		UserAgent:        userAgent,
		IPAddress:        ip,
		ExpiresAt:        time.Now().Add(s.refreshTTL),
	}
	if err := s.sessionRepo.Create(ctx, session); err != nil {
		return "", "", fmt.Errorf("create session: %w", err)
	}

	return accessToken, refreshToken, nil
}

func (s *authService) RefreshToken(ctx context.Context, refreshToken, userAgent string) (string, string, error) {
	hash := auth.HashToken(refreshToken)

	session, err := s.sessionRepo.GetByRefreshTokenHash(ctx, hash)
	if err != nil {
		return "", "", fmt.Errorf("get session: %w", err)
	}
	if session == nil {
		return "", "", errors.New("invalid refresh token")
	}
	if session.UserAgent != "" && session.UserAgent != userAgent {
		s.logger.Warn("user agent mismatch in refresh", "session_id", session.ID, "expected", session.UserAgent, "got", userAgent)
		s.sessionRepo.Delete(ctx, session.ID)
		return "", "", errors.New("session possibly compromised, please login again")
	}

	user, err := s.userRepo.GetByID(ctx, session.UserID)
	if err != nil {
		return "", "", fmt.Errorf("get user: %w", err)
	}
	if user == nil {
		return "", "", errors.New("user not found")
	}

	if err := s.sessionRepo.Delete(ctx, session.ID); err != nil {
		return "", "", fmt.Errorf("delete old session: %w", err)
	}

	newAccessToken, err := s.jwtManager.Generate(user.ID, user.Username)
	if err != nil {
		return "", "", fmt.Errorf("generate access token: %w", err)
	}

	newRefreshToken, err := GenerateRefreshToken()
	if err != nil {
		return "", "", err
	}

	newHash := auth.HashToken(newRefreshToken)
	newSession := &model.Session{
		UserID:           user.ID,
		RefreshTokenHash: newHash,
		UserAgent:        session.UserAgent,
		IPAddress:        session.IPAddress,
		ExpiresAt:        time.Now().Add(s.refreshTTL),
	}
	if err := s.sessionRepo.Create(ctx, newSession); err != nil {
		return "", "", fmt.Errorf("create new session: %w", err)
	}

	return newAccessToken, newRefreshToken, nil
}

func (s *authService) Logout(ctx context.Context, refreshToken string) error {
	hash := auth.HashToken(refreshToken)
	session, err := s.sessionRepo.GetByRefreshTokenHash(ctx, hash)
	if err != nil {
		return fmt.Errorf("get session: %w", err)
	}
	if session == nil {
		return nil
	}

	return s.sessionRepo.Delete(ctx, session.ID)
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

func (s *authService) ListSessions(ctx context.Context, userID string) ([]*model.Session, error) {
	return s.sessionRepo.GetByUserID(ctx, userID)
}

func (s *authService) RevokeSession(ctx context.Context, userID, sessionID, currentTokenHash string) (bool, error) {
	session, err := s.sessionRepo.GetByID(ctx, sessionID)
	if err != nil {
		return false, fmt.Errorf("get session: %w", err)
	}
	if session == nil {
		return false, errors.New("session not found")
	}
	if session.UserID != userID {
		return false, errors.New("you can only revoke your own sessions")
	}
	if err := s.sessionRepo.Delete(ctx, sessionID); err != nil {

	}
	if err := s.sessionRepo.Delete(ctx, sessionID); err != nil {
		return false, err
	}

	isCurrent := (currentTokenHash != "" && session.RefreshTokenHash == currentTokenHash)
	return isCurrent, nil
}
