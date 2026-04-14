package minioadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/minio/madmin-go/v3"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"minio-manager-web/backend/internal/domain"
)

var policyNamePattern = regexp.MustCompile(`^mw_bucket_(.+)_(ro|rw|rwd)$`)

type Client struct {
	endpoint string
	region   string
	useSSL   bool
}

type SessionClient struct {
	s3    *minio.Client
	admin *madmin.AdminClient
}

func New(endpoint, region string, useSSL bool) *Client {
	return &Client{
		endpoint: endpoint,
		region:   region,
		useSSL:   useSSL,
	}
}

func (c *Client) NewSession(accessKey, secretKey string) (*SessionClient, error) {
	s3Client, err := minio.New(c.endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: c.useSSL,
		Region: c.region,
	})
	if err != nil {
		return nil, fmt.Errorf("create s3 client: %w", err)
	}

	adminClient, err := madmin.New(c.endpoint, accessKey, secretKey, c.useSSL)
	if err != nil {
		return nil, fmt.Errorf("create admin client: %w", err)
	}

	return &SessionClient{s3: s3Client, admin: adminClient}, nil
}

func (c *SessionClient) ValidateAdmin(ctx context.Context) error {
	_, err := c.admin.ServerInfo(ctx)
	if err != nil {
		return fmt.Errorf("validate admin: %w", err)
	}
	return nil
}

func (c *SessionClient) Health(ctx context.Context, auditCount int64) (domain.HealthInfo, error) {
	buckets, err := c.s3.ListBuckets(ctx)
	if err != nil {
		return domain.HealthInfo{}, fmt.Errorf("list buckets: %w", err)
	}
	users, err := c.admin.ListUsers(ctx)
	if err != nil {
		return domain.HealthInfo{}, fmt.Errorf("list users: %w", err)
	}
	groups, err := c.admin.ListGroups(ctx)
	if err != nil {
		return domain.HealthInfo{}, fmt.Errorf("list groups: %w", err)
	}
	return domain.HealthInfo{
		Online:      true,
		ServerTime:  time.Now().UTC(),
		BucketCount: len(buckets),
		UserCount:   len(users),
		GroupCount:  len(groups),
		AuditCount:  auditCount,
	}, nil
}

