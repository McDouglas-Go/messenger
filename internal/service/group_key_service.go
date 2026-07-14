package service

import (
	"context"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
)

type GroupService interface {
	SetKey(ctx context.Context, chatID, userID string, encryptedKey []byte, version int) error
	GetKey(ctx context.Context, chatID, userID string) (*model.GroupEncryptionKey, error)
}

type groupService struct {
	repo repository.GroupKeyRepository
}

func NewGroupService(repo repository.GroupKeyRepository) GroupService {
	return &groupService{repo: repo}
}

func (s *groupService) SetKey(ctx context.Context, chatID, userID string, encryptedKey []byte, version int) error {
	key := &model.GroupEncryptionKey{
		ChatID:                chatID,
		UserID:                userID,
		EncryptedSymmetricKey: encryptedKey,
		KeyVersion:            version,
	}
	return s.repo.SetKey(ctx, key)
}

func (s *groupService) GetKey(ctx context.Context, chatID, userID string) (*model.GroupEncryptionKey, error) {
	return s.repo.GetKey(ctx, chatID, userID)
}
