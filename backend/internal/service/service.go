package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"minio-manager-web/backend/internal/config"
	"minio-manager-web/backend/internal/domain"
	"minio-manager-web/backend/internal/minioadmin"
	"minio-manager-web/backend/internal/security"
	"minio-manager-web/backend/internal/store"
)

var (
	ErrUnauthorized         = errors.New("unauthorized")
	ErrConfirmationRequired = errors.New("confirmation required")
	ErrUserDependencies     = errors.New("user has dependencies")
)

type Service struct {
	cfg    config.Config
	db     *gorm.DB
	cipher *security.Cipher
	minio  *minioadmin.Client
}

type SessionData struct {
	SessionID string           `json:"sessionId"`
	Username  string           `json:"username"`
	Role      domain.AdminRole `json:"role"`
	SourceIP  string           `json:"sourceIp"`
	UserAgent string           `json:"userAgent"`
	CreatedAt time.Time        `json:"createdAt"`
	ExpiresAt time.Time        `json:"expiresAt"`
}

type LoginResult struct {
	SessionData
}

type CreateAccessKeyResult struct {
	Credentials map[string]string `json:"credentials"`
}

func New(cfg config.Config, db *gorm.DB, cipher *security.Cipher) *Service {
	return &Service{
		cfg:    cfg,
		db:     db,
		cipher: cipher,
		minio:  minioadmin.New(cfg.MinIOEndpoint, cfg.MinIORegion, cfg.MinIOUseSSL),
	}
}

func (s *Service) Login(ctx context.Context, username, password, sourceIP, userAgent string) (LoginResult, error) {
	client, err := s.minio.NewSession(username, password)
	if err != nil {
		return LoginResult{}, err
	}
	if err := client.ValidateAdmin(ctx); err != nil {
		return LoginResult{}, fmt.Errorf("%w: %s", ErrUnauthorized, err.Error())
	}
	role, err := client.ResolveCurrentRole(ctx, username)
	if err != nil {
		return LoginResult{}, err
	}

	encUser, err := s.cipher.Encrypt(username)
	if err != nil {
		return LoginResult{}, err
	}
	encPass, err := s.cipher.Encrypt(password)
	if err != nil {
		return LoginResult{}, err
	}

	session := store.Session{
		ID:                 uuid.NewString(),
		Username:           username,
		Role:               string(role),
		SourceIP:           sourceIP,
		UserAgent:          userAgent,
		EncryptedAccessKey: encUser,
		EncryptedSecretKey: encPass,
		LastSeenAt:         time.Now(),
		ExpiresAt:          time.Now().Add(s.cfg.SessionTTL),
	}
	if err := s.db.Create(&session).Error; err != nil {
		return LoginResult{}, fmt.Errorf("create session: %w", err)
	}

	return LoginResult{
		SessionData: SessionData{
			SessionID: session.ID,
			Username:  session.Username,
			Role:      role,
			SourceIP:  sourceIP,
			UserAgent: userAgent,
			CreatedAt: session.CreatedAt,
			ExpiresAt: session.ExpiresAt,
		},
	}, nil
}

func (s *Service) Logout(ctx context.Context, sessionID string) error {
	return s.db.WithContext(ctx).Delete(&store.Session{}, "id = ?", sessionID).Error
}

func (s *Service) GetSession(ctx context.Context, sessionID string) (SessionData, *minioadmin.SessionClient, error) {
	var session store.Session
	if err := s.db.WithContext(ctx).First(&session, "id = ?", sessionID).Error; err != nil {
		return SessionData{}, nil, ErrUnauthorized
	}
	if session.ExpiresAt.Before(time.Now()) {
		_ = s.db.WithContext(ctx).Delete(&store.Session{}, "id = ?", sessionID).Error
		return SessionData{}, nil, ErrUnauthorized
	}
	session.LastSeenAt = time.Now()
	_ = s.db.WithContext(ctx).Model(&store.Session{}).Where("id = ?", session.ID).Update("last_seen_at", session.LastSeenAt).Error

	accessKey, err := s.cipher.Decrypt(session.EncryptedAccessKey)
	if err != nil {
		return SessionData{}, nil, err
	}
	secretKey, err := s.cipher.Decrypt(session.EncryptedSecretKey)
	if err != nil {
		return SessionData{}, nil, err
	}
	client, err := s.minio.NewSession(accessKey, secretKey)
	if err != nil {
		return SessionData{}, nil, err
	}

	return SessionData{
		SessionID: session.ID,
		Username:  session.Username,
		Role:      domain.AdminRole(session.Role),
		SourceIP:  session.SourceIP,
		UserAgent: session.UserAgent,
		CreatedAt: session.CreatedAt,
		ExpiresAt: session.ExpiresAt,
	}, client, nil
}

