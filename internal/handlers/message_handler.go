package handlers

import (
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/service"
	"github.com/gorilla/mux"
)

type MessageHandler struct {
	messageService service.MesssageService
	log            *slog.Logger
}

func Newmessagehandler(messageService service.MesssageService, logger *slog.Logger) *MessageHandler {
	return &MessageHandler{messageService: messageService, log: logger}
}

type sendMessageRequest struct {
	EncryptedContent string  `json:"encrypted_content"` // base64
	Nonce            string  `json:"nonce"`             // base64
	EncryptionKeyID  *string `json:"encryption_key_id,omitempty"`
	ContentType      string  `json:"content_type"`
}

type messageResponse struct {
	ID               string  `json:"id"`
	ChatID           string  `json:"chat_id"`
	SenderID         string  `json:"sender_id"`
	EncryptedContent string  `json:"encrypted_content"` // base64
	Nonce            string  `json:"nonce"`             // base64
	EncryptionKeyID  *string `json:"encryption_key_id,omitempty"`
	ContentType      string  `json:"content_type"`
	SentAt           string  `json:"sent_at"`
	EditedAt         *string `json:"edited_at,omitempty"`
}

type editMessageRequest struct {
	EncryptedContent string  `json:"encrypted_content"`
	Nonce            string  `json:"nonce"`
	ContentType      string  `json:"content_type"`
	EncryptionKeyID  *string `json:"encryption_key_id,omitempty"`
}

func MessageToResponse(msg *model.EncryptedMessage) messageResponse {
	m := messageResponse{
		ID:               msg.ID,
		ChatID:           msg.ChatID,
		SenderID:         msg.SenderID,
		EncryptedContent: base64.StdEncoding.EncodeToString(msg.EncryptedContent),
		Nonce:            base64.StdEncoding.EncodeToString(msg.Nonce),
		EncryptionKeyID:  msg.EncryptionKeyID,
		ContentType:      string(msg.ContentType),
		SentAt:           msg.SentAt.Format(time.RFC3339),
	}
	if msg.EditedAt != nil {
		s := msg.EditedAt.Format(time.RFC3339)
		m.EditedAt = &s
	}

	return m
}

func (h *MessageHandler) Send(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	chatID := mux.Vars(r)["chat_id"]
	if chatID == "" {
		http.Error(w, "chat_id is required", http.StatusBadRequest)
		return
	}

	var req sendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	defer r.Body.Close()

	encryptedContent, err := base64.StdEncoding.DecodeString(req.EncryptedContent)
	if err != nil {
		http.Error(w, "Invalid base64 for encrypted_content", http.StatusBadRequest)
		return
	}
	nonce, err := base64.StdEncoding.DecodeString(req.Nonce)
	if err != nil {
		http.Error(w, "Invalid base64 for nonce", http.StatusBadRequest)
		return
	}

	msg := &model.EncryptedMessage{
		ChatID:           chatID,
		EncryptedContent: encryptedContent,
		Nonce:            nonce,
		EncryptionKeyID:  req.EncryptionKeyID,
		ContentType:      model.ContentType(req.ContentType),
	}

	if err := h.messageService.Send(r.Context(), claims.UserID, msg); err != nil {
		h.log.Error("failed to send message", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := messageResponse{
		ID:               msg.ID,
		ChatID:           msg.ChatID,
		SenderID:         msg.SenderID,
		EncryptedContent: req.EncryptedContent,
		Nonce:            req.Nonce,
		EncryptionKeyID:  msg.EncryptionKeyID,
		ContentType:      string(msg.ContentType),
		SentAt:           msg.SentAt.Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("failed to encode response", "error", err)
	}
}

func (h *MessageHandler) GetChatHistory(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	chatID := mux.Vars(r)["chat_id"]
	if chatID == "" {
		http.Error(w, "chat_id is required", http.StatusBadRequest)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	messages, err := h.messageService.GetChatHistory(r.Context(), chatID, claims.UserID, limit, offset)
	if err != nil {
		h.log.Error("failed to get messages", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := make([]messageResponse, 0, len(messages))
	for _, msg := range messages {
		var editedAt *string
		if msg.EditedAt != nil {
			t := msg.EditedAt.Format(time.RFC3339)
			editedAt = &t
		}

		resp = append(resp, messageResponse{
			ID:               msg.ID,
			ChatID:           msg.ChatID,
			SenderID:         msg.SenderID,
			EncryptedContent: base64.StdEncoding.EncodeToString(msg.EncryptedContent),
			Nonce:            base64.StdEncoding.EncodeToString(msg.Nonce),
			EncryptionKeyID:  msg.EncryptionKeyID,
			ContentType:      string(msg.ContentType),
			SentAt:           msg.SentAt.Format(time.RFC3339),
			EditedAt:         editedAt,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		slog.Error("failed to encode response", "error", err)
	}
}

func (h *MessageHandler) EditMessage(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	vars := mux.Vars(r)
	chatID := vars["chat_id"]
	messageID := vars["message_id"]
	if chatID == "" || messageID == "" {
		http.Error(w, "chat_id and message_id are required", http.StatusBadRequest)
		return
	}
	var req editMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	encBytes, err := base64.StdEncoding.DecodeString(req.EncryptedContent)
	if err != nil {
		http.Error(w, "Invalid base64 for encrypted_content", http.StatusBadRequest)
		return
	}
	nonceBytes, err := base64.StdEncoding.DecodeString(req.Nonce)
	if err != nil {
		http.Error(w, "Invalid base64 for nonce", http.StatusBadRequest)
		return
	}

	updatedMsg, err := h.messageService.EditMessage(
		r.Context(),
		claims.UserID,
		chatID,
		messageID,
		encBytes,
		nonceBytes,
		model.ContentType(req.ContentType),
		req.EncryptionKeyID,
	)
	if err != nil {
		h.log.Error("EditMessage failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	resp := messageResponse{
		ID:               updatedMsg.ID,
		ChatID:           updatedMsg.ChatID,
		SenderID:         updatedMsg.SenderID,
		EncryptedContent: base64.StdEncoding.EncodeToString(updatedMsg.EncryptedContent),
		Nonce:            base64.StdEncoding.EncodeToString(updatedMsg.Nonce),
		EncryptionKeyID:  updatedMsg.EncryptionKeyID,
		ContentType:      string(updatedMsg.ContentType),
		SentAt:           updatedMsg.SentAt.Format(time.RFC3339),
	}
	if updatedMsg.EditedAt != nil {
		t := updatedMsg.EditedAt.Format(time.RFC3339)
		resp.EditedAt = &t
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(resp)
}

func (h *MessageHandler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetClaimsFromContext(r.Context())

	vars := mux.Vars(r)
	chatID := vars["chat_id"]
	messageID := vars["message_id"]
	if chatID == "" || messageID == "" {
		http.Error(w, "chat_id and message_id are required", http.StatusBadRequest)
		return
	}

	if err := h.messageService.DeleteMessage(r.Context(), claims.UserID, chatID, messageID); err != nil {
		h.log.Error("DeleteMessage failed", "error", err)
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
