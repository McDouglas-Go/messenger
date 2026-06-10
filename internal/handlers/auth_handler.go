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

type updateProfileRequest struct {
	DisplayName     *string `json:"display_name,omitempty"`
	About           *string `json:"about,omitempty"`
	ProfilePhotoURL *string `json:"profile_photo_url,omitempty"`
	PublicKey       *string `json:"public_key,omitempty"`
}

type AuthHandler struct {
	authService  service.AuthSerice
	userRepo     repository.UserRepository
	baseURL      string
	refreshTTL   time.Duration
	cookieSecure bool
	log          *slog.Logger
}

func NewAuthHandler(
	authService service.AuthSerice,
	userRepo repository.UserRepository,
	baseURL string,
	refreshTTL time.Duration,
	cookieSecure bool,
	logger *slog.Logger,
) *AuthHandler {
	return &AuthHandler{
		authService:  authService,
		userRepo:     userRepo,
		baseURL:      baseURL,
		refreshTTL:   refreshTTL,
		cookieSecure: cookieSecure,
		log:          logger,
	}
}

func setRefreshTokenCookie(w http.ResponseWriter, token string, maxAge time.Duration, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(maxAge.Seconds()),
	})
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

	accessToken, refreshToken, err := h.authService.Login(r.Context(), input, r.UserAgent(), r.RemoteAddr)
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
	setRefreshTokenCookie(w, refreshToken, h.refreshTTL, h.cookieSecure)

	resp := map[string]string{"access_token": accessToken}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode login response", "error", err)
	}
}

func (h *AuthHandler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		http.Error(w, "Refresh token missing", http.StatusUnauthorized)
		return
	}
	refreshToken := cookie.Value
	accessToken, newRefreshToken, err := h.authService.RefreshToken(r.Context(), refreshToken)
	if err != nil {
		h.log.Error("RefreshToken failed", "error", err)
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}
	setRefreshTokenCookie(w, newRefreshToken, h.refreshTTL, h.cookieSecure)

	resp := map[string]string{"access_token": accessToken}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode login response", "error", err)
	}
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		http.Error(w, "Refresh token missing", http.StatusUnauthorized)
		return
	}
	refreshToken := cookie.Value

	if err := h.authService.Logout(r.Context(), refreshToken); err != nil {
		h.log.Error("Logout failed", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.cookieSecure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1,
	})
	w.WriteHeader(http.StatusNoContent)
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

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
	profilePhoto := ""
	if user.ProfilePhotoURL != "" {
		profilePhoto = h.baseURL + "/api/media/" + user.ProfilePhotoURL
	}

	resp := userResponse{
		ID:              user.ID,
		Username:        user.Username,
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		About:           user.About,
		ProfilePhotoURL: profilePhoto,
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
		profilePhoto := ""
		if u.ProfilePhotoURL != "" {
			profilePhoto = h.baseURL + "/api/media/" + u.ProfilePhotoURL
		}
		resp = append(resp, SearchUserResponse{
			ID:              u.ID,
			Username:        u.Username,
			DisplayName:     u.DisplayName,
			About:           u.About,
			ProfilePhotoURL: profilePhoto,
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

func (h *AuthHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	var req updateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	input := service.UpdateProfileInput{
		DisplayName:     req.DisplayName,
		About:           req.About,
		ProfilePhotoURL: req.ProfilePhotoURL,
		PublicKey:       req.PublicKey,
	}

	user, err := h.authService.UpdateProfile(r.Context(), claims.UserID, input)
	if err != nil {
		if errors.Is(err, service.ErrValidation) {
			http.Error(w, err.Error(), http.StatusBadRequest)
		} else {
			h.log.Error("UpdateProfile failed", "error", err)
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
		return
	}
	profilePhoto := ""
	if user.ProfilePhotoURL != "" {
		profilePhoto = h.baseURL + "/api/media/" + user.ProfilePhotoURL
	}

	resp := userResponse{
		ID:              user.ID,
		Username:        user.Username,
		Email:           user.Email,
		DisplayName:     user.DisplayName,
		About:           user.About,
		ProfilePhotoURL: profilePhoto,
		CreatedAt:       user.CreatedAt.Format(time.RFC3339),
		UpdatedAt:       user.UpdatedAt.Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

func (h *AuthHandler) DeleteProfile(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	if err := h.authService.DeleteProfile(r.Context(), claims.UserID); err != nil {
		h.log.Error("DeleteAccount failed", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