func (c *SessionClient) ListBuckets(ctx context.Context) ([]domain.BucketInfo, error) {
	buckets, err := c.s3.ListBuckets(ctx)
	if err != nil {
		return nil, fmt.Errorf("list buckets: %w", err)
	}

	out := make([]domain.BucketInfo, 0, len(buckets))
	for _, bucket := range buckets {
		visibility, err := c.GetBucketVisibility(ctx, bucket.Name)
		if err != nil {
			return nil, err
		}
		out = append(out, domain.BucketInfo{
			Name:       bucket.Name,
			CreatedAt:  bucket.CreationDate,
			Visibility: visibility,
			CanDelete:  true,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		return out[i].Name < out[j].Name
	})

	return out, nil
}

func (c *SessionClient) CreateBucket(ctx context.Context, name, region string) error {
	if err := c.s3.MakeBucket(ctx, name, minio.MakeBucketOptions{Region: region}); err != nil {
		return fmt.Errorf("create bucket: %w", err)
	}
	return nil
}

func (c *SessionClient) DeleteBucket(ctx context.Context, name string) error {
	if err := c.s3.RemoveBucket(ctx, name); err != nil {
		return fmt.Errorf("delete bucket: %w", err)
	}
	return nil
}

func (c *SessionClient) GetBucketVisibility(ctx context.Context, name string) (domain.BucketVisibility, error) {
	policy, err := c.s3.GetBucketPolicy(ctx, name)
	if err != nil {
		return "", fmt.Errorf("get bucket policy: %w", err)
	}
	if strings.TrimSpace(policy) == "" {
		return domain.BucketVisibilityPrivate, nil
	}
	if strings.Contains(policy, "\"Principal\":\"*\"") || strings.Contains(policy, "\"Principal\": \"*\"") {
		if strings.Contains(policy, "s3:GetObject") {
			return domain.BucketVisibilityPublicRead, nil
		}
	}
	return domain.BucketVisibilityPrivate, nil
}

func (c *SessionClient) SetBucketVisibility(ctx context.Context, name string, visibility domain.BucketVisibility) error {
	switch visibility {
	case domain.BucketVisibilityPrivate:
		return c.s3.SetBucketPolicy(ctx, name, "")
	case domain.BucketVisibilityPublicRead:
		policy := fmt.Sprintf(`{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Principal":"*",
      "Action":["s3:GetObject"],
      "Resource":["arn:aws:s3:::%s/*"]
    }
  ]
}`, name)
		return c.s3.SetBucketPolicy(ctx, name, policy)
	default:
		return fmt.Errorf("unsupported visibility: %s", visibility)
	}
}

func (c *SessionClient) ListUsers(ctx context.Context) ([]domain.UserSummary, error) {
	users, err := c.admin.ListUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}

	names := make([]string, 0, len(users))
	for name := range users {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]domain.UserSummary, 0, len(users))
	for _, name := range names {
		info := users[name]
		direct, final, err := c.resolveUserPermissions(ctx, name, info.MemberOf)
		if err != nil {
			return nil, err
		}
		out = append(out, domain.UserSummary{
			Name:              name,
			Status:            string(info.Status),
			MemberOf:          normalizeStrings(info.MemberOf),
			DirectPermissions: normalizePermissionBindings(direct),
			FinalPermissions:  normalizePermissionBindings(final),
		})
	}
	return out, nil
}

func (c *SessionClient) GetUser(ctx context.Context, user string) (domain.UserSummary, error) {
	info, err := c.admin.GetUserInfo(ctx, user)
	if err != nil {
		return domain.UserSummary{}, fmt.Errorf("get user: %w", err)
	}
	direct, final, err := c.resolveUserPermissions(ctx, user, info.MemberOf)
	if err != nil {
		return domain.UserSummary{}, err
	}
	return domain.UserSummary{
		Name:              user,
		Status:            string(info.Status),
		MemberOf:          normalizeStrings(info.MemberOf),
		DirectPermissions: normalizePermissionBindings(direct),
		FinalPermissions:  normalizePermissionBindings(final),
	}, nil
}

func (c *SessionClient) CreateUser(ctx context.Context, user, secret string) error {
	if err := c.admin.AddUser(ctx, user, secret); err != nil {
		return fmt.Errorf("create user: %w", err)
	}
	return nil
}

func (c *SessionClient) SetUserStatus(ctx context.Context, user, status string) error {
	state := madmin.AccountEnabled
	if strings.EqualFold(status, "disabled") {
		state = madmin.AccountDisabled
	}
	if err := c.admin.SetUserStatus(ctx, user, state); err != nil {
		return fmt.Errorf("set user status: %w", err)
	}
	return nil
}

func (c *SessionClient) DeleteUser(ctx context.Context, user string) error {
	if err := c.admin.RemoveUser(ctx, user); err != nil {
		return fmt.Errorf("remove user: %w", err)
	}
	return nil
}

func (c *SessionClient) ListGroups(ctx context.Context) ([]domain.GroupSummary, error) {
	groups, err := c.admin.ListGroups(ctx)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	sort.Strings(groups)

	out := make([]domain.GroupSummary, 0, len(groups))
	for _, name := range groups {
		desc, err := c.admin.GetGroupDescription(ctx, name)
		if err != nil {
			return nil, fmt.Errorf("get group %s: %w", name, err)
		}
		perms, err := c.resolveGroupPermissions(ctx, name)
		if err != nil {
			return nil, err
		}
		out = append(out, domain.GroupSummary{
			Name:        name,
			Status:      desc.Status,
			Members:     normalizeStrings(desc.Members),
			Permissions: normalizePermissionBindings(perms),
		})
	}
	return out, nil
}

