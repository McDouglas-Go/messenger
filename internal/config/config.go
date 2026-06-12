package config

import (
	"fmt"
	"os"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL     string
	ServerPort      string
	JWTSecret       string
	JWTExpiration   time.Duration
	UploadDir       string
	BaseURL         string
	RefreshTokenTTL time.Duration
	StaticDir       string
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	expStr := getEnv("JWT_EXPIRATION", "15m")
	exp, err := time.ParseDuration(expStr)
	if err != nil {
		return nil, fmt.Errorf("invalid JWT_EXPIRATION: %w", err)
	}
	refreshTTL, _ := time.ParseDuration(getEnv("REFRESH_TOKEN_TTL", "720h"))

	cfg := &Config{
		DatabaseURL:     getEnv("DATABASE_URL", "postgres://postgres:password@localhost:5432/messenger?sslmode=disable"),
		ServerPort:      getEnv("SERVER_PORT", "8080"),
		JWTSecret:       getEnv("JWT_SECRET", "change-me-in-production"),
		JWTExpiration:   exp,
		UploadDir:       getEnv("UPLOAD_DIR", "./uploads"),
		BaseURL:         getEnv("BASE_URL", "http://localhost:8080"),
		RefreshTokenTTL: refreshTTL,
		StaticDir:       getEnv("STATIC_DIR", "./web"),
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
