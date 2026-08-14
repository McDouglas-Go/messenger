package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
	"github.com/McDouglas-Go/messenger/internal/ws"
)

type SendMessageInput struct {
	ChatID           string
	EncryptedContent []byte
	Nonce            []byte
	ContentType      model.ContentType
	ReplyToID        *string
	ReplyPreview     *string
	ReplySenderName  *string
}

type MesssageService interface {
	Send(ctx context.Context, senderID string, input SendMessageInput) (*model.EncryptedMessage, error)
	GetByID(ctx context.Context, messageID, userID, chatID string) (*model.EncryptedMessage, error)
	GetChatHistory(ctx context.Context, chatID, userID string, limit, offset int) ([]*model.EncryptedMessage, error)
	MarkDelivered(ctx context.Context, messageID string) error
	MarkAsRead(ctx context.Context, messageID string) error
	EditMessage(ctx context.Context,
		userID, chatID, messageID string,
		encryptedContent, nonce []byte,
		contentType model.ContentType,
	) (*model.EncryptedMessage, error)
	DeleteMessage(ctx context.Context, userID, chatID, messageID string) error
}

type messageService struct {
	msgRepo   repository.MessageRepository
	mediaRepo repository.MediaRepository
	chatRepo  repository.ChatRepository
	hub       *ws.Hub
	logger    *slog.Logger
}

func NewMessageService(
	msgRepo repository.MessageRepository,
	chatRepo repository.ChatRepository,
	mediaRepo repository.MediaRepository,
	hub *ws.Hub, logger *slog.Logger,
) MesssageService {
	return &messageService{
		msgRepo:   msgRepo,
		chatRepo:  chatRepo,
		mediaRepo: mediaRepo,
		hub:       hub,
		logger:    logger,
	}
}

func (s *messageService) Send(ctx context.Context, senderID string, input SendMessageInput) (*model.EncryptedMessage, error) {
	members, err := s.chatRepo.GetChatMembers(ctx, input.ChatID)
	if err != nil {
		return nil, fmt.Errorf("get chat members: %w", err)
	}

	isMember := false
	for _, m := range members {
		if m.UserID == senderID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, errors.New("sender is not a member of the chat")
	}

	msg := &model.EncryptedMessage{
		ChatID:           input.ChatID,
		SenderID:         senderID,
		EncryptedContent: input.EncryptedContent,
		Nonce:            input.Nonce,
		ContentType:      input.ContentType,
		ReplyToID:        input.ReplyToID,
		Status:           model.StatusSent,
	}

	if err := s.msgRepo.Create(ctx, msg); err != nil {
		return nil, fmt.Errorf("create message: %w", err)
	}

	wsMsg := map[string]interface{}{
		"event": "new_message",
		"data": map[string]interface{}{
			"id":                msg.ID,
			"chat_id":           msg.ChatID,
			"sender_id":         msg.SenderID,
			"encrypted_content": base64.StdEncoding.EncodeToString(msg.EncryptedContent),
			"nonce":             base64.StdEncoding.EncodeToString(msg.Nonce),
			"content_type":      string(msg.ContentType),
			"status":            string(msg.Status),
			"sent_at":           msg.SentAt.Format(time.RFC3339),
			"reply_to_id":       msg.ReplyToID,
			"reply_preview":     input.ReplyPreview,
			"reply_sender_name": input.ReplySenderName,
		},
	}

	for _, member := range members {
		s.hub.SendToUser(member.UserID, wsMsg)
	}

	return msg, nil
}

func (s *messageService) GetByID(ctx context.Context, messageID, userID, chatID string) (*model.EncryptedMessage, error) {
	members, err := s.chatRepo.GetChatMembers(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("Get chat members: %w", err)
	}
	isMember := false
	for _, member := range members {
		if member.UserID == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, errors.New("reader is not a member of the chat")
	}
	message, err := s.msgRepo.GetByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("Get message: %w", err)
	}

	return message, nil
}