func (c *SessionClient) CreateGroup(ctx context.Context, name string) error {
	req := madmin.GroupAddRemove{
		Group:    name,
		Members:  []string{},
		Status:   madmin.GroupEnabled,
		IsRemove: false,
	}
	if err := c.admin.UpdateGroupMembers(ctx, req); err != nil {
		return fmt.Errorf("create group: %w", err)
	}
	return nil
}

func (c *SessionClient) DeleteGroup(ctx context.Context, name string) error {
	req := madmin.GroupAddRemove{
		Group:    name,
		Members:  []string{},
		Status:   madmin.GroupEnabled,
		IsRemove: true,
	}
	if err := c.admin.UpdateGroupMembers(ctx, req); err != nil {
		return fmt.Errorf("delete group: %w", err)
	}
	return nil
}

func (c *SessionClient) UpdateGroupMembers(ctx context.Context, group string, members []string) error {
	desc, err := c.admin.GetGroupDescription(ctx, group)
	if err != nil {
		return fmt.Errorf("get group description: %w", err)
	}
	current := make(map[string]struct{}, len(desc.Members))
	for _, member := range desc.Members {
		current[member] = struct{}{}
	}
	desired := make(map[string]struct{}, len(members))
	for _, member := range members {
		desired[member] = struct{}{}
	}

	var toAdd []string
	for member := range desired {
		if _, ok := current[member]; !ok {
			toAdd = append(toAdd, member)
		}
	}
	var toRemove []string
	for member := range current {
		if _, ok := desired[member]; !ok {
			toRemove = append(toRemove, member)
		}
	}

	if len(toAdd) > 0 {
		if err := c.admin.UpdateGroupMembers(ctx, madmin.GroupAddRemove{
			Group:    group,
			Members:  toAdd,
			Status:   madmin.GroupEnabled,
			IsRemove: false,
		}); err != nil {
			return fmt.Errorf("add group members: %w", err)
		}
	}
	if len(toRemove) > 0 {
		if err := c.admin.UpdateGroupMembers(ctx, madmin.GroupAddRemove{
			Group:    group,
			Members:  toRemove,
			Status:   madmin.GroupEnabled,
			IsRemove: true,
		}); err != nil {
			return fmt.Errorf("remove group members: %w", err)
		}
	}
	return nil
}

func (c *SessionClient) ListAccessKeys(ctx context.Context, user string) ([]domain.AccessKeySummary, error) {
	resp, err := c.admin.ListServiceAccounts(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("list access keys: %w", err)
	}
	items := make([]domain.AccessKeySummary, 0, len(resp.Accounts))
	for _, account := range resp.Accounts {
		items = append(items, domain.AccessKeySummary{
			AccessKey:   account.AccessKey,
			Status:      account.AccountStatus,
			Name:        account.Name,
			Description: account.Description,
			ExpiresAt:   account.Expiration,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].AccessKey < items[j].AccessKey
	})
	return items, nil
}

func (c *SessionClient) CreateAccessKey(ctx context.Context, user, name, description string, policy json.RawMessage) (madmin.Credentials, error) {
	creds, err := c.admin.AddServiceAccount(ctx, madmin.AddServiceAccountReq{
		TargetUser:  user,
		Name:        name,
		Description: description,
		Policy:      policy,
	})
	if err != nil {
		return madmin.Credentials{}, fmt.Errorf("create access key: %w", err)
	}
	return creds, nil
}

func (c *SessionClient) SetAccessKeyStatus(ctx context.Context, accessKey, status string) error {
	return c.admin.UpdateServiceAccount(ctx, accessKey, madmin.UpdateServiceAccountReq{
		NewStatus: status,
	})
}

