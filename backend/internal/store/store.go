package store

import (
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

type Session struct {
	ID                 string `gorm:"primaryKey"`
	Username           string `gorm:"index;not null"`
	EncryptedAccessKey string `gorm:"not null"`
	EncryptedSecretKey string `gorm:"not null"`
	ExpiresAt          time.Time `gorm:"index;not null"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type AuditLog struct {
	ID             string `gorm:"primaryKey"`
	Actor          string `gorm:"index;not null"`
	Action         string `gorm:"index;not null"`
	ResourceType   string `gorm:"index;not null"`
	ResourceID     string `gorm:"index;not null"`
	RequestSummary string `gorm:"not null"`
	Result         string `gorm:"not null"`
	SourceIP       string `gorm:"not null"`
	CreatedAt      time.Time `gorm:"index"`
}

type ConfirmationToken struct {
	ID           string `gorm:"primaryKey"`
	Token        string `gorm:"uniqueIndex;not null"`
	Actor        string `gorm:"index;not null"`
	Action       string `gorm:"index;not null"`
	ResourceType string `gorm:"index;not null"`
	ResourceID   string `gorm:"index;not null"`
	Summary      string `gorm:"not null"`
	ExpiresAt    time.Time `gorm:"index;not null"`
	UsedAt       *time.Time
	CreatedAt    time.Time
}

func Open(path string) (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(&Session{}, &AuditLog{}, &ConfirmationToken{}); err != nil {
		return nil, err
	}

	return db, nil
}
