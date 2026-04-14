package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
)

type Cipher struct {
	gcm cipher.AEAD
}

func NewCipher(secret string) (*Cipher, error) {
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}
	return &Cipher{gcm: gcm}, nil
}

func (c *Cipher) Encrypt(plain string) (string, error) {
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("read nonce: %w", err)
	}
	encrypted := c.gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(encrypted), nil
}

func (c *Cipher) Decrypt(payload string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return "", fmt.Errorf("decode secret: %w", err)
	}
	nonceSize := c.gcm.NonceSize()
	if len(raw) < nonceSize {
		return "", fmt.Errorf("invalid payload")
	}
	nonce := raw[:nonceSize]
	cipherText := raw[nonceSize:]
	plain, err := c.gcm.Open(nil, nonce, cipherText, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt secret: %w", err)
	}
	return string(plain), nil
}
