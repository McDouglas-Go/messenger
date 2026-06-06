package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
)

type ChatService interface {
	CreatePrivate(ctx context.Context, userID1, userID2 string) (*model.Chat, error)
	CreateGroup(ctx context.Context, name, creatorID string, memberIDs []string) (*model.Chat, error)
	GetUserChats(ctx context.Context, userID string) ([]*model.Chat, error)
}

type chatService struct {
	chatRepo repository.ChatRepository
	userRepo repository.UserRepository
}

func NewChatService(chatRepo repository.ChatRepository, userRepo repository.UserRepository) ChatService {
	return &chatService{chatRepo: chatRepo, userRepo: userRepo}
}

func (s *chatService) CreatePrivate(ctx context.Context, userID1, userID2 string) (*model.Chat, error) {
	if userID1 == userID2 {
		return nil, errors.New("cannot create private chat with yourself")
	}

	if _, err := s.getExistingUser(ctx, userID1); err != nil {
		return nil, err
	}
	if _, err := s.getExistingUser(ctx, userID2); err != nil {
		return nil, err
	}

	existing, err := s.findExistingPrivateChat(ctx, userID1, userID2)
	if err != nil {
		return nil, fmt.Errorf("check existing private chat: %w", err)
	}
	if existing != nil {
		return existing, nil
	}
	chat := &model.Chat{
		Type: model.ChatTypePrivate,
		Name: nil,
	}
	if err := s.chatRepo.Create(ctx, chat, userID1); err != nil {
		return nil, fmt.Errorf("create chat: %w", err)
	}

	if err := s.chatRepo.AddMember(ctx, chat.ID, userID2, model.RoleMember); err != nil {
		return nil, fmt.Errorf("add second user: %w", err)
	}

	return chat, nil
}

func (s *chatService) CreateGroup(ctx context.Context, name, creatorID string, memberIDs []string) (*model.Chat, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("group name is required")
	}

	if _, err := s.getExistingUser(ctx, creatorID); err != nil {
		return nil, err
	}

	uniqueMembers := make(map[string]bool)
	for _, id := range memberIDs {
		if id == creatorID {
			continue
		}
		if _, err := s.getExistingUser(ctx, id); err != nil {
			return nil, err
		}
		uniqueMembers[id] = true
	}

	chat := &model.Chat{
		Type: model.ChatTypeGroup,
		Name: &name,
	}
	if err := s.chatRepo.Create(ctx, chat, creatorID); err != nil {
		return nil, fmt.Errorf("create group: %w", err)
	}
	for id := range uniqueMembers {
		if err := s.chatRepo.AddMember(ctx, chat.ID, id, model.RoleMember); err != nil {
			return nil, fmt.Errorf("add member %s: %w", id, err)
		}
	}

	return chat, nil
}

func (s *chatService) GetUserChats(ctx context.Context, userID string) ([]*model.Chat, error) {
	if _, err := s.getExistingUser(ctx, userID); err != nil {
		return nil, err
	}

	return s.chatRepo.GetUserchats(ctx, userID)
}

func (s *chatService) getExistingUser(ctx context.Context, userID string) (*model.User, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("get user %s: %w", userID, err)
	}
	if user == nil {
		return nil, fmt.Errorf("user %s not found", userID)
	}
	return user, nil
}

func (s *chatService) findExistingPrivateChat(ctx context.Context, userID1, userID2 string) (*model.Chat, error) {
	chats, err := s.chatRepo.GetUserchats(ctx, userID1)
	if err != nil {
		return nil, err
	}
	for _, chat := range chats {
		if chat.Type == model.ChatTypePrivate {
			members, err := s.chatRepo.GetChatMembers(ctx, chat.ID)
			if err != nil {
				return nil, err
			}
			for _, m := range members {
				if m.UserID == userID2 {
					return chat, nil
				}
			}
		}
	}
	return nil, nil
}
