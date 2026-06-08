package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
)

type MesssageService interface {
	Send(ctx context.Context, senderID string, msg *model.EncryptedMessage) (*model.EncryptedMessage, error)
	GetChatHistory(ctx context.Context, chatID, userID string, limit, offset int) ([]*model.EncryptedMessage, error)
	EditMessage(ctx context.Context,
		userID, chatID, messageID string,
		encryptedContent, nonce []byte,
		contentType model.ContentType,
		encryptionKeyID *string,
	) (*model.EncryptedMessage, error)
	DeleteMessage(ctx context.Context, userID, chatID, messageID string) error
}

type messageService struct {
	msgRepo  repository.MessageRepository
	chatRepo repository.ChatRepository
}

func NewMessageService(msgRepo repository.MessageRepository, chatRepo repository.ChatRepository) MesssageService {
	return &messageService{
		msgRepo:  msgRepo,
		chatRepo: chatRepo,
	}
}

func (s *messageService) Send(ctx context.Context, senderID string, msg *model.EncryptedMessage) (*model.EncryptedMessage, error) {
	members, err := s.chatRepo.GetChatMembers(ctx, msg.ChatID)
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

	msg.SenderID = senderID

	if err := s.msgRepo.Create(ctx, msg); err != nil {
		return nil, fmt.Errorf("create message: %w", err)
	}
	return msg, nil
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

func (s *messageService) EditMessage(ctx context.Context,
	userID, chatID, messageID string,
	encryptedContent, nonce []byte,
	contentType model.ContentType,
	encryptionKeyID *string,
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
	msg.EncryptionKeyID = encryptionKeyID

	if err := s.msgRepo.Update(ctx, msg); err != nil {
		return nil, fmt.Errorf("update message: %w", err)
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

	if msg.SenderID == userID {
		return s.msgRepo.Delete(ctx, messageID)
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

	return s.msgRepo.Delete(ctx, messageID)
}
