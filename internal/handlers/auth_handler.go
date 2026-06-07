package handlers

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/repository"
	"github.com/McDouglas-Go/messenger/internal/service"
)

type userResponse struct {
	ID              string `json:"id"`
	Username        string `json:"username"`
	Email           string `json:"email"`
	DisplayName     string `json:"display_name"`
	About           string `json:"about"`
	ProfilePhotoURL string `json:"profile_photo_url,omitempty"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type SearchUserResponse struct {
	ID              string `json:"id"`
	Username        string `json:"username"`
	DisplayName     string `json:"display_name"`
	About           string `json:"about"`
	ProfilePhotoURL string `json:"profile_photo_url,omitempty"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type AuthHandler struct {
	authService service.AuthSerice
	userRepo    repository.UserRepository
	log         *slog.Logger
}

func NewAuthHandler(authService service.AuthSerice, userRepo repository.UserRepository, logger *slog.Logger) *AuthHandler {
	return &AuthHandler{
		authService: authService,
		userRepo:    userRepo,
		log:         logger,
	}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var input service.RegisterInput

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid reques body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	user, err := h.authService.Register(r.Context(), input)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, service.ErrEmailTaken) || errors.Is(err, service.ErrUsernameTaken) {
			status = http.StatusConflict
		} else if errors.Is(err, service.ErrValidation) {
			status = http.StatusBadRequest
		}
		http.Error(w, err.Error(), status)
		return
	}

	resp := userResponse{
		ID:              user.ID,
		Username:        user.Username,
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		About:           user.About,
		ProfilePhotoURL: user.ProfilePhotoURL,
		CreatedAt:       user.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       user.UpdatedAt.Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode response for user %s: %v", user.ID, err)
	}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var input service.LoginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	token, err := h.authService.Login(r.Context(), input)
	if err != nil {
		status := http.StatusInternalServerError
		msg := "Internal server error"
		if err.Error() == "invalid email or password" {
			status = http.StatusUnauthorized
			msg = err.Error()
		}
		http.Error(w, msg, status)
		return
	}

	resp := map[string]string{"token": token}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode login response", "error", err)
	}
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, ok := middleware.GetClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "Unathorized", http.StatusUnauthorized)
		return
	}

	user, err := h.userRepo.GetByID(r.Context(), claims.UserID)
	if err != nil {
		h.log.Error("Failed to get user %s: %v", claims.UserID, err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	if user == nil {
		http.Error(w, "User not found", http.StatusNotFound)
		return
	}

	resp := userResponse{
		ID:              user.ID,
		Username:        user.Username,
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		About:           user.About,
		ProfilePhotoURL: user.ProfilePhotoURL,
		CreatedAt:       user.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       user.UpdatedAt.Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode me response", "error", err)
	}
}

func (h *AuthHandler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("query")
	if strings.TrimSpace(query) == "" {
		http.Error(w, "Query parameter 'query' is required", http.StatusBadRequest)
		return
	}

	if len(query) < 2 {
		http.Error(w, "Query must be at least 2 characters", http.StatusBadRequest)
		return
	}

	const maxResults = 20
	users, err := h.userRepo.SearchByUsername(r.Context(), query, maxResults)
	if err != nil {
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	resp := make([]SearchUserResponse, 0, len(users))
	for _, u := range users {
		resp = append(resp, SearchUserResponse{
			ID:              u.ID,
			Username:        u.Username,
			DisplayName:     u.DisplayName,
			About:           u.About,
			ProfilePhotoURL: u.ProfilePhotoURL,
			CreatedAt:       u.CreatedAt.Format(time.RFC3339),
			UpdatedAt:       u.UpdatedAt.Format(time.RFC3339),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode search response", "error", err)
	}
}
