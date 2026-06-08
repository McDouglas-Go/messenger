package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/McDouglas-Go/messenger/internal/auth"
	"github.com/McDouglas-Go/messenger/internal/config"
	"github.com/McDouglas-Go/messenger/internal/database"
	"github.com/McDouglas-Go/messenger/internal/handlers"
	"github.com/McDouglas-Go/messenger/internal/middleware"
	"github.com/McDouglas-Go/messenger/internal/repository"
	"github.com/McDouglas-Go/messenger/internal/service"
	"github.com/gorilla/mux"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load config", "error", err)
		os.Exit(1)
	}
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := database.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}

	defer pool.Close()

	if err := database.RunMigrations(cfg.DatabaseURL); err != nil {
		logger.Error("Failed to run migrations", "error", err)
		os.Exit(1)
	}
	jwtManager := auth.NewJWTManager(cfg.JWTSecret, cfg.JWTExpiration)

	userRepo := repository.NewUserRepository(pool)
	chatRepo := repository.NewChatRepository(pool)
	msgRepo := repository.NewMessageRepository(pool)
	mediaRepo := repository.NewMediaRepository(pool)

	authService := service.NewAuthService(userRepo, jwtManager)
	chatServise := service.NewChatService(chatRepo, userRepo)
	messageService := service.NewMessageService(msgRepo, chatRepo)
	mediaService := service.NewMediaService(mediaRepo, msgRepo, chatRepo, cfg.UploadDir)

	authHandler := handlers.NewAuthHandler(authService, userRepo, logger)
	chatHandler := handlers.NewChatHandler(chatServise, logger)
	messageHandler := handlers.Newmessagehandler(messageService, logger)
	mediaHandler := handlers.NewMediahandler(mediaService, logger)

	r := mux.NewRouter()

	r.HandleFunc("/api/register", authHandler.Register).Methods("POST")
	r.HandleFunc("/api/login", authHandler.Login).Methods("POST")

	api := r.PathPrefix("/api").Subrouter()
	api.Use(middleware.AuthMiddleware(jwtManager))
	api.HandleFunc("/me", authHandler.Me).Methods("GET")
	api.HandleFunc("/me", authHandler.UpdateProfile).Methods("PUT")
	api.HandleFunc("/me", authHandler.DeleteProfile).Methods("DELETE")

	api.HandleFunc("/users", authHandler.SearchUsers).Methods("GET")
	api.HandleFunc("/chats/private", chatHandler.CreatePrivate).Methods("POST")
	api.HandleFunc("/chats/group", chatHandler.CreateGroup).Methods("POST")
	api.HandleFunc("/chats", chatHandler.GetUserChats).Methods("GET")
	api.HandleFunc("/chats/{chat_id}", chatHandler.UpdateChat).Methods("PUT")
	api.HandleFunc("/chats/{chat_id}/members", chatHandler.AddMembers).Methods("POST")
	api.HandleFunc("/chats/{chat_id}/members", chatHandler.RemoveMember).Methods("DELETE")
	api.HandleFunc("/chats/{chat_id}", chatHandler.DeleteChat).Methods("DELETE")

	api.HandleFunc("/chats/{chat_id}/messages", messageHandler.Send).Methods("POST")
	api.HandleFunc("/chats/{chat_id}/messages", messageHandler.GetChatHistory).Methods("GET")
	api.HandleFunc("/chats/{chat_id}/messages/{message_id}", messageHandler.EditMessage).Methods("PUT")
	api.HandleFunc("/chats/{chat_id}/messages/{message_id}", messageHandler.DeleteMessage).Methods("DELETE")

	api.HandleFunc("/media", mediaHandler.Upload).Methods("POST")
	api.HandleFunc("/media/{media_id}", mediaHandler.Download).Methods("GET")
	srv := &http.Server{
		Addr:         ":" + cfg.ServerPort,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  30 * time.Second,
	}

	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		logger.Info("Shutting down server...")
		cancel()
		ctxShutdown, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelShutdown()
		srv.Shutdown(ctxShutdown)
	}()

	logger.Info("Server listening", "port", cfg.ServerPort)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("Server failed", "error", err)
		os.Exit(1)
	}
	logger.Info("Server stopped")
}
