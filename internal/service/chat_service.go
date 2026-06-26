package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
)

type ChatWithInfo struct {
	Chat        *model.Chat             `json:"chat"`
	OtherUser   *UserInfo               `json:"other_user,omitempty"`
	LastMessage *model.EncryptedMessage `json:"last_message,omitempty"`
}

type UserInfo struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
}

type ChatDetail struct {
	Chat        *model.Chat   `json:"chat"`
	Members     []*MemberInfo `json:"members"`
	CurrentRole string        `json:"current_role"`
}

type MemberInfo struct {
	UserID      string `json:"user_id"`
	UserName    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	JoinetAt    string `json:"joined_at"`
}

type ChatService interface {
	CreatePrivate(ctx context.Context, userID1, userID2 string) (*model.Chat, error)
	CreateGroup(ctx context.Context, name, creatorID string, memberIDs []string) (*model.Chat, error)
	GetUserChats(ctx context.Context, userID string) ([]*ChatWithInfo, error)
	GetChatWithMembers(ctx context.Context, chatID, userID string) (*ChatDetail, error)
	UpdateChat(ctx context.Context, userID, chatID string, name *string) (*model.Chat, error)
	AddMembers(ctx context.Context, userID, chatID string, memberIDs []string) error
	RemoveMember(ctx context.Context, userID, chatID, targetUserID string) error
	DeleteChat(ctx context.Context, userID, chatID string) error
}

type chatService struct {
	chatRepo repository.ChatRepository
	userRepo repository.UserRepository
	msgRepo  repository.MessageRepository
}

