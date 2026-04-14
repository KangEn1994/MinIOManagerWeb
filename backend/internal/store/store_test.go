package store

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestOpenMigratesLegacySQLiteSchema(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy.db")

	legacyDB, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}

	legacySchema := `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  encrypted_access_key TEXT NOT NULL,
  encrypted_secret_key TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME,
  updated_at DATETIME
);`
	if err := legacyDB.Exec(legacySchema).Error; err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}

	db, err := Open(dbPath)
	if err != nil {
		t.Fatalf("open migrated db: %v", err)
	}

	for _, column := range []string{"role", "source_ip", "user_agent", "last_seen_at"} {
		if !db.Migrator().HasColumn(&Session{}, column) {
			t.Fatalf("expected migrated sessions column %q to exist", column)
		}
	}

	for _, column := range []string{"prompt", "expected"} {
		if !db.Migrator().HasColumn(&ConfirmationToken{}, column) {
			t.Fatalf("expected confirmation_tokens column %q to exist", column)
		}
	}
}
