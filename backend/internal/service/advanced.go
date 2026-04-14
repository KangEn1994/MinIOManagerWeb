package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"minio-manager-web/backend/internal/domain"
	"minio-manager-web/backend/internal/minioadmin"
	"minio-manager-web/backend/internal/store"
)

type AuditFilter struct {
	Actor        string
	Action       string
	ResourceType string
	Result       string
	Query        string
	From         *time.Time
	To           *time.Time
	Limit        int
}

func (s *Service) ListAudits(ctx context.Context, filter AuditFilter) ([]domain.AuditEntry, error) {
	limit := filter.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	query := s.db.WithContext(ctx).Model(&store.AuditLog{}).Order("created_at desc").Limit(limit)
	if filter.Actor != "" {
		query = query.Where("actor = ?", filter.Actor)
	}
	if filter.Action != "" {
		query = query.Where("action = ?", filter.Action)
	}
	if filter.ResourceType != "" {
		query = query.Where("resource_type = ?", filter.ResourceType)
	}
	if filter.Result != "" {
		query = query.Where("result LIKE ?", filter.Result+"%")
	}
	if filter.Query != "" {
		like := "%" + filter.Query + "%"
		query = query.Where(
			"actor LIKE ? OR action LIKE ? OR resource_type LIKE ? OR resource_id LIKE ? OR request_summary LIKE ? OR result LIKE ?",
			like, like, like, like, like, like,
		)
	}
	if filter.From != nil {
		query = query.Where("created_at >= ?", *filter.From)
	}
	if filter.To != nil {
		query = query.Where("created_at <= ?", *filter.To)
	}

	var audits []store.AuditLog
	if err := query.Find(&audits).Error; err != nil {
		return nil, err
	}
	return auditModelsToDomain(audits), nil
}

func (s *Service) ExportAudits(ctx context.Context, filter AuditFilter, format string) ([]byte, string, error) {
	items, err := s.ListAudits(ctx, filter)
	if err != nil {
		return nil, "", err
	}

	switch format {
	case "csv":
		var buf bytes.Buffer
		writer := csv.NewWriter(&buf)
		_ = writer.Write([]string{"time", "actor", "action", "resource_type", "resource_id", "request_summary", "result", "source_ip"})
		for _, item := range items {
			_ = writer.Write([]string{
				item.CreatedAt.Format(time.RFC3339),
				item.Actor,
				item.Action,
				item.ResourceType,
				item.ResourceID,
				item.RequestSummary,
				item.Result,
				item.SourceIP,
			})
		}
		writer.Flush()
		return buf.Bytes(), "text/csv; charset=utf-8", writer.Error()
	default:
		payload, err := json.MarshalIndent(items, "", "  ")
		if err != nil {
			return nil, "", err
		}
		return payload, "application/json; charset=utf-8", nil
	}
}

func (s *Service) ListSessions(ctx context.Context, currentSessionID string) ([]domain.SessionInfo, error) {
	var sessions []store.Session
	if err := s.db.WithContext(ctx).Order("created_at desc").Find(&sessions).Error; err != nil {
		return nil, err
	}

	out := make([]domain.SessionInfo, 0, len(sessions))
	for _, session := range sessions {
		out = append(out, domain.SessionInfo{
			SessionID:  session.ID,
			Username:   session.Username,
			Role:       domain.AdminRole(session.Role),
			SourceIP:   session.SourceIP,
			UserAgent:  session.UserAgent,
			CreatedAt:  session.CreatedAt,
			LastSeenAt: session.LastSeenAt,
			ExpiresAt:  session.ExpiresAt,
			IsCurrent:  session.ID == currentSessionID,
		})
	}
	return out, nil
}

func (s *Service) RevokeSession(ctx context.Context, currentSessionID, targetID string) error {
	if targetID == "" {
		return newAPIError("bad_request", "会话 ID 不能为空", nil)
	}
	if currentSessionID == targetID {
		return newAPIError("bad_request", "不能撤销当前会话，请直接退出登录", nil)
	}
	return s.db.WithContext(ctx).Delete(&store.Session{}, "id = ?", targetID).Error
}