func (s *messageService) GetChatHistory(ctx context.Context, chatID, userID string, limit, offset int) ([]*model.EncryptedMessage, error) {
	members, err := s.chatRepo.GetChatMembers(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("get chat members: %w", err)
	}
	isMember := false
	for _, m := range members {
		if m.UserID == userID {
			isMember = true
			break
		}
	}
	if !isMember {
		return nil, errors.New("user is not a member of the chat")
	}

	return s.msgRepo.GetChatMessages(ctx, chatID, limit, offset)
}

func (s *messageService) MarkDelivered(ctx context.Context, messageID string) error {
	msg, err := s.msgRepo.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("get message: %w", err)
	}
	if msg == nil {
		return fmt.Errorf("message not found")
	}
	if err := s.msgRepo.UpdateStatus(ctx, messageID, model.StatusDelivered); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	event := map[string]interface{}{
		"event": "message_delivered",
		"data": map[string]string{
			"message_id": messageID,
			"chat_id":    msg.ChatID,
		},
	}
	s.hub.SendToUser(msg.SenderID, event)
	return nil
}

func (s *messageService) MarkAsRead(ctx context.Context, messageID string) error {
	msg, err := s.msgRepo.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("get message: %w", err)
	}
	if msg == nil {
		return fmt.Errorf("message not found")
	}
	if err := s.msgRepo.UpdateStatus(ctx, messageID, model.StatusRead); err != nil {
		return fmt.Errorf("update status: %w", err)
	}

	event := map[string]interface{}{
		"event": "messages_read",
		"data": map[string]string{
			"message_id": messageID,
			"chat_id":    msg.ChatID,
		},
	}
	s.hub.SendToUser(msg.SenderID, event)
	return nil
}

func (s *messageService) EditMessage(ctx context.Context,
	userID, chatID, messageID string,
	encryptedContent, nonce []byte,
	contentType model.ContentType,
) (*model.EncryptedMessage, error) {
	msg, err := s.msgRepo.GetByID(ctx, messageID)
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	if msg == nil {
		return nil, errors.New("message not found")
	}

	if msg.ChatID != chatID {
		return nil, errors.New("message does not belong to this chat")
	}
	if msg.SenderID != userID {
		return nil, errors.New("only the sender can edit the message")
	}

	msg.EncryptedContent = encryptedContent
	msg.Nonce = nonce
	msg.ContentType = contentType

	if err := s.msgRepo.Update(ctx, msg); err != nil {
		return nil, fmt.Errorf("update message: %w", err)
	}

	members, err := s.chatRepo.GetChatMembers(ctx, chatID)
	if err != nil {
		s.logger.Error("failed to get chat members for edit broadcast", "error", err, "chat_id", chatID)
	} else {
		event := map[string]interface{}{
			"event": "message_updated",
			"data":  msg,
		}
		for _, member := range members {
			s.hub.SendToUser(member.UserID, event)
		}
	}

	return msg, nil
}

func (s *messageService) DeleteMessage(ctx context.Context, userID, chatID, messageID string) error {
	msg, err := s.msgRepo.GetByID(ctx, messageID)
	if err != nil {
		return fmt.Errorf("get message: %w", err)
	}
	if msg == nil {
		return errors.New("message not found")
	}
	if msg.ChatID != chatID {
		return errors.New("message does not belong to this chat")
	}

	user, err := s.chatRepo.GetMember(ctx, chatID, userID)
	if err != nil {
		return fmt.Errorf("get user of chat: %w", err)
	}
	if user == nil {
		return fmt.Errorf("user not found: %w", err)
	}
	if msg.SenderID != userID && user.Role != model.RoleAdmin && user.Role != model.RoleOwner {
		return errors.New("only the sender or admin of group can delete the message")
	}

	if err := s.msgRepo.Delete(ctx, messageID); err != nil {
		return err
	}

	members, err := s.chatRepo.GetChatMembers(ctx, chatID)
	if err != nil {
		s.logger.Error("failed to get chat members for delete broadcast", "error", err, "chat_id", chatID)
	} else {
		event := map[string]interface{}{
			"event": "message_deleted",
			"data": map[string]string{
				"message_id": messageID,
				"chat_id":    chatID,
			},
		}
		for _, member := range members {
			s.hub.SendToUser(member.UserID, event)
		}
	}
	return nil
}
