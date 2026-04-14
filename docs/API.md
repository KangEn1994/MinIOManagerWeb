# API 概览

所有成功返回：

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

高风险操作会先返回确认请求：

```json
{
  "error": {
    "code": "confirmation_required",
    "message": "需要二次确认",
    "confirmationRequest": {
      "token": "confirm_xxx",
      "summary": "即将删除用户 alice",
      "prompt": "请输入用户名继续",
      "expected": "alice",
      "expiresAt": "2026-04-15T02:00:00Z"
    }
  }
}
```

前端拿到 `token` 后，将其通过 query 或 body 中的 `confirmationToken` 再次提交即可。

## 认证

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

登录成功后，把 `sessionId` 放到 `Authorization: Bearer <sessionId>`。

当前支持登录后台的角色：

- `global_admin`
- `readonly_admin`

普通 `user` 仅作为对象存储用户存在，不允许登录当前管理后台。

## Dashboard / System

- `GET /api/dashboard`
- `GET /api/health`
- `GET /api/system/health`
- `GET /api/sessions`
- `DELETE /api/sessions/{session}`
- `GET /api/system/snapshot`
- `POST /api/system/snapshot/restore`

说明：

- `GET /api/system/health`
  - 返回实例模式、版本、Region、容量、健康检查、部署检查项
- `GET /api/sessions`
  - 返回当前后台活跃会话列表
- `DELETE /api/sessions/{session}`
  - 撤销指定后台会话
- `GET /api/system/snapshot`
  - 导出当前配置快照
- `POST /api/system/snapshot/restore`
  - 恢复配置快照
  - 如果快照里包含当前实例不存在的用户，可通过 `defaultPassword` 为其补发默认密码

## Buckets

- `GET /api/buckets`
- `POST /api/buckets`
- `GET /api/buckets/{bucket}/policy`
- `POST /api/buckets/{bucket}/policy/validate`
- `PUT /api/buckets/{bucket}/policy`
- `PATCH /api/buckets/{bucket}/visibility`
- `DELETE /api/buckets/{bucket}`

`visibility` 当前支持：

- `private`
- `public-read`
- `custom`

说明：

- `PATCH /api/buckets/{bucket}/visibility`
  - 用于快速切换 `private` 和 `public-read`
  - 当传入 `custom` 时，前端应引导到原始策略编辑流程
- `GET /api/buckets/{bucket}/policy`
  - 返回格式化后的原始桶策略 JSON
- `POST /api/buckets/{bucket}/policy/validate`
  - 用于提交策略 JSON 并获得校验结果、警告和标准化后的 JSON
- `PUT /api/buckets/{bucket}/policy`
  - 允许直接提交原始 JSON 策略
  - 提交空字符串表示清空策略并恢复为 `private`

## Users

- `GET /api/users`
- `POST /api/users`
- `GET /api/users/{user}`
- `GET /api/users/{user}/dependencies`
- `GET /api/users/{user}/effective-permissions`
- `PATCH /api/users/{user}/status`
- `DELETE /api/users/{user}?mode=safe|force`
- `PUT /api/users/{user}/bucket-permissions`
- `PUT /api/users/batch/bucket-permissions`

创建用户请求体：

```json
{
  "name": "alice",
  "password": "secret123",
  "role": "global_admin"
}
```

`role` 支持：

- `user`
- `global_admin`
- `readonly_admin`

说明：

- `GET /api/users/{user}/dependencies`
  - 返回用户删除前的依赖摘要，例如所属分组、Access Keys、直接策略
- `GET /api/users/{user}/effective-permissions`
  - 汇总展示用户直接授权、分组继承和最终生效结果
- `PUT /api/users/batch/bucket-permissions`
  - 批量覆盖多个用户的桶权限模板

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

Access Key 创建成功后，Secret Key 仅在创建响应中返回一次。

## Audit

- `GET /api/audit-logs`
- `GET /api/audit-logs/export`

`GET /api/audit-logs` / `GET /api/audit-logs/export` 支持以下筛选参数：

- `actor`
- `action`
- `resourceType`
- `result`
- `query`
- `limit`

导出接口还支持：

- `format=json|csv`
