package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"

	"github.com/McDouglas-Go/messenger/internal/model"
	"github.com/McDouglas-Go/messenger/internal/repository"
)

type MediaService interface {
	Upload(
		ctx context.Context,
		file multipart.File,
		header *multipart.FileHeader,
		messageID *string,
		userID *string,
		mimeType string,
	) (*model.Media, error)
	Get(ctx context.Context, id, userID string) (*model.Media, error)
}

type mediaService struct {
	mediaRepo repository.MediaRepository
	msgRepo   repository.MessageRepository
	chatRepo  repository.ChatRepository
	uploadDir string
}

func NewMediaService(
	mediaRepo repository.MediaRepository,
	msgRepo repository.MessageRepository,
	chatRepo repository.ChatRepository,
	uploadDir string,
) MediaService {
	os.MkdirAll(uploadDir, 0755)
	return &mediaService{
		mediaRepo: mediaRepo,
		msgRepo:   msgRepo,
		chatRepo:  chatRepo,
		uploadDir: uploadDir,
	}
}

func (s *mediaService) Upload(
	ctx context.Context,
	file multipart.File,
	header *multipart.FileHeader,
	messageID *string,
	userId *string,
	mimeType string,
) (*model.Media, error) {
	randBytes := make([]byte, 16)
	if _, err := rand.Read(randBytes); err != nil {
		return nil, fmt.Errorf("generate random name: %w", err)
	}
	name := hex.EncodeToString(randBytes)
	destPath := filepath.Join(s.uploadDir, name)

	destFile, err := os.Create(destPath)
	if err != nil {
		return nil, fmt.Errorf("create file: %w", err)
	}
	defer destFile.Close()

	size, err := io.Copy(destFile, file)
	if err != nil {
		return nil, fmt.Errorf("write file: %w", err)
	}

	mime := mimeType
	if mime == "" {
		mime = header.Header.Get("Content-Type")
	}
	if mime == "" {
		mime = "application/octet-stream"
	}

	m := &model.Media{
		MessageID: messageID,
		UserID:    userId,
		FilePath:  destPath,
		MimeType:  mime,
		SizeBytes: size,
	}

	if err := s.mediaRepo.Create(ctx, m); err != nil {
		os.Remove(destPath)
		return nil, fmt.Errorf("save media record: %w", err)
	}

	return m, nil
}

func (s *mediaService) Get(ctx context.Context, id, userID string) (*model.Media, error) {
	media, err := s.mediaRepo.GetByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if media == nil {
		return nil, errors.New("media not found")
	}

	if media.MessageID != nil {
		msg, err := s.msgRepo.GetByID(ctx, *media.MessageID)
		if err != nil || msg == nil {
			return nil, errors.New("message not found")
		}
		members, err := s.chatRepo.GetChatMembers(ctx, msg.ChatID)
		if err != nil {
			return nil, fmt.Errorf("failed to check chat membership: %w", err)
		}
		isMember := false
		for _, m := range members {
			if m.UserID == userID {
				isMember = true
				break
			}
		}
		if !isMember {
			return nil, errors.New("access denied")
		}
	}

	return media, nil
}
