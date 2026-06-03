package handlers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

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

type AuthHandler struct {
	authService service.AuthSerice
	log         *log.Logger
}

func NewAuthHandler(authService service.AuthSerice, logger *log.Logger) *AuthHandler {
	return &AuthHandler{authService: authService, log: logger}
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

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
		h.log.Printf("Failed to encode response for user %s: %v", user.ID, err)
	}
}
