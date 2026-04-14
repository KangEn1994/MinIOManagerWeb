package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppName          string
	BindAddress      string
	BaseURL          string
	SessionTTL       time.Duration
	ConfirmationTTL  time.Duration
	RequestTimeout   time.Duration
	MasterKey        string
	DBPath           string
	FrontendDistDir  string
	MinIOEndpoint    string
	MinIOUseSSL      bool
	MinIORegion      string
	AllowOrigin      string
}

func Load() (Config, error) {
	cfg := Config{
		AppName:         getEnv("APP_NAME", "MinIO Manager Web"),
		BindAddress:     getEnv("BIND_ADDRESS", ":8080"),
		BaseURL:         strings.TrimRight(getEnv("BASE_URL", "http://localhost:8080"), "/"),
		SessionTTL:      getEnvDuration("SESSION_TTL", 8*time.Hour),
		ConfirmationTTL: getEnvDuration("CONFIRMATION_TTL", 5*time.Minute),
		RequestTimeout:  getEnvDuration("REQUEST_TIMEOUT", 15*time.Second),
		MasterKey:       getEnv("APP_MASTER_KEY", ""),
		DBPath:          getEnv("SQLITE_PATH", "./data/minio-manager.db"),
		FrontendDistDir: getEnv("FRONTEND_DIST_DIR", "../frontend/dist"),
		MinIOEndpoint:   getEnv("MINIO_ENDPOINT", ""),
		MinIOUseSSL:     getEnvBool("MINIO_USE_SSL", false),
		MinIORegion:     getEnv("MINIO_REGION", "us-east-1"),
		AllowOrigin:     getEnv("ALLOW_ORIGIN", "*"),
	}

	if cfg.MasterKey == "" {
		return cfg, fmt.Errorf("APP_MASTER_KEY is required")
	}
	if len(cfg.MasterKey) < 32 {
		return cfg, fmt.Errorf("APP_MASTER_KEY must be at least 32 characters")
	}
	if cfg.MinIOEndpoint == "" {
		return cfg, fmt.Errorf("MINIO_ENDPOINT is required")
	}

	cfg.DBPath = filepath.Clean(cfg.DBPath)
	if err := os.MkdirAll(filepath.Dir(cfg.DBPath), 0o755); err != nil {
		return cfg, fmt.Errorf("create db dir: %w", err)
	}

	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

func getEnvBool(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func getEnvDuration(key string, fallback time.Duration) time.Duration {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}
