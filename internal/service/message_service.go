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
