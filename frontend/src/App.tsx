import './App.css'
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { api, ApiError } from './lib/api'
import type {
  AccessKeySummary,
  AuditLog,
  BucketInfo,
  BucketVisibility,
  DashboardInfo,
  GroupSummary,
  PermissionBinding,
  PermissionTemplate,
  SessionData,
  UserSummary,
} from './lib/types'

type TabKey = 'dashboard' | 'buckets' | 'users' | 'groups' | 'audit'

const tabs: { key: TabKey; label: string }[] = [
  { key: 'dashboard', label: '概览' },
  { key: 'buckets', label: 'Buckets' },
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'audit', label: 'Audit' },
]

const permissionOptions: { value: PermissionTemplate; label: string }[] = [
  { value: 'none', label: 'No Access' },
  { value: 'read_only', label: 'Read Only' },
  { value: 'read_write', label: 'Read / Write' },
  { value: 'read_write_delete', label: 'Read / Write / Delete' },
]

const tokenKey = 'minio-manager-web:session'

function App() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [dashboard, setDashboard] = useState<DashboardInfo | null>(null)
  const [buckets, setBuckets] = useState<BucketInfo[]>([])
  const [users, setUsers] = useState<UserSummary[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [audits, setAudits] = useState<AuditLog[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedGroup, setSelectedGroup] = useState('')
  const [accessKeys, setAccessKeys] = useState<AccessKeySummary[]>([])
  const [latestSecret, setLatestSecret] = useState<{ accessKey: string; secretKey: string } | null>(null)
  const [bucketName, setBucketName] = useState('')
  const [newUser, setNewUser] = useState({ name: '', password: '' })
  const [newGroupName, setNewGroupName] = useState('')
  const [newAccessKey, setNewAccessKey] = useState({ name: '', description: '' })
  const [groupMembersDraft, setGroupMembersDraft] = useState('')
  const [userPermissionDraft, setUserPermissionDraft] = useState<Record<string, PermissionTemplate>>({})
  const [groupPermissionDraft, setGroupPermissionDraft] = useState<Record<string, PermissionTemplate>>({})
  const [userSearch, setUserSearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const deferredUserSearch = useDeferredValue(userSearch)
  const deferredGroupSearch = useDeferredValue(groupSearch)

  const filteredUsers = useMemo(
    () => users.filter((item) => item.name.toLowerCase().includes(deferredUserSearch.toLowerCase())),
    [users, deferredUserSearch],
  )
  const filteredGroups = useMemo(
    () => groups.filter((item) => item.name.toLowerCase().includes(deferredGroupSearch.toLowerCase())),
    [groups, deferredGroupSearch],
  )

  const currentUser = useMemo(
    () => users.find((item) => item.name === selectedUser) ?? null,
    [users, selectedUser],
  )
  const currentGroup = useMemo(
    () => groups.find((item) => item.name === selectedGroup) ?? null,
    [groups, selectedGroup],
  )

  useEffect(() => {
    const stored = window.localStorage.getItem(tokenKey)
    if (!stored) return
    try {
      setSession(JSON.parse(stored) as SessionData)
    } catch {
      window.localStorage.removeItem(tokenKey)
    }
  }, [])

  const handleApiError = useCallback((error: unknown) => {
    if (error instanceof ApiError) {
      notify('error', error.payload.message)
      if (error.payload.code === 'unauthorized') {
        rememberSession(null)
      }
      return
    }
    notify('error', '发生了未预期错误')
  }, [])

  const refreshAll = useCallback(async (token = session?.sessionId) => {
    if (!token) return
    setBusy(true)
    try {
      const [dashboardData, bucketData, userData, groupData, auditData] = await Promise.all([
        api.dashboard(token),
        api.buckets(token),
        api.users(token),
        api.groups(token),
        api.auditLogs(token),
      ])
      setDashboard(dashboardData)
      setBuckets(bucketData)
      setUsers(userData)
      setGroups(groupData)
      setAudits(auditData)
      if (!selectedUser && userData[0]) setSelectedUser(userData[0].name)
      if (!selectedGroup && groupData[0]) setSelectedGroup(groupData[0].name)
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }, [handleApiError, selectedGroup, selectedUser, session?.sessionId])

  useEffect(() => {
    if (!session) return
    void refreshAll(session.sessionId)
  }, [refreshAll, session])

  useEffect(() => {
    if (currentUser) {
      setUserPermissionDraft(bindingsToMap(currentUser.directPermissions))
    }
  }, [currentUser])

  useEffect(() => {
    if (currentGroup) {
      setGroupMembersDraft(currentGroup.members.join(', '))
      setGroupPermissionDraft(bindingsToMap(currentGroup.permissions))
    }
  }, [currentGroup])

  useEffect(() => {
    if (!session?.sessionId || !selectedUser) {
      setAccessKeys([])
      return
    }
    void api.accessKeys(session.sessionId, selectedUser).then(setAccessKeys).catch(handleApiError)
  }, [handleApiError, selectedUser, session])

  function rememberSession(next: SessionData | null) {
    setSession(next)
    if (next) {
      window.localStorage.setItem(tokenKey, JSON.stringify(next))
    } else {
      window.localStorage.removeItem(tokenKey)
    }
  }

  function notify(tone: 'ok' | 'error', text: string) {
    setMessage({ tone, text })
    window.setTimeout(() => setMessage(null), 3500)
  }

  async function runDangerous(action: (confirmationToken?: string) => Promise<unknown>) {
    try {
      await action()
    } catch (error) {
      if (error instanceof ApiError && error.payload.confirmationRequest) {
        const ok = window.confirm(`${error.payload.confirmationRequest.summary}\n\n确认后继续。`)
        if (!ok) return
        await action(error.payload.confirmationRequest.token)
        return
      }
      throw error
    }
  }

  async function submitLogin(formData: FormData) {
    const username = String(formData.get('username') || '')
    const password = String(formData.get('password') || '')
    setBusy(true)
    try {
      const result = await api.login(username, password)
      rememberSession(result)
      notify('ok', '登录成功')
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    if (session) {
      try {
        await api.logout(session.sessionId)
      } catch {
        // ignore
      }
    }
    rememberSession(null)
  }

  async function createBucket() {
    if (!session || !bucketName.trim()) return
    setBusy(true)
    try {
      await api.createBucket(session.sessionId, bucketName.trim())
      setBucketName('')
      notify('ok', '桶已创建')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function setVisibility(bucket: string, visibility: BucketVisibility) {
    if (!session) return
    setBusy(true)
    try {
      await api.setBucketVisibility(session.sessionId, bucket, visibility)
      notify('ok', `${bucket} 已更新为 ${visibility}`)
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function deleteBucket(bucket: string) {
    if (!session) return
    setBusy(true)
    try {
      await runDangerous((token) => api.deleteBucket(session.sessionId, bucket, token))
      notify('ok', '桶已删除')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function createUser() {
    if (!session || !newUser.name || !newUser.password) return
    setBusy(true)
    try {
      await api.createUser(session.sessionId, newUser.name, newUser.password)
      setNewUser({ name: '', password: '' })
      notify('ok', '用户已创建')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function setUserStatus(user: string, status: string) {
    if (!session) return
    setBusy(true)
    try {
      await api.setUserStatus(session.sessionId, user, status)
      notify('ok', '用户状态已更新')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function deleteUser(user: string, mode: 'safe' | 'force') {
    if (!session) return
    setBusy(true)
    try {
      await runDangerous((token) => api.deleteUser(session.sessionId, user, mode, token))
      notify('ok', '用户已删除')
      if (selectedUser === user) setSelectedUser('')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function saveUserPermissions() {
    if (!session || !currentUser) return
    setBusy(true)
    try {
      await runDangerous((token) =>
        api.updateUserPermissions(session.sessionId, currentUser.name, userPermissionDraft, token),
      )
      notify('ok', '用户桶权限已更新')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function createGroup() {
    if (!session || !newGroupName.trim()) return
    setBusy(true)
    try {
      await api.createGroup(session.sessionId, newGroupName.trim())
      setNewGroupName('')
      notify('ok', '分组已创建')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function deleteGroup(group: string) {
    if (!session) return
    setBusy(true)
    try {
      await api.deleteGroup(session.sessionId, group)
      notify('ok', '分组已删除')
      if (selectedGroup === group) setSelectedGroup('')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function saveGroupMembers() {
    if (!session || !currentGroup) return
    const members = groupMembersDraft.split(',').map((item) => item.trim()).filter(Boolean)
    setBusy(true)
    try {
      await api.updateGroupMembers(session.sessionId, currentGroup.name, members)
      notify('ok', '分组成员已更新')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function saveGroupPermissions() {
    if (!session || !currentGroup) return
    setBusy(true)
    try {
      await runDangerous((token) =>
        api.updateGroupPermissions(session.sessionId, currentGroup.name, groupPermissionDraft, token),
      )
      notify('ok', '分组桶权限已更新')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function createAccessKey() {
    if (!session || !selectedUser) return
    setBusy(true)
    try {
      const result = await api.createAccessKey(session.sessionId, selectedUser, newAccessKey.name, newAccessKey.description)
      setLatestSecret(result.credentials)
      setNewAccessKey({ name: '', description: '' })
      setAccessKeys(await api.accessKeys(session.sessionId, selectedUser))
      notify('ok', 'Access Key 已创建')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function setAccessKeyStatus(key: string, status: string) {
    if (!session || !selectedUser) return
    setBusy(true)
    try {
      await api.setAccessKeyStatus(session.sessionId, selectedUser, key, status)
      setAccessKeys(await api.accessKeys(session.sessionId, selectedUser))
      notify('ok', 'Access Key 状态已更新')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  async function deleteAccessKey(key: string) {
    if (!session || !selectedUser) return
    setBusy(true)
    try {
      await runDangerous((token) => api.deleteAccessKey(session.sessionId, selectedUser, key, token))
      setAccessKeys(await api.accessKeys(session.sessionId, selectedUser))
      notify('ok', 'Access Key 已删除')
      await refreshAll()
    } catch (error) {
      handleApiError(error)
    } finally {
      setBusy(false)
    }
  }

  if (!session) {
    return (
      <div className="login-shell">
        <div className="brand-panel">
          <p className="eyebrow">MinIO Manager Web</p>
          <h1>把 MinIO 的基础管理能力集中到一个后台里</h1>
          <p className="muted">
            管理桶 public/private、空桶删除、用户与分组、桶权限模板、Access Key 和审计日志。
          </p>
        </div>
        <form
          className="login-card"
          onSubmit={(event) => {
            event.preventDefault()
            void submitLogin(new FormData(event.currentTarget))
          }}
        >
          <h2>管理员登录</h2>
          <label>
            用户名
            <input name="username" placeholder="MinIO 用户名 / Access Key" />
          </label>
          <label>
            密码
            <input name="password" type="password" placeholder="密码 / Secret Key" />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? '登录中...' : '进入后台'}
          </button>
          {message && <div className={`notice ${message.tone}`}>{message.text}</div>}
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">MinIO Manager Web</p>
          <h2>控制台</h2>
        </div>
        <nav className="nav-list">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={tab.key === activeTab ? 'nav-item active' : 'nav-item'}
              onClick={() => startTransition(() => setActiveTab(tab.key))}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>
            <div className="muted">当前账号</div>
            <strong>{session.username}</strong>
          </div>
          <button className="ghost" onClick={() => void logout()}>
            退出
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <p className="eyebrow">Single MinIO Instance</p>
            <h1>{tabs.find((tab) => tab.key === activeTab)?.label}</h1>
          </div>
          <button className="ghost" onClick={() => void refreshAll()} disabled={busy}>
            {busy ? '刷新中...' : '刷新数据'}
          </button>
        </header>

        {message && <div className={`notice ${message.tone}`}>{message.text}</div>}

        {activeTab === 'dashboard' && (
          <section className="content-grid">
            <div className="card stats-grid">
              <StatCard label="Buckets" value={dashboard?.health.bucketCount ?? 0} />
              <StatCard label="Users" value={dashboard?.health.userCount ?? 0} />
              <StatCard label="Groups" value={dashboard?.health.groupCount ?? 0} />
              <StatCard label="Audit Logs" value={dashboard?.health.auditCount ?? 0} />
            </div>
            <div className="card">
              <div className="card-header">
                <h3>实例状态</h3>
                <span className={dashboard?.health.online ? 'chip success' : 'chip'}>ONLINE</span>
              </div>
              <p className="muted">
                服务时间：{dashboard?.health.serverTime ? formatTime(dashboard.health.serverTime) : '-'}
              </p>
            </div>
            <div className="card wide">
              <div className="card-header">
                <h3>最近操作</h3>
              </div>
              <AuditTable items={dashboard?.recentAudits ?? []} />
            </div>
          </section>
        )}

        {activeTab === 'buckets' && (
          <section className="content-grid">
            <div className="card">
              <div className="card-header">
                <h3>新建桶</h3>
              </div>
              <div className="inline-form">
                <input value={bucketName} onChange={(event) => setBucketName(event.target.value)} placeholder="bucket-name" />
                <button className="primary" onClick={() => void createBucket()}>
                  创建
                </button>
              </div>
            </div>
            <div className="card wide">
              <div className="card-header">
                <h3>桶列表</h3>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>创建时间</th>
                    <th>可见性</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr key={bucket.name}>
                      <td>{bucket.name}</td>
                      <td>{formatTime(bucket.createdAt)}</td>
                      <td>
                        <select
                          value={bucket.visibility}
                          onChange={(event) => void setVisibility(bucket.name, event.target.value as BucketVisibility)}
                        >
                          <option value="private">private</option>
                          <option value="public-read">public-read</option>
                        </select>
                      </td>
                      <td>
                        <button className="danger-link" onClick={() => void deleteBucket(bucket.name)}>
                          删除空桶
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'users' && (
          <section className="content-grid users-layout">
            <div className="card">
              <div className="card-header">
                <h3>用户</h3>
                <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="搜索用户" />
              </div>
              <div className="stack-form">
                <input value={newUser.name} onChange={(event) => setNewUser((prev) => ({ ...prev, name: event.target.value }))} placeholder="用户名" />
                <input type="password" value={newUser.password} onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))} placeholder="初始密码" />
                <button className="primary" onClick={() => void createUser()}>
                  新建用户
                </button>
              </div>
              <div className="list-panel">
                {filteredUsers.map((user) => (
                  <button key={user.name} className={user.name === selectedUser ? 'list-item active' : 'list-item'} onClick={() => setSelectedUser(user.name)}>
                    <span>{user.name}</span>
                    <span className="muted">{user.status}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card wide">
              {currentUser ? (
                <>
                  <div className="card-header">
                    <div>
                      <h3>{currentUser.name}</h3>
                      <p className="muted">分组：{currentUser.memberOf.join(', ') || '暂无'}</p>
                    </div>
                    <div className="action-row">
                      <button className="ghost" onClick={() => void setUserStatus(currentUser.name, 'enabled')}>启用</button>
                      <button className="ghost" onClick={() => void setUserStatus(currentUser.name, 'disabled')}>停用</button>
                      <button className="danger-link" onClick={() => void deleteUser(currentUser.name, 'safe')}>安全删除</button>
                      <button className="danger-link" onClick={() => void deleteUser(currentUser.name, 'force')}>强制删除</button>
                    </div>
                  </div>

                  <div className="dual-grid">
                    <PermissionEditor
                      title="直接桶权限"
                      buckets={buckets}
                      draft={userPermissionDraft}
                      setDraft={setUserPermissionDraft}
                      onSave={() => void saveUserPermissions()}
                    />
                    <div className="card subcard">
                      <div className="card-header">
                        <h3>最终权限预览</h3>
                      </div>
                      <PermissionList items={currentUser.finalPermissions} />
                    </div>
                  </div>

                  <div className="card subcard">
                    <div className="card-header">
                      <h3>Access Keys</h3>
                    </div>
                    <div className="stack-form compact">
                      <input value={newAccessKey.name} onChange={(event) => setNewAccessKey((prev) => ({ ...prev, name: event.target.value }))} placeholder="Key 名称" />
                      <input value={newAccessKey.description} onChange={(event) => setNewAccessKey((prev) => ({ ...prev, description: event.target.value }))} placeholder="描述" />
                      <button className="primary" onClick={() => void createAccessKey()}>
                        创建 Access Key
                      </button>
                    </div>
                    {latestSecret && (
                      <div className="secret-box">
                        <strong>仅展示一次</strong>
                        <code>{latestSecret.accessKey}</code>
                        <code>{latestSecret.secretKey}</code>
                      </div>
                    )}
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Access Key</th>
                          <th>状态</th>
                          <th>描述</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {accessKeys.map((item) => (
                          <tr key={item.accessKey}>
                            <td>{item.accessKey}</td>
                            <td>{item.status}</td>
                            <td>{item.description || item.name || '-'}</td>
                            <td>
                              <div className="action-row">
                                <button className="ghost" onClick={() => void setAccessKeyStatus(item.accessKey, 'on')}>启用</button>
                                <button className="ghost" onClick={() => void setAccessKeyStatus(item.accessKey, 'off')}>停用</button>
                                <button className="danger-link" onClick={() => void deleteAccessKey(item.accessKey)}>删除</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <EmptyState title="选择一个用户" description="从左侧选择用户后，可管理权限、状态和 Access Key。" />
              )}
            </div>
          </section>
        )}

        {activeTab === 'groups' && (
          <section className="content-grid users-layout">
            <div className="card">
              <div className="card-header">
                <h3>分组</h3>
                <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="搜索分组" />
              </div>
              <div className="inline-form">
                <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="新分组名" />
                <button className="primary" onClick={() => void createGroup()}>
                  创建
                </button>
              </div>
              <div className="list-panel">
                {filteredGroups.map((group) => (
                  <button key={group.name} className={group.name === selectedGroup ? 'list-item active' : 'list-item'} onClick={() => setSelectedGroup(group.name)}>
                    <span>{group.name}</span>
                    <span className="muted">{group.members.length} members</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card wide">
              {currentGroup ? (
                <>
                  <div className="card-header">
                    <div>
                      <h3>{currentGroup.name}</h3>
                      <p className="muted">状态：{currentGroup.status}</p>
                    </div>
                    <button className="danger-link" onClick={() => void deleteGroup(currentGroup.name)}>
                      删除分组
                    </button>
                  </div>
                  <div className="dual-grid">
                    <div className="card subcard">
                      <div className="card-header">
                        <h3>成员</h3>
                      </div>
                      <textarea rows={6} value={groupMembersDraft} onChange={(event) => setGroupMembersDraft(event.target.value)} placeholder="用英文逗号分隔成员名" />
                      <button className="primary" onClick={() => void saveGroupMembers()}>
                        保存成员
                      </button>
                    </div>
                    <PermissionEditor
                      title="分组桶权限"
                      buckets={buckets}
                      draft={groupPermissionDraft}
                      setDraft={setGroupPermissionDraft}
                      onSave={() => void saveGroupPermissions()}
                    />
                  </div>
                </>
              ) : (
                <EmptyState title="选择一个分组" description="从左侧选择分组后，可管理成员和桶权限模板。" />
              )}
            </div>
          </section>
        )}

        {activeTab === 'audit' && (
          <section className="content-grid">
            <div className="card wide">
              <div className="card-header">
                <h3>审计日志</h3>
              </div>
              <AuditTable items={audits} />
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PermissionEditor({
  title,
  buckets,
  draft,
  setDraft,
  onSave,
}: {
  title: string
  buckets: BucketInfo[]
  draft: Record<string, PermissionTemplate>
  setDraft: Dispatch<SetStateAction<Record<string, PermissionTemplate>>>
  onSave: () => void
}) {
  return (
    <div className="card subcard">
      <div className="card-header">
        <h3>{title}</h3>
      </div>
      <div className="permissions-grid">
        {buckets.map((bucket) => (
          <label key={bucket.name} className="permission-row">
            <span>{bucket.name}</span>
            <select
              value={draft[bucket.name] || 'none'}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  [bucket.name]: event.target.value as PermissionTemplate,
                }))
              }
            >
              {permissionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button className="primary" onClick={onSave}>
        保存权限
      </button>
    </div>
  )
}

function PermissionList({ items }: { items: PermissionBinding[] }) {
  if (items.length === 0) {
    return <p className="muted">暂无有效权限</p>
  }

  return (
    <div className="permissions-grid">
      {items.map((item) => (
        <div key={`${item.bucket}:${item.source}`} className="permission-preview">
          <strong>{item.bucket}</strong>
          <span>{item.template}</span>
          <span className="muted">{item.source}</span>
        </div>
      ))}
    </div>
  )
}

function AuditTable({ items }: { items: AuditLog[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>时间</th>
          <th>操作者</th>
          <th>动作</th>
          <th>资源</th>
          <th>结果</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id}>
            <td>{formatTime(item.createdAt)}</td>
            <td>{item.actor}</td>
            <td>{item.action}</td>
            <td>{item.resourceType}:{item.resourceId}</td>
            <td>{item.result}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
    </div>
  )
}

function bindingsToMap(bindings: PermissionBinding[]) {
  return bindings.reduce<Record<string, PermissionTemplate>>((acc, item) => {
    acc[item.bucket] = item.template
    return acc
  }, {})
}

function formatTime(value: string) {
  return new Date(value).toLocaleString()
}

export default App
