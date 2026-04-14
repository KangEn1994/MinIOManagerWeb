import type {
  AccessKeySummary,
  AdminRole,
  ApiErrorPayload,
  AuditLog,
  BucketInfo,
  BucketPolicy,
  ConfigSnapshot,
  EffectivePermissionRow,
  PolicyValidationResult,
  SessionInfo,
  BucketVisibility,
  DashboardInfo,
  GroupSummary,
  PermissionTemplate,
  SessionData,
  SystemHealth,
  UserSummary,
  UserDependencyDetails,
} from './types'

export class ApiError extends Error {
  payload: ApiErrorPayload

  constructor(payload: ApiErrorPayload) {
    super(payload.message)
    this.payload = payload
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL || ''

function normalizeUser(user: UserSummary): UserSummary {
  return {
    ...user,
    role: user.role ?? (user.isGlobalAdmin ? 'global_admin' : 'user'),
    isGlobalAdmin: user.isGlobalAdmin ?? false,
    memberOf: user.memberOf ?? [],
    directPermissions: user.directPermissions ?? [],
    finalPermissions: user.finalPermissions ?? [],
  }
}

function normalizeGroup(group: GroupSummary): GroupSummary {
  return {
    ...group,
    members: group.members ?? [],
    permissions: group.permissions ?? [],
  }
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(payload.error || { code: 'unknown_error', message: '请求失败' })
  }

  return payload.data as T
}

export const api = {
  login(username: string, password: string) {
    return request<SessionData>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
  },
  logout(token: string) {
    return request<{ success: boolean }>('/api/auth/logout', { method: 'POST' }, token)
  },
  dashboard(token: string) {
    return request<DashboardInfo>('/api/dashboard', {}, token)
  },
  buckets(token: string) {
    return request<BucketInfo[]>('/api/buckets', {}, token)
  },
  createBucket(token: string, name: string) {
    return request<{ success: boolean }>('/api/buckets', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }, token)
  },
  bucketPolicy(token: string, bucket: string) {
    return request<BucketPolicy>(`/api/buckets/${bucket}/policy`, {}, token)
  },
  validateBucketPolicy(token: string, bucket: string, policy: string) {
    return request<PolicyValidationResult>(`/api/buckets/${bucket}/policy/validate`, {
      method: 'POST',
      body: JSON.stringify({ policy }),
    }, token)
  },
  updateBucketPolicy(token: string, bucket: string, policy: string) {
    return request<{ success: boolean }>(`/api/buckets/${bucket}/policy`, {
      method: 'PUT',
      body: JSON.stringify({ policy }),
    }, token)
  },
  setBucketVisibility(token: string, bucket: string, visibility: BucketVisibility) {
    return request<{ success: boolean }>(`/api/buckets/${bucket}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    }, token)
  },
  deleteBucket(token: string, bucket: string, confirmationToken?: string) {
    const suffix = confirmationToken ? `?confirmationToken=${encodeURIComponent(confirmationToken)}` : ''
    return request<{ success: boolean }>(`/api/buckets/${bucket}${suffix}`, { method: 'DELETE' }, token)
  },
  users(token: string) {
    return request<UserSummary[]>('/api/users', {}, token).then((items) => items.map(normalizeUser))
  },
  createUser(token: string, name: string, password: string, role: AdminRole) {
    return request<{ success: boolean }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, password, role }),
    }, token)
  },
  userDependencies(token: string, user: string) {
    return request<UserDependencyDetails>(`/api/users/${user}/dependencies`, {}, token)
  },
  effectivePermissions(token: string, user: string) {
    return request<EffectivePermissionRow[]>(`/api/users/${user}/effective-permissions`, {}, token)
  },
  setUserRole(token: string, user: string, role: AdminRole) {
    return request<{ success: boolean }>(`/api/users/${user}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }, token)
  },
  setUserStatus(token: string, user: string, status: string) {
    return request<{ success: boolean }>(`/api/users/${user}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, token)
  },
  deleteUser(token: string, user: string, mode: 'safe' | 'force', confirmationToken?: string) {
    const params = new URLSearchParams({ mode })
    if (confirmationToken) {
      params.set('confirmationToken', confirmationToken)
    }
    return request<{ success: boolean }>(`/api/users/${user}?${params.toString()}`, { method: 'DELETE' }, token)
  },
  updateUserPermissions(token: string, user: string, permissions: Record<string, PermissionTemplate>, confirmationToken?: string) {
    return request<{ success: boolean }>(`/api/users/${user}/bucket-permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions, confirmationToken }),
    }, token)
  },
  batchUpdateUserPermissions(token: string, users: string[], permissions: Record<string, PermissionTemplate>, confirmationToken?: string) {
    return request<{ success: boolean }>(`/api/users/batch/bucket-permissions`, {
      method: 'PUT',
      body: JSON.stringify({ users, permissions, confirmationToken }),
    }, token)
  },
  groups(token: string) {
    return request<GroupSummary[]>('/api/groups', {}, token).then((items) => items.map(normalizeGroup))
  },
  createGroup(token: string, name: string) {
    return request<{ success: boolean }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }, token)
  },
  deleteGroup(token: string, group: string) {
    return request<{ success: boolean }>(`/api/groups/${group}`, { method: 'DELETE' }, token)
  },
  updateGroupMembers(token: string, group: string, members: string[]) {
    return request<{ success: boolean }>(`/api/groups/${group}/members`, {
      method: 'PUT',
      body: JSON.stringify({ members }),
    }, token)
  },
  updateGroupPermissions(token: string, group: string, permissions: Record<string, PermissionTemplate>, confirmationToken?: string) {
    return request<{ success: boolean }>(`/api/groups/${group}/bucket-permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions, confirmationToken }),
    }, token)
  },
  accessKeys(token: string, user: string) {
    return request<AccessKeySummary[]>(`/api/users/${user}/access-keys`, {}, token)
  },
  createAccessKey(token: string, user: string, name: string, description: string) {
    return request<{ credentials: { accessKey: string; secretKey: string } }>(`/api/users/${user}/access-keys`, {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }, token)
  },
  setAccessKeyStatus(token: string, user: string, key: string, status: string) {
    return request<{ success: boolean }>(`/api/users/${user}/access-keys/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, token)
  },
  deleteAccessKey(token: string, user: string, key: string, confirmationToken?: string) {
    const suffix = confirmationToken ? `?confirmationToken=${encodeURIComponent(confirmationToken)}` : ''
    return request<{ success: boolean }>(`/api/users/${user}/access-keys/${key}${suffix}`, { method: 'DELETE' }, token)
  },
  auditLogs(token: string, params?: URLSearchParams) {
    const query = params?.toString() ? `?${params.toString()}` : '?limit=100'
    return request<AuditLog[]>(`/api/audit-logs${query}`, {}, token)
  },
  async exportAuditLogs(token: string, params?: URLSearchParams) {
    const query = params?.toString() ? `?${params.toString()}` : ''
    const response = await fetch(`${baseUrl}/api/audit-logs/export${query}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new ApiError(payload.error || { code: 'unknown_error', message: '导出审计日志失败' })
    }
    return {
      blob: await response.blob(),
      filename: response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'audit-logs.json',
    }
  },
  sessions(token: string) {
    return request<SessionInfo[]>('/api/sessions', {}, token)
  },
  revokeSession(token: string, sessionId: string) {
    return request<{ success: boolean }>(`/api/sessions/${sessionId}`, { method: 'DELETE' }, token)
  },
  systemHealth(token: string) {
    return request<SystemHealth>('/api/system/health', {}, token)
  },
  exportSnapshot(token: string) {
    return request<ConfigSnapshot>('/api/system/snapshot', {}, token)
  },
  restoreSnapshot(token: string, snapshot: ConfigSnapshot, defaultPassword: string, confirmationToken?: string) {
    return request<{ success: boolean }>('/api/system/snapshot/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot, defaultPassword, confirmationToken }),
    }, token)
  },
}
