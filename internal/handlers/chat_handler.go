package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/service"
)

type chatResponse struct {
	ID        string  `json:"id"`
	Type      string  `json:"type"`
	Name      *string `json:"name,omitempty"`
	CreatedBy string  `json:"created_by"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

func chatToResponse(chat *model.Chat) chatResponse {
	return chatResponse{
		ID:        chat.ID,
		Type:      string(chat.Type),
		Name:      chat.Name,
		CreatedBy: chat.CreatedBy,
		CreatedAt: chat.CreatedAt.Format("2006-01-02T15:04:05Z"),
		UpdatedAt: chat.UpdatedAt.Format("2006-01-02T15:04:05Z"),
	}
}

type ChatHandler struct {
	chatService service.ChatService
	log         *log.Logger
}

func NewChatHandler(chatService service.ChatService, logger *log.Logger) *ChatHandler {
	return &ChatHandler{chatService: chatService, log: logger}
}

func (h *ChatHandler) CreatePrivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Methos mot allowed", http.StatusMethodNotAllowed)
		return
	}

	claims, ok := middleware.GetClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	currentUserID := claims.UserID

	var req struct {
		UserID string `json:"user_id"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if req.UserID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}

	chat, err := h.chatService.CreatePrivate(r.Context(), currentUserID, req.UserID)
	if err != nil {
		h.log.Printf("CreatePrivate error: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := chatToResponse(chat)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Printf("Failed to encode chat response: %v", err)
	}
}

func (h *ChatHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	claims, ok := middleware.GetClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	currentUserID := claims.UserID

	var req struct {
		Name      string   `json:"name"`
		MemberIDs []string `json:"member_ids"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	if req.Name == "" {
		http.Error(w, "name is required", http.StatusBadRequest)
		return
	}
	if len(req.MemberIDs) == 0 {
		http.Error(w, "at least one member is required", http.StatusBadRequest)
		return
	}

	chat, err := h.chatService.CreateGroup(r.Context(), req.Name, currentUserID, req.MemberIDs)
	if err != nil {
		h.log.Printf("CreateGroup error: %v", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := chatToResponse(chat)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Printf("Failed to encode chat response: %v", err)
	}
}

func (h *ChatHandler) GetUserChats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	claims, ok := middleware.GetClaimsFromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	chats, err := h.chatService.GetUserChats(r.Context(), claims.UserID)
	if err != nil {
		h.log.Printf("GetUserChats error: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	respList := make([]chatResponse, 0, len(chats))
	for _, chat := range chats {
		respList = append(respList, chatToResponse(chat))
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(respList); err != nil {
		h.log.Printf("Failed to encode chat list: %v", err)
	}
}
