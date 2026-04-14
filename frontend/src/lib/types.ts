export type BucketVisibility = 'private' | 'public-read' | 'custom'
export type PermissionTemplate = 'none' | 'read_only' | 'read_write' | 'read_write_delete'
export type AdminRole = 'user' | 'global_admin' | 'readonly_admin'

export interface SessionData {
  sessionId: string
  username: string
  role: AdminRole
  sourceIp: string
  userAgent: string
  createdAt: string
  expiresAt: string
}

export interface DashboardInfo {
  health: {
    online: boolean
    serverTime: string
    bucketCount: number
    userCount: number
    groupCount: number
    auditCount: number
  }
  recentAudits: AuditLog[]
}

export interface BucketInfo {
  name: string
  createdAt: string
  visibility: BucketVisibility
  canDelete: boolean
}

export interface BucketPolicy {
  bucket: string
  visibility: BucketVisibility
  policy: string
}

export interface PermissionBinding {
  bucket: string
  template: PermissionTemplate
  source: string
}

export interface UserSummary {
  name: string
  status: string
  role: AdminRole
  isGlobalAdmin: boolean
  memberOf: string[]
  directPermissions: PermissionBinding[]
  finalPermissions: PermissionBinding[]
}

export interface GroupSummary {
  name: string
  status: string
  members: string[]
  permissions: PermissionBinding[]
}

export interface AccessKeySummary {
  accessKey: string
  status: string
  name: string
  description: string
  expiresAt?: string
}

export interface AuditLog {
  id: string
  actor: string
  action: string
  resourceType: string
  resourceId: string
  requestSummary: string
  result: string
  sourceIp: string
  createdAt: string
}

export interface ConfirmationRequest {
  token: string
  action: string
  resource: string
  summary: string
  prompt?: string
  expected?: string
  expiresAt: string
}

export interface PolicyValidationResult {
  valid: boolean
  normalizedJson: string
  errors: string[]
  warnings: string[]
}

export interface BucketSafetyReport {
  bucket: string
  objectCount: number
  versionedEntryCount: number
  incompleteUploadCount: number
  versioningStatus: string
  deleteBlocked: boolean
}

export interface UserDependencyDetails {
  memberOf: string[]
  serviceKeys: string[]
  directPolicies: string[]
}

export interface EffectivePermissionRow {
  bucket: string
  direct: PermissionTemplate
  inherited: PermissionTemplate
  effective: PermissionTemplate
  inheritedVia: string[]
}

export interface HealthCheck {
  name: string
  status: string
  message: string
}

export interface SystemHealth {
  serverTime: string
  mode: string
  deploymentId: string
  version: string
  region: string
  storageUsed: number
  storageRaw: number
  checks: HealthCheck[]
  setupChecklist: HealthCheck[]
}

export interface SessionInfo {
  sessionId: string
  username: string
  role: AdminRole
  sourceIp: string
  userAgent: string
  createdAt: string
  expiresAt: string
  lastSeenAt: string
  isCurrent: boolean
}

export interface ConfigSnapshot {
  generatedAt: string
  endpoint: string
  users: UserSummary[]
  groups: GroupSummary[]
  buckets: BucketPolicy[]
}

export interface ApiErrorPayload {
  code: string
  message: string
  details?: Record<string, unknown>
  confirmationRequest?: ConfirmationRequest
}
