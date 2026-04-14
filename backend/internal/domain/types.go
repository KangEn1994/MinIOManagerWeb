package domain

import "time"

type ConfirmationType string

const (
	ConfirmationDeleteBucket          ConfirmationType = "delete_bucket"
	ConfirmationDeleteUser            ConfirmationType = "delete_user"
	ConfirmationForceDeleteUser       ConfirmationType = "force_delete_user"
	ConfirmationDeleteAccessKey       ConfirmationType = "delete_access_key"
	ConfirmationOverwritePermissions  ConfirmationType = "overwrite_permissions"
)

type PermissionTemplate string

const (
	PermissionNone PermissionTemplate = "none"
	PermissionRO   PermissionTemplate = "read_only"
	PermissionRW   PermissionTemplate = "read_write"
	PermissionRWD  PermissionTemplate = "read_write_delete"
)

type BucketVisibility string

const (
	BucketVisibilityPrivate    BucketVisibility = "private"
	BucketVisibilityPublicRead BucketVisibility = "public-read"
)

type BucketInfo struct {
	Name         string           `json:"name"`
	CreatedAt    time.Time        `json:"createdAt"`
	Visibility   BucketVisibility `json:"visibility"`
	CanDelete    bool             `json:"canDelete"`
}

type PermissionBinding struct {
	Bucket   string             `json:"bucket"`
	Template PermissionTemplate `json:"template"`
	Source   string             `json:"source"`
}

type UserSummary struct {
	Name              string              `json:"name"`
	Status            string              `json:"status"`
	MemberOf          []string            `json:"memberOf"`
	DirectPermissions []PermissionBinding `json:"directPermissions"`
	FinalPermissions  []PermissionBinding `json:"finalPermissions"`
}

type GroupSummary struct {
	Name        string              `json:"name"`
	Status      string              `json:"status"`
	Members     []string            `json:"members"`
	Permissions []PermissionBinding `json:"permissions"`
}

type AccessKeySummary struct {
	AccessKey   string     `json:"accessKey"`
	Status      string     `json:"status"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	ExpiresAt   *time.Time `json:"expiresAt,omitempty"`
}

type HealthInfo struct {
	Online       bool      `json:"online"`
	ServerTime   time.Time `json:"serverTime"`
	BucketCount  int       `json:"bucketCount"`
	UserCount    int       `json:"userCount"`
	GroupCount   int       `json:"groupCount"`
	AuditCount   int64     `json:"auditCount"`
}

type DashboardInfo struct {
	Health       HealthInfo   `json:"health"`
	RecentAudits []AuditEntry `json:"recentAudits"`
}

type AuditEntry struct {
	ID             string    `json:"id"`
	Actor          string    `json:"actor"`
	Action         string    `json:"action"`
	ResourceType   string    `json:"resourceType"`
	ResourceID     string    `json:"resourceId"`
	RequestSummary string    `json:"requestSummary"`
	Result         string    `json:"result"`
	SourceIP       string    `json:"sourceIp"`
	CreatedAt      time.Time `json:"createdAt"`
}

type ConfirmationChallenge struct {
	Token      string    `json:"token"`
	Action     string    `json:"action"`
	Resource   string    `json:"resource"`
	Summary    string    `json:"summary"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

type APIError struct {
	Code                string                 `json:"code"`
	Message             string                 `json:"message"`
	Details             map[string]any         `json:"details,omitempty"`
	ConfirmationRequest *ConfirmationChallenge `json:"confirmationRequest,omitempty"`
}
