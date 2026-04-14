export type BucketVisibility = 'private' | 'public-read'
export type PermissionTemplate = 'none' | 'read_only' | 'read_write' | 'read_write_delete'

export interface SessionData {
  sessionId: string
  username: string
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

export interface PermissionBinding {
  bucket: string
  template: PermissionTemplate
  source: string
}

export interface UserSummary {
  name: string
  status: string
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
  expiresAt: string
}

export interface ApiErrorPayload {
  code: string
  message: string
  details?: Record<string, unknown>
  confirmationRequest?: ConfirmationRequest
}