func NewChatService(chatRepo repository.ChatRepository, userRepo repository.UserRepository, msgRepo repository.MessageRepository) ChatService {
	return &chatService{chatRepo: chatRepo, userRepo: userRepo, msgRepo: msgRepo}
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

func (s *chatService) GetUserChats(ctx context.Context, userID string) ([]*ChatWithInfo, error) {
	chats, err := s.chatRepo.GetUserchats(ctx, userID)
	if err != nil {
		return nil, err
	}
	var result []*ChatWithInfo
	for _, chat := range chats {
		cwi := &ChatWithInfo{Chat: chat}
		lastMsg, err := s.msgRepo.GetLastMessage(ctx, chat.ID)
		if err == nil && lastMsg != nil {
			cwi.LastMessage = lastMsg
		}
		if chat.Type == model.ChatTypePrivate {
			members, err := s.chatRepo.GetChatMembers(ctx, chat.ID)
			if err == nil {
				for _, m := range members {
					if m.UserID != userID {
						otherUser, err := s.userRepo.GetByID(ctx, m.UserID)
						if err == nil && otherUser != nil {
							cwi.OtherUser = &UserInfo{
								ID:          otherUser.ID,
								Username:    otherUser.Username,
								DisplayName: otherUser.DisplayName,
							}
						}
						break
					}
				}
			}
		}
		result = append(result, cwi)
	}
	return result, nil
}

func (s *chatService) GetChatWithMembers(ctx context.Context, chatID, userID string) (*ChatDetail, error) {
	chat, err := s.chatRepo.GetByID(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("get chat: %w", err)
	}
	if chat == nil {
		return nil, errors.New("chat not found")
	}
	members, err := s.chatRepo.GetChatMembers(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("get members: %w", err)
	}
	memberInfos := make([]*MemberInfo, 0, len(members))
	currentRole := ""

	for _, m := range members {
		user, err := s.userRepo.GetByID(ctx, m.UserID)
		if err != nil {
			return nil, fmt.Errorf("get user %s: %w", m.UserID, err)
		}
		if user == nil {
			continue
		}
		if m.UserID == userID {
			currentRole = string(m.Role)
		}
		memberInfos = append(memberInfos, &MemberInfo{
			UserID:      m.UserID,
			UserName:    user.Username,
			DisplayName: user.DisplayName,
			Role:        string(m.Role),
			JoinetAt:    m.JoinedAt.Format("2006-01-02T15:04:05Z"),
		})
	}
	return &ChatDetail{
		Chat:        chat,
		Members:     memberInfos,
		CurrentRole: currentRole,
	}, nil
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

func (s *chatService) UpdateChat(ctx context.Context, userID, chatID string, name *string) (*model.Chat, error) {
	chat, err := s.chatRepo.GetByID(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("get chat: %w", err)
	}
	if chat == nil {
		return nil, fmt.Errorf("chat not found")
	}
	if chat.Type != model.ChatTypeGroup {
		return nil, errors.New("cannot update name of a private chat")
	}

	member, err := s.chatRepo.GetMember(ctx, chatID, userID)
	if err != nil {
		return nil, fmt.Errorf("get member: %w", err)
	}
	if member == nil || (member.Role != model.RoleOwner && member.Role != model.RoleAdmin) {
		return nil, errors.New("only owner or admin can update chat")
	}
	if name != nil {
		if strings.TrimSpace(*name) == "" {
			return nil, errors.New("group name cannot be empty")
		}
		chat.Name = name
	}
	if err := s.chatRepo.Update(ctx, chat); err != nil {
		return nil, fmt.Errorf("update chat: %w", err)
	}

	return chat, nil
}

func (s *chatService) AddMembers(ctx context.Context, userID, chatID string, memberIDs []string) error {
	chat, err := s.chatRepo.GetByID(ctx, chatID)
	if err != nil {
		return fmt.Errorf("get chat: %w", err)
	}
	if chat == nil {
		return errors.New("chat not found")
	}
	if chat.Type != model.ChatTypeGroup {
		return errors.New("cannot add members to a private chat")
	}

	member, err := s.chatRepo.GetMember(ctx, chatID, userID)
	if err != nil {
		return fmt.Errorf("get member: %w", err)
	}
	if member == nil || (member.Role != model.RoleOwner && member.Role != model.RoleAdmin) {
		return errors.New("only owner or admin can add members")
	}

	for _, id := range memberIDs {
		if _, err := s.getExistingUser(ctx, id); err != nil {
			return err
		}

		existing, _ := s.chatRepo.GetMember(ctx, chatID, id)
		if existing != nil {
			continue
		}
		if err := s.chatRepo.AddMember(ctx, chatID, id, model.RoleMember); err != nil {
			return fmt.Errorf("add member %s: %w", id, err)
		}
	}

	return nil
}

func (s *chatService) RemoveMember(ctx context.Context, userID, chatID, targetUserID string) error {
	chat, err := s.chatRepo.GetByID(ctx, chatID)
	if err != nil {
		return fmt.Errorf("get chat: %w", err)
	}
	if chat == nil {
		return errors.New("chat not found")
	}

	requester, err := s.chatRepo.GetMember(ctx, chatID, userID)
	if err != nil {
		return fmt.Errorf("get requester: %w", err)
	}
	if requester == nil {
		return errors.New("you are not a member of this chat")
	}

	if userID == targetUserID {
		if userID == chat.CreatedBy && chat.Type == model.ChatTypeGroup {
			return errors.New("owner cannot leave the group; transfer ownership or delete the chat")
		} else {
			if requester.Role != model.RoleOwner && requester.Role != model.RoleAdmin {
				return errors.New("only owner or admin can remove members")
			}
			if targetUserID == chat.CreatedBy {
				return errors.New("cannot remove the owner")
			}
		}
	}
	target, err := s.chatRepo.GetMember(ctx, chatID, targetUserID)
	if err != nil {
		return fmt.Errorf("get target: %w", err)
	}
	if target == nil {
		return errors.New("user is not a member of this chat")
	}

	return s.chatRepo.RemoveMember(ctx, chatID, targetUserID)
}

func (s *chatService) DeleteChat(ctx context.Context, userID, chatID string) error {
	chat, err := s.chatRepo.GetByID(ctx, chatID)
	if err != nil {
		return fmt.Errorf("get chat: %w", err)
	}
	if chat == nil {
		return errors.New("chat not found")
	}
	if chat.Type != model.ChatTypePrivate {
		if chat.CreatedBy != userID {
			return errors.New("only the owner can delete the chat")
		}
	}
	return s.chatRepo.Delete(ctx, chatID)
}