func (c *SessionClient) DeleteAccessKey(ctx context.Context, accessKey string) error {
	if err := c.admin.DeleteServiceAccount(ctx, accessKey); err != nil {
		return fmt.Errorf("delete access key: %w", err)
	}
	return nil
}

func (c *SessionClient) ApplyUserBucketPermissions(ctx context.Context, user string, permissions map[string]domain.PermissionTemplate) error {
	current, err := c.currentManagedPoliciesForUser(ctx, user)
	if err != nil {
		return err
	}
	desired, err := c.ensurePolicies(ctx, permissions)
	if err != nil {
		return err
	}
	return c.reconcilePolicies(ctx, current, desired, user, "")
}

func (c *SessionClient) ApplyGroupBucketPermissions(ctx context.Context, group string, permissions map[string]domain.PermissionTemplate) error {
	current, err := c.currentManagedPoliciesForGroup(ctx, group)
	if err != nil {
		return err
	}
	desired, err := c.ensurePolicies(ctx, permissions)
	if err != nil {
		return err
	}
	return c.reconcilePolicies(ctx, current, desired, "", group)
}

func (c *SessionClient) GetUserDependencies(ctx context.Context, user string) (map[string]any, error) {
	info, err := c.admin.GetUserInfo(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("get user info: %w", err)
	}
	accounts, err := c.admin.ListServiceAccounts(ctx, user)
	if err != nil {
		return nil, fmt.Errorf("list access keys: %w", err)
	}
	mappings, err := c.admin.GetPolicyEntities(ctx, madmin.PolicyEntitiesQuery{
		Users: []string{user},
	})
	if err != nil {
		return nil, fmt.Errorf("get policy entities: %w", err)
	}
	directPolicies := []string{}
	if len(mappings.UserMappings) > 0 {
		directPolicies = mappings.UserMappings[0].Policies
	}
	return map[string]any{
		"memberOf":      info.MemberOf,
		"serviceKeys":   len(accounts.Accounts),
		"directPolicies": directPolicies,
	}, nil
}

func (c *SessionClient) ClearUserDependencies(ctx context.Context, user string) error {
	info, err := c.admin.GetUserInfo(ctx, user)
	if err != nil {
		return fmt.Errorf("get user info: %w", err)
	}
	if len(info.MemberOf) > 0 {
		for _, group := range info.MemberOf {
			if err := c.admin.UpdateGroupMembers(ctx, madmin.GroupAddRemove{
				Group:    group,
				Members:  []string{user},
				Status:   madmin.GroupEnabled,
				IsRemove: true,
			}); err != nil {
				return fmt.Errorf("remove user from group %s: %w", group, err)
			}
		}
	}
	serviceAccounts, err := c.admin.ListServiceAccounts(ctx, user)
	if err != nil {
		return fmt.Errorf("list access keys: %w", err)
	}
	for _, account := range serviceAccounts.Accounts {
		if err := c.admin.DeleteServiceAccount(ctx, account.AccessKey); err != nil {
			return fmt.Errorf("delete access key %s: %w", account.AccessKey, err)
		}
	}
	policies, err := c.currentManagedPoliciesForUser(ctx, user)
	if err != nil {
		return err
	}
	if len(policies) > 0 {
		_, err := c.admin.DetachPolicy(ctx, madmin.PolicyAssociationReq{
			User:     user,
			Policies: policies,
		})
		if err != nil {
			return fmt.Errorf("detach policies: %w", err)
		}
	}
	return nil
}