func (s *Service) Dashboard(ctx context.Context, client *minioadmin.SessionClient) (domain.DashboardInfo, error) {
	var auditCount int64
	if err := s.db.WithContext(ctx).Model(&store.AuditLog{}).Count(&auditCount).Error; err != nil {
		return domain.DashboardInfo{}, err
	}
	health, err := client.Health(ctx, auditCount)
	if err != nil {
		return domain.DashboardInfo{}, err
	}

	var audits []store.AuditLog
	if err := s.db.WithContext(ctx).
		Order("created_at desc").
		Limit(10).
		Find(&audits).Error; err != nil {
		return domain.DashboardInfo{}, err
	}

	return domain.DashboardInfo{
		Health:       health,
		RecentAudits: auditModelsToDomain(audits),
	}, nil
}

func (s *Service) ListBuckets(ctx context.Context, client *minioadmin.SessionClient) ([]domain.BucketInfo, error) {
	return client.ListBuckets(ctx)
}

func (s *Service) GetBucketPolicy(ctx context.Context, client *minioadmin.SessionClient, bucket string) (domain.BucketPolicy, error) {
	return client.GetBucketPolicy(ctx, bucket)
}

func (s *Service) CreateBucket(ctx context.Context, client *minioadmin.SessionClient, name string) error {
	return client.CreateBucket(ctx, name, s.cfg.MinIORegion)
}

func (s *Service) SetBucketVisibility(ctx context.Context, client *minioadmin.SessionClient, bucket string, visibility domain.BucketVisibility) error {
	switch visibility {
	case domain.BucketVisibilityPrivate, domain.BucketVisibilityPublicRead:
	case domain.BucketVisibilityCustom:
		return newAPIError("unsupported_bucket_visibility", "custom 仅用于展示已有自定义桶策略，不能直接通过此开关设置", nil)
	default:
		return newAPIError("bad_request", "不支持的桶可见性", map[string]any{"visibility": visibility})
	}
	return client.SetBucketVisibility(ctx, bucket, visibility)
}

func (s *Service) SetBucketPolicy(ctx context.Context, client *minioadmin.SessionClient, bucket, policy string) error {
	if trimmed := strings.TrimSpace(policy); trimmed != "" {
		var payload map[string]any
		if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
			return newAPIError("invalid_bucket_policy", "桶策略 JSON 无效", nil)
		}
	}
	return client.SetBucketPolicy(ctx, bucket, policy)
}

func (s *Service) DeleteBucket(ctx context.Context, actor string, client *minioadmin.SessionClient, bucket, confirmationToken string) error {
	summary := fmt.Sprintf("Delete bucket %s. Only empty buckets can be removed.", bucket)
	if safety, err := client.InspectBucketSafety(ctx, bucket); err == nil && safety.DeleteBlocked {
		summary = fmt.Sprintf("Delete bucket %s. Objects=%d, versions=%d, incomplete uploads=%d.", bucket, safety.ObjectCount, safety.VersionedEntryCount, safety.IncompleteUploadCount)
	}
	if err := s.requireConfirmation(ctx, actor, domain.ConfirmationDeleteBucket, "bucket", bucket, summary, bucket, confirmationToken); err != nil {
		return err
	}
	return client.DeleteBucket(ctx, bucket)
}

func (s *Service) ListUsers(ctx context.Context, client *minioadmin.SessionClient) ([]domain.UserSummary, error) {
	return client.ListUsers(ctx)
}

func (s *Service) GetUser(ctx context.Context, client *minioadmin.SessionClient, user string) (domain.UserSummary, error) {
	return client.GetUser(ctx, user)
}

func (s *Service) CreateUser(ctx context.Context, client *minioadmin.SessionClient, user, secret string, role domain.AdminRole) error {
	return client.CreateUser(ctx, user, secret, role)
}

func (s *Service) SetUserStatus(ctx context.Context, client *minioadmin.SessionClient, user, status string) error {
	return client.SetUserStatus(ctx, user, status)
}

