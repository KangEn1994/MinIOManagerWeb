package domain

import "time"

type ConfirmationType string

const (
	ConfirmationDeleteBucket         ConfirmationType = "delete_bucket"
	ConfirmationDeleteUser           ConfirmationType = "delete_user"
	ConfirmationForceDeleteUser      ConfirmationType = "force_delete_user"
	ConfirmationDeleteAccessKey      ConfirmationType = "delete_access_key"
	ConfirmationOverwritePermissions ConfirmationType = "overwrite_permissions"
	ConfirmationRestoreSnapshot      ConfirmationType = "restore_snapshot"
)

type AdminRole string

const (
	RoleUser          AdminRole = "user"
	RoleGlobalAdmin   AdminRole = "global_admin"
	RoleReadOnlyAdmin AdminRole = "readonly_admin"
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
	BucketVisibilityCustom     BucketVisibility = "custom"
)

type BucketInfo struct {
	Name       string           `json:"name"`
	CreatedAt  time.Time        `json:"createdAt"`
	Visibility BucketVisibility `json:"visibility"`
	CanDelete  bool             `json:"canDelete"`
}

type BucketPolicy struct {
	Bucket     string           `json:"bucket"`
	Visibility BucketVisibility `json:"visibility"`
	Policy     string           `json:"policy"`
}

type PermissionBinding struct {
	Bucket   string             `json:"bucket"`
	Template PermissionTemplate `json:"template"`
	Source   string             `json:"source"`
}

type UserSummary struct {
	Name              string              `json:"name"`
	Status            string              `json:"status"`
	Role              AdminRole           `json:"role"`
	IsGlobalAdmin     bool                `json:"isGlobalAdmin"`
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
	Online      bool      `json:"online"`
	ServerTime  time.Time `json:"serverTime"`
	BucketCount int       `json:"bucketCount"`
	UserCount   int       `json:"userCount"`
	GroupCount  int       `json:"groupCount"`
	AuditCount  int64     `json:"auditCount"`
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
	Token     string    `json:"token"`
	Action    string    `json:"action"`
	Resource  string    `json:"resource"`
	Summary   string    `json:"summary"`
	ExpiresAt time.Time `json:"expiresAt"`
	Prompt    string    `json:"prompt,omitempty"`
	Expected  string    `json:"expected,omitempty"`
}

type APIError struct {
	Code                string                 `json:"code"`
	Message             string                 `json:"message"`
	Details             map[string]any         `json:"details,omitempty"`
	ConfirmationRequest *ConfirmationChallenge `json:"confirmationRequest,omitempty"`
}

type PolicyValidationResult struct {
	Valid          bool     `json:"valid"`
	NormalizedJSON string   `json:"normalizedJson"`
	Errors         []string `json:"errors"`
	Warnings       []string `json:"warnings"`
}

type BucketSafetyReport struct {
	Bucket                string `json:"bucket"`
	ObjectCount           int    `json:"objectCount"`
	VersionedEntryCount   int    `json:"versionedEntryCount"`
	IncompleteUploadCount int    `json:"incompleteUploadCount"`
	VersioningStatus      string `json:"versioningStatus"`
	DeleteBlocked         bool   `json:"deleteBlocked"`
}

type UserDependencyDetails struct {
	MemberOf       []string `json:"memberOf"`
	ServiceKeys    []string `json:"serviceKeys"`
	DirectPolicies []string `json:"directPolicies"`
}

type EffectivePermissionRow struct {
	Bucket       string             `json:"bucket"`
	Direct       PermissionTemplate `json:"direct"`
	Inherited    PermissionTemplate `json:"inherited"`
	Effective    PermissionTemplate `json:"effective"`
	InheritedVia []string           `json:"inheritedVia"`
}

type HealthCheck struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

type SystemHealth struct {
	ServerTime     time.Time     `json:"serverTime"`
	Mode           string        `json:"mode"`
	DeploymentID   string        `json:"deploymentId"`
	Version        string        `json:"version"`
	Region         string        `json:"region"`
	StorageUsed    uint64        `json:"storageUsed"`
	StorageRaw     uint64        `json:"storageRaw"`
	Checks         []HealthCheck `json:"checks"`
	SetupChecklist []HealthCheck `json:"setupChecklist"`
}

type SessionInfo struct {
	SessionID  string    `json:"sessionId"`
	Username   string    `json:"username"`
	Role       AdminRole `json:"role"`
	SourceIP   string    `json:"sourceIp"`
	UserAgent  string    `json:"userAgent"`
	CreatedAt  time.Time `json:"createdAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
	LastSeenAt time.Time `json:"lastSeenAt"`
	IsCurrent  bool      `json:"isCurrent"`
}

type ConfigSnapshot struct {
	GeneratedAt time.Time      `json:"generatedAt"`
	Endpoint    string         `json:"endpoint"`
	Users       []UserSummary  `json:"users"`
	Groups      []GroupSummary `json:"groups"`
	Buckets     []BucketPolicy `json:"buckets"`
}
