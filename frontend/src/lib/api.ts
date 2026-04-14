import type {
  AccessKeySummary,
  ApiErrorPayload,
  AuditLog,
  BucketInfo,
  BucketVisibility,
  DashboardInfo,
  GroupSummary,
  PermissionTemplate,
  SessionData,
  UserSummary,
} from './types'

export class ApiError extends Error {
  payload: ApiErrorPayload

  constructor(payload: ApiErrorPayload) {
    super(payload.message)
    this.payload = payload
  }
}

const baseUrl = import.meta.env.VITE_API_BASE_URL || ''

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
    return request<UserSummary[]>('/api/users', {}, token)
  },
  createUser(token: string, name: string, password: string) {
    return request<{ success: boolean }>('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, password }),
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
  groups(token: string) {
    return request<GroupSummary[]>('/api/groups', {}, token)
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
  auditLogs(token: string) {
    return request<AuditLog[]>('/api/audit-logs?limit=100', {}, token)
  },
}