func (s *Service) DeleteUser(ctx context.Context, actor string, client *minioadmin.SessionClient, user, mode, token string) error {
	deps, err := client.GetUserDependencies(ctx, user)
	if err != nil {
		return err
	}
	if mode != "force" {
		if hasDependencies(deps) {
			payload, _ := json.Marshal(deps)
			return &serviceError{
				apiError: domain.APIError{
					Code:    "user_has_dependencies",
					Message: "用户仍有关联策略、分组或 Access Key，无法安全删除",
					Details: map[string]any{"dependencies": json.RawMessage(payload)},
				},
				err: ErrUserDependencies,
			}
		}
	}

	confirmationType := domain.ConfirmationDeleteUser
	if mode == "force" {
		confirmationType = domain.ConfirmationForceDeleteUser
	}
	if err := s.requireConfirmation(ctx, actor, confirmationType, "user", user, fmt.Sprintf("Delete user %s with mode %s.", user, mode), user, token); err != nil {
		return err
	}

	if mode == "force" {
		if err := client.ClearUserDependencies(ctx, user); err != nil {
			return err
		}
	}
	return client.DeleteUser(ctx, user)
}

func (s *Service) ListGroups(ctx context.Context, client *minioadmin.SessionClient) ([]domain.GroupSummary, error) {
	return client.ListGroups(ctx)
}

func (s *Service) CreateGroup(ctx context.Context, client *minioadmin.SessionClient, name string) error {
	return client.CreateGroup(ctx, name)
}

func (s *Service) DeleteGroup(ctx context.Context, client *minioadmin.SessionClient, name string) error {
	return client.DeleteGroup(ctx, name)
}

func (s *Service) UpdateGroupMembers(ctx context.Context, client *minioadmin.SessionClient, group string, members []string) error {
	return client.UpdateGroupMembers(ctx, group, members)
}

func (s *Service) UpdateUserPermissions(ctx context.Context, actor string, client *minioadmin.SessionClient, user string, permissions map[string]domain.PermissionTemplate, token string) error {
	if err := s.requireConfirmation(ctx, actor, domain.ConfirmationOverwritePermissions, "user", user, "Overwrite user bucket permissions.", user, token); err != nil {
		return err
	}
	return client.ApplyUserBucketPermissions(ctx, user, permissions)
}

func (s *Service) UpdateGroupPermissions(ctx context.Context, actor string, client *minioadmin.SessionClient, group string, permissions map[string]domain.PermissionTemplate, token string) error {
	if err := s.requireConfirmation(ctx, actor, domain.ConfirmationOverwritePermissions, "group", group, "Overwrite group bucket permissions.", group, token); err != nil {
		return err
	}
	return client.ApplyGroupBucketPermissions(ctx, group, permissions)
}

func (s *Service) ListAccessKeys(ctx context.Context, client *minioadmin.SessionClient, user string) ([]domain.AccessKeySummary, error) {
	return client.ListAccessKeys(ctx, user)
}

func (s *Service) CreateAccessKey(ctx context.Context, client *minioadmin.SessionClient, user, name, description string) (CreateAccessKeyResult, error) {
	creds, err := client.CreateAccessKey(ctx, user, name, description, nil)
	if err != nil {
		return CreateAccessKeyResult{}, err
	}
	return CreateAccessKeyResult{
		Credentials: map[string]string{
			"accessKey": creds.AccessKey,
			"secretKey": creds.SecretKey,
		},
	}, nil
}

func (s *Service) SetAccessKeyStatus(ctx context.Context, client *minioadmin.SessionClient, accessKey, status string) error {
	return client.SetAccessKeyStatus(ctx, accessKey, status)
}

func (s *Service) DeleteAccessKey(ctx context.Context, actor string, client *minioadmin.SessionClient, accessKey, token string) error {
	if err := s.requireConfirmation(ctx, actor, domain.ConfirmationDeleteAccessKey, "access_key", accessKey, fmt.Sprintf("Delete access key %s.", accessKey), accessKey, token); err != nil {
		return err
	}
	return client.DeleteAccessKey(ctx, accessKey)
}

