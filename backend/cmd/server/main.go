package main

import (
	"log"

	"minio-manager-web/backend/internal/config"
	"minio-manager-web/backend/internal/httpapi"
	"minio-manager-web/backend/internal/security"
	"minio-manager-web/backend/internal/service"
	"minio-manager-web/backend/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open store: %v", err)
	}

	cipher, err := security.NewCipher(cfg.MasterKey)
	if err != nil {
		log.Fatalf("init cipher: %v", err)
	}

	svc := service.New(cfg, db, cipher)
	handler := httpapi.NewHandler(cfg, svc)

	log.Printf("starting %s on %s", cfg.AppName, cfg.BindAddress)
	if err := handler.Router().Run(cfg.BindAddress); err != nil {
		log.Fatalf("run server: %v", err)
	}
}