func (s *Service) BatchUpdateUserPermissions(ctx context.Context, actor string, client *minioadmin.SessionClient, users []string, permissions map[string]domain.PermissionTemplate, token string) error {
	targets := normalizePrincipalList(users)
	if len(targets) == 0 {
		return newAPIError("bad_request", "批量用户列表不能为空", nil)
	}
	expected := strings.Join(targets, ",")
	if err := s.requireConfirmation(ctx, actor, domain.ConfirmationOverwritePermissions, "user_batch", expected, fmt.Sprintf("Overwrite bucket permissions for %d users.", len(targets)), expected, token); err != nil {
		return err
	}
	for _, user := range targets {
		if err := client.ApplyUserBucketPermissions(ctx, user, permissions); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) UserDependencies(ctx context.Context, client *minioadmin.SessionClient, user string) (domain.UserDependencyDetails, error) {
	return client.GetUserDependencies(ctx, user)
}

func (s *Service) SystemHealth(ctx context.Context, client *minioadmin.SessionClient) (domain.SystemHealth, error) {
	health, err := client.SystemHealth(ctx)
	if err != nil {
		return domain.SystemHealth{}, err
	}

	setup := []domain.HealthCheck{
		{Name: "master_key", Status: "ok", Message: fmt.Sprintf("APP_MASTER_KEY 已配置，长度 %d", len(s.cfg.MasterKey))},
		{Name: "sqlite_path", Status: "ok", Message: "SQLite 存储可访问"},
		{Name: "frontend_dist", Status: "ok", Message: "前端静态资源目录已配置"},
	}
	if s.cfg.FrontendDistDir == "" {
		setup[2].Status = "warning"
		setup[2].Message = "FRONTEND_DIST_DIR 未配置"
	}
	health.SetupChecklist = setup
	return health, nil
}

func (s *Service) BuildSnapshot(ctx context.Context, client *minioadmin.SessionClient) (domain.ConfigSnapshot, error) {
	users, err := client.ListUsers(ctx)
	if err != nil {
		return domain.ConfigSnapshot{}, err
	}
	groups, err := client.ListGroups(ctx)
	if err != nil {
		return domain.ConfigSnapshot{}, err
	}
	buckets, err := client.ListBuckets(ctx)
	if err != nil {
		return domain.ConfigSnapshot{}, err
	}

	policies := make([]domain.BucketPolicy, 0, len(buckets))
	for _, bucket := range buckets {
		policy, err := client.GetBucketPolicy(ctx, bucket.Name)
		if err != nil {
			return domain.ConfigSnapshot{}, err
		}
		policies = append(policies, policy)
	}

	return domain.ConfigSnapshot{
		GeneratedAt: time.Now().UTC(),
		Endpoint:    s.cfg.MinIOEndpoint,
		Users:       users,
		Groups:      groups,
		Buckets:     policies,
	}, nil
}

func (s *Service) RestoreSnapshot(ctx context.Context, actor string, client *minioadmin.SessionClient, snapshot domain.ConfigSnapshot, defaultPassword, token string) error {
	if err := s.requireConfirmation(ctx, actor, domain.ConfirmationRestoreSnapshot, "snapshot", snapshot.Endpoint, fmt.Sprintf("Restore snapshot from %s created at %s.", snapshot.Endpoint, snapshot.GeneratedAt.Format(time.RFC3339)), snapshot.Endpoint, token); err != nil {
		return err
	}

	existingUsers, err := client.ListUsers(ctx)
	if err != nil {
		return err
	}
	existingGroups, err := client.ListGroups(ctx)
	if err != nil {
		return err
	}
	userMap := map[string]domain.UserSummary{}
	groupMap := map[string]domain.GroupSummary{}
	for _, user := range existingUsers {
		userMap[user.Name] = user
	}
	for _, group := range existingGroups {
		groupMap[group.Name] = group
	}

	for _, group := range snapshot.Groups {
		if _, ok := groupMap[group.Name]; !ok {
			if err := client.CreateGroup(ctx, group.Name); err != nil {
				return err
			}
		}
		if err := client.UpdateGroupMembers(ctx, group.Name, group.Members); err != nil {
			return err
		}
		if err := client.ApplyGroupBucketPermissions(ctx, group.Name, bindingsToPermissionMap(group.Permissions)); err != nil {
			return err
		}
	}

	for _, user := range snapshot.Users {
		current, ok := userMap[user.Name]
		if !ok {
			if strings.TrimSpace(defaultPassword) == "" {
				return newAPIError("missing_default_password", "快照中包含缺失用户，请提供默认密码以便重建", map[string]any{"user": user.Name})
			}
			if err := client.CreateUser(ctx, user.Name, defaultPassword, user.Role); err != nil {
				return err
			}
		} else if current.Status != user.Status {
			if err := client.SetUserStatus(ctx, user.Name, user.Status); err != nil {
				return err
			}
		}
		if err := client.ApplyUserBucketPermissions(ctx, user.Name, bindingsToPermissionMap(user.DirectPermissions)); err != nil {
			return err
		}
	}

	for _, bucket := range snapshot.Buckets {
		if err := client.SetBucketPolicy(ctx, bucket.Bucket, bucket.Policy); err != nil {
			return err
		}
	}

	return nil
}

func bindingsToPermissionMap(bindings []domain.PermissionBinding) map[string]domain.PermissionTemplate {
	out := make(map[string]domain.PermissionTemplate, len(bindings))
	for _, binding := range bindings {
		out[binding.Bucket] = binding.Template
	}
	return out
}

func normalizePrincipalList(items []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(items))
	for _, item := range items {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func (s *Service) ValidateBucketPolicy(bucket, policy string) domain.PolicyValidationResult {
	result := domain.PolicyValidationResult{
		Valid:          true,
		NormalizedJSON: strings.TrimSpace(policy),
		Errors:         []string{},
		Warnings:       []string{},
	}

	trimmed := strings.TrimSpace(policy)
	if trimmed == "" {
		result.Warnings = append(result.Warnings, "空策略会清空桶策略并恢复为 private")
		return result
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		result.Valid = false
		result.Errors = append(result.Errors, "JSON 解析失败: "+err.Error())
		return result
	}

	normalized, err := json.MarshalIndent(payload, "", "  ")
	if err == nil {
		result.NormalizedJSON = string(normalized)
	}

	statements, ok := payload["Statement"]
	if !ok {
		result.Valid = false
		result.Errors = append(result.Errors, "缺少 Statement 字段")
		return result
	}
	if _, ok := statements.([]any); !ok {
		result.Valid = false
		result.Errors = append(result.Errors, "Statement 必须是数组")
		return result
	}

	expectedBucketArn := fmt.Sprintf("arn:aws:s3:::%s", bucket)
	expectedObjectArn := fmt.Sprintf("arn:aws:s3:::%s/*", bucket)
	if !strings.Contains(result.NormalizedJSON, expectedBucketArn) && !strings.Contains(result.NormalizedJSON, expectedObjectArn) {
		result.Warnings = append(result.Warnings, "策略资源未明显包含当前桶 ARN，请确认是否为跨桶策略")
	}
	if strings.Contains(result.NormalizedJSON, `"Principal": "*"`) || strings.Contains(result.NormalizedJSON, `"Principal":"*"`) {
		result.Warnings = append(result.Warnings, "检测到匿名访问 Principal=*，请确认是否符合预期")
	}
	return result
}

func (s *Service) EffectivePermissions(user domain.UserSummary, groups []domain.GroupSummary, buckets []domain.BucketInfo) []domain.EffectivePermissionRow {
	groupPermissionMap := map[string]map[string]domain.PermissionTemplate{}
	for _, group := range groups {
		entries := map[string]domain.PermissionTemplate{}
		for _, binding := range group.Permissions {
			entries[binding.Bucket] = binding.Template
		}
		groupPermissionMap[group.Name] = entries
	}

	directMap := bindingsToPermissionMap(user.DirectPermissions)
	finalMap := bindingsToPermissionMap(user.FinalPermissions)
	rows := make([]domain.EffectivePermissionRow, 0, len(buckets))
	for _, bucket := range buckets {
		inherited := domain.PermissionNone
		inheritedVia := []string{}
		for _, groupName := range user.MemberOf {
			if template, ok := groupPermissionMap[groupName][bucket.Name]; ok {
				inheritedVia = append(inheritedVia, groupName)
				if permissionRank(template) > permissionRank(inherited) {
					inherited = template
				}
			}
		}
		rows = append(rows, domain.EffectivePermissionRow{
			Bucket:       bucket.Name,
			Direct:       directMap[bucket.Name],
			Inherited:    inherited,
			Effective:    finalMap[bucket.Name],
			InheritedVia: inheritedVia,
		})
	}
	return rows
}

func permissionRank(template domain.PermissionTemplate) int {
	switch template {
	case domain.PermissionRWD:
		return 3
	case domain.PermissionRW:
		return 2
	case domain.PermissionRO:
		return 1
	default:
		return 0
	}
}

func (s *Service) CreateSnapshotImportID() string {
	return uuid.NewString()
}
