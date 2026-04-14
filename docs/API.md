# API 概览

所有返回格式：

```json
{
  "data": {}
}
```

错误返回：

```json
{
  "error": {
    "code": "permission_denied",
    "message": "权限不足"
  }
}
```

## 认证

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

登录成功后把 `sessionId` 放到 `Authorization: Bearer <sessionId>`。

## Dashboard

- `GET /api/dashboard`
- `GET /api/health`

## Buckets

- `GET /api/buckets`
- `POST /api/buckets`
- `PATCH /api/buckets/{bucket}/visibility`
- `DELETE /api/buckets/{bucket}`

## Users

- `GET /api/users`
- `POST /api/users`
- `GET /api/users/{user}`
- `PATCH /api/users/{user}/status`
- `DELETE /api/users/{user}?mode=safe|force`
- `PUT /api/users/{user}/bucket-permissions`

## Groups

- `GET /api/groups`
- `POST /api/groups`
- `DELETE /api/groups/{group}`
- `PUT /api/groups/{group}/members`
- `PUT /api/groups/{group}/bucket-permissions`

## Access Keys

- `GET /api/users/{user}/access-keys`
- `POST /api/users/{user}/access-keys`
- `PATCH /api/users/{user}/access-keys/{key}`
- `DELETE /api/users/{user}/access-keys/{key}`

## Audit

- `GET /api/audit-logs`
