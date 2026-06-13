package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/service"
	"github.com/gorilla/mux"
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

type updateChatRequest struct {
	Name *string `json:"name,omitempty"`
}

type addMembersRequest struct {
	UserIDs []string `json:"user_ids"`
}

type removeMemberRequest struct {
	UserID string `json:"user_id"`
}

type ChatHandler struct {
	chatService service.ChatService
	log         *slog.Logger
}

func NewChatHandler(chatService service.ChatService, logger *slog.Logger) *ChatHandler {
	return &ChatHandler{chatService: chatService, log: logger}
}

func (h *ChatHandler) CreatePrivate(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

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
		h.log.Error("CreatePrivate error", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := chatToResponse(chat)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode chat response", "error", err)
	}
}

func (h *ChatHandler) CreateGroup(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

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
		h.log.Error("CreateGroup error", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := chatToResponse(chat)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		h.log.Error("Failed to encode chat response", "error", err)
	}
}

func (h *ChatHandler) GetUserChats(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	chatsWithInfo, err := h.chatService.GetUserChats(r.Context(), claims.UserID)
	if err != nil {
		h.log.Error("GetUserChats error", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	type chatInfo struct {
		ID        string            `json:"id"`
		Type      string            `json:"type"`
		Name      *string           `json:"name,omitempty"`
		CreatedBy string            `json:"created_by"`
		CreatedAt string            `json:"created_at"`
		UpdatedAt string            `json:"updated_at"`
		OtherUser *service.UserInfo `json:"other_user,omitempty"`
	}

	respList := make([]chatInfo, 0, len(chatsWithInfo))
	for _, cwi := range chatsWithInfo {
		ci := chatInfo{
			ID:        cwi.Chat.ID,
			Type:      string(cwi.Chat.Type),
			Name:      cwi.Chat.Name,
			CreatedBy: cwi.Chat.CreatedBy,
			CreatedAt: cwi.Chat.CreatedAt.Format(time.RFC3339),
			UpdatedAt: cwi.Chat.UpdatedAt.Format(time.RFC3339),
			OtherUser: cwi.OtherUser,
		}
		respList = append(respList, ci)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(respList); err != nil {
		h.log.Error("Failed to encode chat list", "error", err)
	}
}

func (h *ChatHandler) UpdateChat(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	chatID := mux.Vars(r)["chat_id"]
	var req updateChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	chat, err := h.chatService.UpdateChat(r.Context(), claims.UserID, chatID, req.Name)
	if err != nil {
		h.log.Error("UpdateChat failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	resp := chatToResponse(chat)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

func (h *ChatHandler) AddMembers(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())
	chatID := mux.Vars(r)["chat_id"]
	var req addMembersRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.UserIDs) == 0 {
		http.Error(w, "user_ids is required", http.StatusBadRequest)
		return
	}
	if err := h.chatService.AddMembers(r.Context(), claims.UserID, chatID, req.UserIDs); err != nil {
		h.log.Error("AddMembers failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ChatHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	chatID := mux.Vars(r)["chat_id"]
	var req removeMemberRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.UserID == "" {
		http.Error(w, "user_id is required", http.StatusBadRequest)
		return
	}
	if err := h.chatService.RemoveMember(r.Context(), claims.UserID, chatID, req.UserID); err != nil {
		h.log.Error("RemoveMember failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ChatHandler) DeleteChat(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	chatID := mux.Vars(r)["chat_id"]
	if err := h.chatService.DeleteChat(r.Context(), claims.UserID, chatID); err != nil {
		h.log.Error("DeleteChat failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