func (s *Service) RecordAudit(ctx context.Context, actor, action, resourceType, resourceID, requestSummary, result, sourceIP string) error {
	entry := store.AuditLog{
		ID:             uuid.NewString(),
		Actor:          actor,
		Action:         action,
		ResourceType:   resourceType,
		ResourceID:     resourceID,
		RequestSummary: requestSummary,
		Result:         result,
		SourceIP:       sourceIP,
		CreatedAt:      time.Now().UTC(),
	}
	return s.db.WithContext(ctx).Create(&entry).Error
}

func (s *Service) requireConfirmation(ctx context.Context, actor string, action domain.ConfirmationType, resourceType, resourceID, summary, expected, token string) error {
	if token != "" {
		var record store.ConfirmationToken
		if err := s.db.WithContext(ctx).First(&record, "token = ?", token).Error; err != nil {
			return newAPIError("invalid_confirmation_token", "确认令牌无效或已过期", nil)
		}
		if record.Actor != actor || record.Action != string(action) || record.ResourceID != resourceID || record.ResourceType != resourceType {
			return newAPIError("invalid_confirmation_token", "确认令牌与当前操作不匹配", nil)
		}
		if record.UsedAt != nil || record.ExpiresAt.Before(time.Now()) {
			return newAPIError("invalid_confirmation_token", "确认令牌无效或已过期", nil)
		}
		now := time.Now().UTC()
		record.UsedAt = &now
		return s.db.WithContext(ctx).Save(&record).Error
	}

	record := store.ConfirmationToken{
		ID:           uuid.NewString(),
		Token:        uuid.NewString(),
		Actor:        actor,
		Action:       string(action),
		ResourceType: resourceType,
		ResourceID:   resourceID,
		Summary:      summary,
		Prompt:       fmt.Sprintf("请输入 %s 以确认继续", expected),
		Expected:     expected,
		ExpiresAt:    time.Now().Add(s.cfg.ConfirmationTTL),
	}
	if err := s.db.WithContext(ctx).Create(&record).Error; err != nil {
		return err
	}

	return &serviceError{
		apiError: domain.APIError{
			Code:    "confirmation_required",
			Message: "该操作需要二次确认",
			ConfirmationRequest: &domain.ConfirmationChallenge{
				Token:     record.Token,
				Action:    record.Action,
				Resource:  record.ResourceID,
				Summary:   record.Summary,
				Prompt:    record.Prompt,
				Expected:  record.Expected,
				ExpiresAt: record.ExpiresAt,
			},
		},
		err: ErrConfirmationRequired,
	}
}

type serviceError struct {
	apiError domain.APIError
	err      error
}

func (e *serviceError) Error() string {
	return e.apiError.Message
}

func (e *serviceError) Unwrap() error {
	return e.err
}

func (e *serviceError) APIError() domain.APIError {
	return e.apiError
}

func newAPIError(code, message string, details map[string]any) error {
	return &serviceError{
		apiError: domain.APIError{
			Code:    code,
			Message: message,
			Details: details,
		},
		err: errors.New(message),
	}
}

func hasDependencies(deps domain.UserDependencyDetails) bool {
	return len(deps.MemberOf) > 0 || len(deps.ServiceKeys) > 0 || len(deps.DirectPolicies) > 0
}

func auditModelsToDomain(in []store.AuditLog) []domain.AuditEntry {
	out := make([]domain.AuditEntry, 0, len(in))
	for _, item := range in {
		out = append(out, domain.AuditEntry{
			ID:             item.ID,
			Actor:          item.Actor,
			Action:         item.Action,
			ResourceType:   item.ResourceType,
			ResourceID:     item.ResourceID,
			RequestSummary: item.RequestSummary,
			Result:         item.Result,
			SourceIP:       item.SourceIP,
			CreatedAt:      item.CreatedAt,
		})
	}
	return out
}

func IsAPIError(err error) (domain.APIError, bool) {
	var serr *serviceError
	if errors.As(err, &serr) {
		return serr.APIError(), true
	}
	return domain.APIError{}, false
}

func NormalizeMinIOError(err error) error {
	if err == nil {
		return nil
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "Access Denied"):
		return newAPIError("permission_denied", "权限不足", nil)
	case strings.Contains(msg, "NoSuchBucket"):
		return newAPIError("bucket_not_found", "桶不存在", nil)
	case strings.Contains(strings.ToLower(msg), "not empty"):
		return newAPIError("bucket_not_empty", "桶不是空桶，无法删除", nil)
	default:
		return err
	}
}