func (c *SessionClient) resolveUserPermissions(ctx context.Context, user string, groups []string) ([]domain.PermissionBinding, []domain.PermissionBinding, error) {
	result, err := c.admin.GetPolicyEntities(ctx, madmin.PolicyEntitiesQuery{
		Users: []string{user},
	})
	if err != nil {
		return nil, nil, fmt.Errorf("get user policy entities: %w", err)
	}

	direct := []domain.PermissionBinding{}
	final := map[string]domain.PermissionBinding{}

	if len(result.UserMappings) > 0 {
		direct = policiesToBindings(result.UserMappings[0].Policies, "direct")
		for _, binding := range direct {
			final[binding.Bucket] = binding
		}
	}

	for _, member := range groups {
		groupResult, err := c.admin.GetPolicyEntities(ctx, madmin.PolicyEntitiesQuery{
			Groups: []string{member},
		})
		if err != nil {
			return nil, nil, fmt.Errorf("get group policy entities: %w", err)
		}
		if len(groupResult.GroupMappings) == 0 {
			continue
		}
		for _, binding := range policiesToBindings(groupResult.GroupMappings[0].Policies, "group:"+member) {
			if existing, ok := final[binding.Bucket]; !ok || permissionRank(binding.Template) > permissionRank(existing.Template) {
				final[binding.Bucket] = binding
			}
		}
	}

	return direct, mapBindings(final), nil
}

func (c *SessionClient) resolveGroupPermissions(ctx context.Context, group string) ([]domain.PermissionBinding, error) {
	result, err := c.admin.GetPolicyEntities(ctx, madmin.PolicyEntitiesQuery{
		Groups: []string{group},
	})
	if err != nil {
		return nil, fmt.Errorf("get group policy entities: %w", err)
	}
	if len(result.GroupMappings) == 0 {
		return []domain.PermissionBinding{}, nil
	}
	return policiesToBindings(result.GroupMappings[0].Policies, "group"), nil
}

func (c *SessionClient) currentManagedPoliciesForUser(ctx context.Context, user string) ([]string, error) {
	result, err := c.admin.GetPolicyEntities(ctx, madmin.PolicyEntitiesQuery{
		Users: []string{user},
	})
	if err != nil {
		return nil, fmt.Errorf("get user policies: %w", err)
	}
	if len(result.UserMappings) == 0 {
		return []string{}, nil
	}
	return filterManagedPolicies(result.UserMappings[0].Policies), nil
}

func (c *SessionClient) currentManagedPoliciesForGroup(ctx context.Context, group string) ([]string, error) {
	result, err := c.admin.GetPolicyEntities(ctx, madmin.PolicyEntitiesQuery{
		Groups: []string{group},
	})
	if err != nil {
		return nil, fmt.Errorf("get group policies: %w", err)
	}
	if len(result.GroupMappings) == 0 {
		return []string{}, nil
	}
	return filterManagedPolicies(result.GroupMappings[0].Policies), nil
}

func (c *SessionClient) reconcilePolicies(ctx context.Context, current, desired []string, user, group string) error {
	currentSet := make(map[string]struct{}, len(current))
	for _, item := range current {
		currentSet[item] = struct{}{}
	}
	desiredSet := make(map[string]struct{}, len(desired))
	for _, item := range desired {
		desiredSet[item] = struct{}{}
	}

	attach := []string{}
	for _, item := range desired {
		if _, ok := currentSet[item]; !ok {
			attach = append(attach, item)
		}
	}
	detach := []string{}
	for _, item := range current {
		if _, ok := desiredSet[item]; !ok {
			detach = append(detach, item)
		}
	}

	if len(attach) > 0 {
		req := madmin.PolicyAssociationReq{Policies: attach, User: user, Group: group}
		if _, err := c.admin.AttachPolicy(ctx, req); err != nil {
			return fmt.Errorf("attach policies: %w", err)
		}
	}
	if len(detach) > 0 {
		req := madmin.PolicyAssociationReq{Policies: detach, User: user, Group: group}
		if _, err := c.admin.DetachPolicy(ctx, req); err != nil {
			return fmt.Errorf("detach policies: %w", err)
		}
	}
	return nil
}

func (c *SessionClient) ensurePolicies(ctx context.Context, permissions map[string]domain.PermissionTemplate) ([]string, error) {
	names := make([]string, 0, len(permissions))
	for bucket, template := range permissions {
		if template == domain.PermissionNone {
			continue
		}
		name := managedPolicyName(bucket, template)
		policyDoc, err := buildPolicyDocument(bucket, template)
		if err != nil {
			return nil, err
		}
		if err := c.admin.AddCannedPolicy(ctx, name, []byte(policyDoc)); err != nil {
			return nil, fmt.Errorf("ensure canned policy %s: %w", name, err)
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

func buildPolicyDocument(bucket string, template domain.PermissionTemplate) (string, error) {
	actions := []string{
		"s3:GetBucketLocation",
		"s3:ListBucket",
	}
	objectActions := []string{
		"s3:GetObject",
	}

	switch template {
	case domain.PermissionRO:
	case domain.PermissionRW:
		objectActions = append(objectActions,
			"s3:PutObject",
			"s3:AbortMultipartUpload",
			"s3:ListMultipartUploadParts",
		)
	case domain.PermissionRWD:
		objectActions = append(objectActions,
			"s3:PutObject",
			"s3:AbortMultipartUpload",
			"s3:ListMultipartUploadParts",
			"s3:DeleteObject",
		)
	default:
		return "", fmt.Errorf("unsupported template: %s", template)
	}

	payload := map[string]any{
		"Version": "2012-10-17",
		"Statement": []map[string]any{
			{
				"Effect":   "Allow",
				"Action":   actions,
				"Resource": []string{fmt.Sprintf("arn:aws:s3:::%s", bucket)},
			},
			{
				"Effect":   "Allow",
				"Action":   objectActions,
				"Resource": []string{fmt.Sprintf("arn:aws:s3:::%s/*", bucket)},
			},
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal policy: %w", err)
	}
	return string(encoded), nil
}

func policiesToBindings(policies []string, source string) []domain.PermissionBinding {
	bindings := []domain.PermissionBinding{}
	for _, policy := range policies {
		matches := policyNamePattern.FindStringSubmatch(policy)
		if len(matches) != 3 {
			continue
		}
		bindings = append(bindings, domain.PermissionBinding{
			Bucket:   matches[1],
			Template: templateFromSuffix(matches[2]),
			Source:   source,
		})
	}
	sort.Slice(bindings, func(i, j int) bool {
		return bindings[i].Bucket < bindings[j].Bucket
	})
	return bindings
}

func filterManagedPolicies(policies []string) []string {
	filtered := []string{}
	for _, policy := range policies {
		if policyNamePattern.MatchString(policy) {
			filtered = append(filtered, policy)
		}
	}
	sort.Strings(filtered)
	return filtered
}

func managedPolicyName(bucket string, template domain.PermissionTemplate) string {
	suffix := "ro"
	switch template {
	case domain.PermissionRW:
		suffix = "rw"
	case domain.PermissionRWD:
		suffix = "rwd"
	}
	return fmt.Sprintf("mw_bucket_%s_%s", bucket, suffix)
}

func templateFromSuffix(suffix string) domain.PermissionTemplate {
	switch suffix {
	case "ro":
		return domain.PermissionRO
	case "rw":
		return domain.PermissionRW
	case "rwd":
		return domain.PermissionRWD
	default:
		return domain.PermissionNone
	}
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

func mapBindings(in map[string]domain.PermissionBinding) []domain.PermissionBinding {
	out := make([]domain.PermissionBinding, 0, len(in))
	for _, binding := range in {
		out = append(out, binding)
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Bucket < out[j].Bucket
	})
	return out
}

func normalizeStrings(items []string) []string {
	if items == nil {
		return []string{}
	}
	return items
}

func normalizePermissionBindings(items []domain.PermissionBinding) []domain.PermissionBinding {
	if items == nil {
		return []domain.PermissionBinding{}
	}
	return items
}
