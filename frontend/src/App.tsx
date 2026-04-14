import './App.css'
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { api, ApiError } from './lib/api'
import type {
  AccessKeySummary,
  AdminRole,
  AuditLog,
  BucketInfo,
  BucketPolicy,
  BucketVisibility,
  ConfigSnapshot,
  ConfirmationRequest,
  DashboardInfo,
  EffectivePermissionRow,
  GroupSummary,
  PermissionBinding,
  PermissionTemplate,
  PolicyValidationResult,
  SessionData,
  SessionInfo,
  SystemHealth,
  UserDependencyDetails,
  UserSummary,
} from './lib/types'

type TabKey = 'dashboard' | 'buckets' | 'users' | 'groups' | 'audit'
type UserDetailTab = 'permissions' | 'access_keys' | 'dependencies' | 'audit'
type AuditRange = 'all' | '1h' | 'today' | '7d'
type NotificationTone = 'ok' | 'error' | 'info'
type DialogTone = 'danger' | 'warning' | 'neutral'
type PaneMode = 'list' | 'detail'

interface NotificationItem {
  id: number
  tone: NotificationTone
  text: string
  sticky: boolean
}

interface DialogState {
  title: string
  description: string
  tone: DialogTone
  confirmLabel: string
  cancelLabel?: string
  expected?: string
  prompt?: string
  busy?: boolean
  onConfirm: (input: string) => Promise<void> | void
}

const tabs: { key: TabKey; label: string }[] = [
  { key: 'dashboard', label: '概览' },
  { key: 'buckets', label: 'Buckets' },
  { key: 'users', label: 'Users' },
  { key: 'groups', label: 'Groups' },
  { key: 'audit', label: 'Audit' },
]

const userDetailTabs: { key: UserDetailTab; label: string }[] = [
  { key: 'permissions', label: '权限' },
  { key: 'access_keys', label: 'Access Keys' },
  { key: 'dependencies', label: '依赖' },
  { key: 'audit', label: '审计' },
]

const permissionOptions: { value: PermissionTemplate; label: string }[] = [
  { value: 'none', label: 'No Access' },
  { value: 'read_only', label: 'Read Only' },
  { value: 'read_write', label: 'Read / Write' },
  { value: 'read_write_delete', label: 'Read / Write / Delete' },
]

const roleOptions: { value: AdminRole; label: string; description: string }[] = [
  { value: 'user', label: '普通用户', description: '默认对象存储用户，不可登录管理后台。' },
  { value: 'global_admin', label: '全局管理员', description: '可登录后台并执行所有管理操作。' },
  { value: 'readonly_admin', label: '只读管理员', description: '可登录后台查看信息，但不可执行写操作。' },
]

const auditRangeOptions: { value: AuditRange; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: '1h', label: '最近 1 小时' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '最近 7 天' },
]

const tokenKey = 'minio-manager-web:session'

function App() {
  const [session, setSession] = useState<SessionData | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [dashboard, setDashboard] = useState<DashboardInfo | null>(null)
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [sessions, setSessions] = useState<SessionInfo[]>([])

  const [buckets, setBuckets] = useState<BucketInfo[]>([])
  const [bucketName, setBucketName] = useState('')
  const [editingBucketPolicy, setEditingBucketPolicy] = useState<BucketPolicy | null>(null)
  const [bucketPolicyDraft, setBucketPolicyDraft] = useState('')
  const [bucketPolicyValidation, setBucketPolicyValidation] = useState<PolicyValidationResult | null>(null)

  const [users, setUsers] = useState<UserSummary[]>([])
  const [selectedUser, setSelectedUser] = useState('')
  const [userPaneMode, setUserPaneMode] = useState<PaneMode>('list')
  const [userDetailTab, setUserDetailTab] = useState<UserDetailTab>('permissions')
  const [accessKeys, setAccessKeys] = useState<AccessKeySummary[]>([])
  const [latestSecret, setLatestSecret] = useState<{ accessKey: string; secretKey: string } | null>(null)
  const [userDependencies, setUserDependencies] = useState<UserDependencyDetails | null>(null)
  const [effectivePermissions, setEffectivePermissions] = useState<EffectivePermissionRow[]>([])
  const [userAudits, setUserAudits] = useState<AuditLog[]>([])
  const [newUser, setNewUser] = useState<{ name: string; password: string; role: AdminRole }>({
    name: '',
    password: '',
    role: 'user',
  })
  const [userRoleDraft, setUserRoleDraft] = useState<AdminRole>('user')
  const [userSearch, setUserSearch] = useState('')
  const [userPermissionDraft, setUserPermissionDraft] = useState<Record<string, PermissionTemplate>>({})
  const [batchUserTargets, setBatchUserTargets] = useState('')
  const [newAccessKey, setNewAccessKey] = useState({ name: '', description: '' })

  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [selectedGroup, setSelectedGroup] = useState('')
  const [groupPaneMode, setGroupPaneMode] = useState<PaneMode>('list')
  const [groupSearch, setGroupSearch] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [groupMembersDraft, setGroupMembersDraft] = useState('')
  const [groupPermissionDraft, setGroupPermissionDraft] = useState<Record<string, PermissionTemplate>>({})

  const [audits, setAudits] = useState<AuditLog[]>([])
  const [auditFilters, setAuditFilters] = useState({
    actor: '',
    action: '',
    resourceType: '',
    result: '',
    query: '',
    range: 'all' as AuditRange,
  })

  const [snapshotDraft, setSnapshotDraft] = useState('')
  const [snapshotDefaultPassword, setSnapshotDefaultPassword] = useState('')

  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [dialogInput, setDialogInput] = useState('')
  const [loadingKeys, setLoadingKeys] = useState<Record<string, boolean>>({})

  const deferredUserSearch = useDeferredValue(userSearch)
  const deferredGroupSearch = useDeferredValue(groupSearch)
  const canWrite = session?.role !== 'readonly_admin'

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

  const currentRoleLabel = roleOptions.find((item) => item.value === session?.role)?.label ?? session?.role ?? '-'

  const currentUserPermissionDiff = useMemo(
    () => summarizePermissionDiff(currentUser?.directPermissions ?? [], userPermissionDraft),
    [currentUser, userPermissionDraft],
  )

  const currentGroupPermissionDiff = useMemo(
    () => summarizePermissionDiff(currentGroup?.permissions ?? [], groupPermissionDraft),
    [currentGroup, groupPermissionDraft],
  )

  const bucketPolicyDiff = useMemo(
    () => buildLineDiff(editingBucketPolicy?.policy ?? '', bucketPolicyDraft),
    [editingBucketPolicy, bucketPolicyDraft],
  )

  const groupMembersDirty = useMemo(
    () => !sameStringSet(parseCommaList(groupMembersDraft), currentGroup?.members ?? []),
    [currentGroup, groupMembersDraft],
  )

  const isUserDirty = currentUserPermissionDiff.length > 0
  const isGroupDirty = groupMembersDirty || currentGroupPermissionDiff.length > 0
  const isBucketPolicyDirty = Boolean(editingBucketPolicy && editingBucketPolicy.policy !== bucketPolicyDraft)

  const visibleAudits = useMemo(
    () => filterAuditsByRange(audits, auditFilters.range),
    [audits, auditFilters.range],
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

  useEffect(() => {
    const hasUnsaved = isUserDirty || isGroupDirty || isBucketPolicyDirty
    if (!hasUnsaved) return

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isBucketPolicyDirty, isGroupDirty, isUserDirty])

  useEffect(() => {
    if (!session) return
    if (activeTab === 'dashboard') void loadDashboard()
    if (activeTab === 'buckets') void loadBuckets()
    if (activeTab === 'users') void loadUsersPage()
    if (activeTab === 'groups') void loadGroupsPage()
    if (activeTab === 'audit') void loadAuditPage()
  }, [activeTab, session])

  useEffect(() => {
    if (!selectedUser && users[0]) {
      setSelectedUser(users[0].name)
      return
    }
    if (selectedUser && !users.some((item) => item.name === selectedUser)) {
      setSelectedUser(users[0]?.name ?? '')
      if (users.length === 0) {
        setUserPaneMode('list')
      }
    }
  }, [selectedUser, users])

  useEffect(() => {
    if (!selectedGroup && groups[0]) {
      setSelectedGroup(groups[0].name)
      return
    }
    if (selectedGroup && !groups.some((item) => item.name === selectedGroup)) {
      setSelectedGroup(groups[0]?.name ?? '')
      if (groups.length === 0) {
        setGroupPaneMode('list')
      }
    }
  }, [groups, selectedGroup])

  useEffect(() => {
    if (!currentUser) {
      setAccessKeys([])
      setUserDependencies(null)
      setEffectivePermissions([])
      setUserAudits([])
      return
    }
    setUserPermissionDraft(bindingsToMap(currentUser.directPermissions))
    setUserRoleDraft(currentUser.role)
  }, [currentUser])

  useEffect(() => {
    if (!currentGroup) {
      setGroupMembersDraft('')
      setGroupPermissionDraft({})
      return
    }
    setGroupMembersDraft((currentGroup.members ?? []).join(', '))
    setGroupPermissionDraft(bindingsToMap(currentGroup.permissions))
  }, [currentGroup])

  useEffect(() => {
    if (!session?.sessionId || activeTab !== 'users' || !selectedUser) return
    void loadUserDetails(selectedUser, userDetailTab === 'audit')
  }, [activeTab, selectedUser, session?.sessionId, userDetailTab])

  function rememberSession(next: SessionData | null) {
    setSession(next)
    if (next) {
      window.localStorage.setItem(tokenKey, JSON.stringify(next))
    } else {
      window.localStorage.removeItem(tokenKey)
    }
  }

  function pushNotification(tone: NotificationTone, text: string, options?: { sticky?: boolean }) {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    const sticky = options?.sticky ?? tone === 'error'
    setNotifications((prev) => [...prev, { id, tone, text, sticky }])
    if (!sticky) {
      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((item) => item.id !== id))
      }, 3200)
    }
  }

  function dismissNotification(id: number) {
    setNotifications((prev) => prev.filter((item) => item.id !== id))
  }

  function openDialog(next: DialogState) {
    setDialog(next)
    setDialogInput('')
  }

  async function submitDialog() {
    if (!dialog) return
    if (dialog.expected && dialogInput.trim() !== dialog.expected) {
      pushNotification('error', `输入内容不匹配，预期为 ${dialog.expected}`, { sticky: true })
      return
    }

    setDialog((prev) => (prev ? { ...prev, busy: true } : prev))
    try {
      await dialog.onConfirm(dialogInput.trim())
      setDialog((current) => (current === dialog ? null : current))
      setDialogInput('')
    } catch (error) {
      handleApiError(error)
      setDialog((prev) => (prev ? { ...prev, busy: false } : prev))
    }
  }

  async function withLoading<T>(key: string, task: () => Promise<T>): Promise<T> {
    setLoadingKeys((prev) => ({ ...prev, [key]: true }))
    try {
      return await task()
    } finally {
      setLoadingKeys((prev) => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    }
  }

  function isLoading(key: string) {
    return Boolean(loadingKeys[key])
  }

  function handleApiError(error: unknown) {
    if (error instanceof ApiError) {
      pushNotification('error', error.payload.message, { sticky: true })
      if (error.payload.code === 'unauthorized') {
        rememberSession(null)
      }
      return
    }
    pushNotification('error', '发生了未预期错误', { sticky: true })
  }

  function resetUserDraft() {
    if (currentUser) {
      setUserPermissionDraft(bindingsToMap(currentUser.directPermissions))
    }
    setBatchUserTargets('')
  }

  function resetGroupDraft() {
    if (currentGroup) {
      setGroupMembersDraft((currentGroup.members ?? []).join(', '))
      setGroupPermissionDraft(bindingsToMap(currentGroup.permissions))
    }
  }

  function resetBucketDraft() {
    if (editingBucketPolicy) {
      setBucketPolicyDraft(editingBucketPolicy.policy)
      setBucketPolicyValidation(null)
    }
  }

  function confirmDiscardChanges(description: string, onConfirm: () => void) {
    openDialog({
      title: '放弃未保存改动？',
      description,
      tone: 'warning',
      confirmLabel: '放弃更改',
      cancelLabel: '继续编辑',
      onConfirm: async () => {
        onConfirm()
      },
    })
  }

  function guardCurrentUnsaved(onContinue: () => void) {
    if (activeTab === 'users' && isUserDirty) {
      confirmDiscardChanges('当前用户权限草稿尚未保存，切换后会丢失。', () => {
        resetUserDraft()
        onContinue()
      })
      return
    }
    if (activeTab === 'groups' && isGroupDirty) {
      confirmDiscardChanges('当前分组成员或权限草稿尚未保存，切换后会丢失。', () => {
        resetGroupDraft()
        onContinue()
      })
      return
    }
    if (activeTab === 'buckets' && isBucketPolicyDirty) {
      confirmDiscardChanges('当前桶策略草稿尚未保存，切换后会丢失。', () => {
        resetBucketDraft()
        onContinue()
      })
      return
    }
    onContinue()
  }

  function requestTabChange(nextTab: TabKey) {
    if (nextTab === activeTab) {
      setSidebarOpen(false)
      return
    }
    guardCurrentUnsaved(() => {
      startTransition(() => setActiveTab(nextTab))
      setSidebarOpen(false)
    })
  }

  function requestLogout() {
    guardCurrentUnsaved(() => {
      void logout()
    })
  }

  function requestUserSelection(nextUser: string) {
    const proceed = () => {
      setSelectedUser(nextUser)
      setUserPaneMode('detail')
      setUserDetailTab('permissions')
    }
    if (nextUser === selectedUser) {
      proceed()
      return
    }
    if (isUserDirty) {
      confirmDiscardChanges('当前用户权限草稿尚未保存，切换用户后会丢失。', () => {
        resetUserDraft()
        proceed()
      })
      return
    }
    proceed()
  }

  function requestGroupSelection(nextGroup: string) {
    const proceed = () => {
      setSelectedGroup(nextGroup)
      setGroupPaneMode('detail')
    }
    if (nextGroup === selectedGroup) {
      proceed()
      return
    }
    if (isGroupDirty) {
      confirmDiscardChanges('当前分组成员或权限草稿尚未保存，切换分组后会丢失。', () => {
        resetGroupDraft()
        proceed()
      })
      return
    }
    proceed()
  }

  function requestOpenBucketPolicy(bucket: string) {
    const proceed = () => {
      void openBucketPolicyEditor(bucket)
    }
    if (editingBucketPolicy && editingBucketPolicy.bucket !== bucket && isBucketPolicyDirty) {
      confirmDiscardChanges('当前桶策略草稿尚未保存，切换桶后会丢失。', () => {
        resetBucketDraft()
        proceed()
      })
      return
    }
    proceed()
  }

  function openDangerDialog(
    confirmation: ConfirmationRequest,
    options: {
      title: string
      confirmLabel: string
      onConfirm: (token: string) => Promise<void>
    },
  ) {
    openDialog({
      title: options.title,
      description: confirmation.summary,
      tone: 'danger',
      confirmLabel: options.confirmLabel,
      cancelLabel: '取消',
      expected: confirmation.expected,
      prompt: confirmation.prompt,
      onConfirm: async () => {
        await options.onConfirm(confirmation.token)
      },
    })
  }

  async function performConfirmableMutation(options: {
    actionKey: string
    title: string
    confirmLabel: string
    successMessage: string
    run: (confirmationToken?: string) => Promise<void>
    afterSuccess?: () => Promise<void> | void
    onError?: (error: ApiError) => void
  }) {
    const execute = async (confirmationToken?: string) => {
      await withLoading(options.actionKey, async () => {
        await options.run(confirmationToken)
      })
      pushNotification('ok', options.successMessage)
      await options.afterSuccess?.()
    }

    try {
      await execute()
    } catch (error) {
      if (error instanceof ApiError && error.payload.confirmationRequest) {
        openDangerDialog(error.payload.confirmationRequest, {
          title: options.title,
          confirmLabel: options.confirmLabel,
          onConfirm: execute,
        })
        return
      }
      if (error instanceof ApiError) {
        options.onError?.(error)
      }
      handleApiError(error)
    }
  }

  async function loadDashboard() {
    if (!session?.sessionId) return
    try {
      const [dashboardData, healthData, sessionData] = await withLoading('section:dashboard', async () =>
        Promise.all([
          api.dashboard(session.sessionId),
          api.systemHealth(session.sessionId),
          api.sessions(session.sessionId),
        ]),
      )
      setDashboard(dashboardData)
      setSystemHealth(healthData)
      setSessions(sessionData)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function loadBuckets() {
    if (!session?.sessionId) return
    try {
      const bucketData = await withLoading('section:buckets', async () => api.buckets(session.sessionId))
      setBuckets(bucketData)
      if (editingBucketPolicy && !bucketData.some((item) => item.name === editingBucketPolicy.bucket)) {
        setEditingBucketPolicy(null)
        setBucketPolicyDraft('')
        setBucketPolicyValidation(null)
      }
    } catch (error) {
      handleApiError(error)
    }
  }

  async function loadUsersPage() {
    if (!session?.sessionId) return
    try {
      const [userData, bucketData] = await withLoading('section:users', async () =>
        Promise.all([api.users(session.sessionId), api.buckets(session.sessionId)]),
      )
      setUsers(userData)
      setBuckets(bucketData)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function loadGroupsPage() {
    if (!session?.sessionId) return
    try {
      const [groupData, bucketData] = await withLoading('section:groups', async () =>
        Promise.all([api.groups(session.sessionId), api.buckets(session.sessionId)]),
      )
      setGroups(groupData)
      setBuckets(bucketData)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function loadUserDetails(user: string, includeAudit: boolean) {
    if (!session?.sessionId) return
    try {
      const [keys, dependencies, effective, scopedAudits] = await withLoading(`section:user:${user}`, async () =>
        Promise.all([
          api.accessKeys(session.sessionId, user),
          api.userDependencies(session.sessionId, user),
          api.effectivePermissions(session.sessionId, user),
          includeAudit ? api.auditLogs(session.sessionId, buildAuditParams({ query: user, limit: 50 })) : Promise.resolve([]),
        ]),
      )
      setAccessKeys(keys)
      setUserDependencies(dependencies)
      setEffectivePermissions(effective)
      if (includeAudit) {
        setUserAudits(scopedAudits)
      }
    } catch (error) {
      handleApiError(error)
    }
  }

  async function loadAuditPage() {
    if (!session?.sessionId) return
    try {
      const auditData = await withLoading('section:audit', async () =>
        api.auditLogs(session.sessionId, buildAuditParams({ ...auditFilters, limit: 500 })),
      )
      setAudits(auditData)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function refreshCurrentTab() {
    if (activeTab === 'dashboard') {
      await loadDashboard()
      return
    }
    if (activeTab === 'buckets') {
      await loadBuckets()
      return
    }
    if (activeTab === 'users') {
      await loadUsersPage()
      if (selectedUser) {
        await loadUserDetails(selectedUser, userDetailTab === 'audit')
      }
      return
    }
    if (activeTab === 'groups') {
      await loadGroupsPage()
      return
    }
    await loadAuditPage()
  }

  async function submitLogin(formData: FormData) {
    const username = String(formData.get('username') || '')
    const password = String(formData.get('password') || '')
    try {
      const result = await withLoading('action:login', async () => api.login(username, password))
      rememberSession(result)
      pushNotification('ok', '登录成功')
    } catch (error) {
      handleApiError(error)
    }
  }

  async function logout() {
    if (session) {
      try {
        await withLoading('action:logout', async () => api.logout(session.sessionId))
      } catch {
        // ignore
      }
    }
    rememberSession(null)
  }

  async function createBucket() {
    if (!session?.sessionId || !bucketName.trim() || !canWrite) return
    try {
      await withLoading('action:create-bucket', async () => api.createBucket(session.sessionId, bucketName.trim()))
      pushNotification('ok', '桶已创建')
      setBucketName('')
      await loadBuckets()
    } catch (error) {
      handleApiError(error)
    }
  }

  async function openBucketPolicyEditor(bucket: string) {
    if (!session?.sessionId) return
    try {
      const policy = await withLoading(`action:bucket-policy:${bucket}`, async () =>
        api.bucketPolicy(session.sessionId, bucket),
      )
      setEditingBucketPolicy(policy)
      setBucketPolicyDraft(policy.policy)
      setBucketPolicyValidation(null)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function validateCurrentBucketPolicy() {
    if (!session?.sessionId || !editingBucketPolicy) return null
    try {
      const validation = await withLoading(`action:validate-policy:${editingBucketPolicy.bucket}`, async () =>
        api.validateBucketPolicy(session.sessionId, editingBucketPolicy.bucket, bucketPolicyDraft),
      )
      setBucketPolicyValidation(validation)
      return validation
    } catch (error) {
      handleApiError(error)
      return null
    }
  }

  async function saveBucketPolicy() {
    if (!session?.sessionId || !editingBucketPolicy || !canWrite) return

    const validation = await validateCurrentBucketPolicy()
    if (!validation?.valid) {
      pushNotification('error', '桶策略校验失败，请先修正 JSON', { sticky: true })
      return
    }

    const diff = summarizeLineDiff(bucketPolicyDiff)
    openDialog({
      title: '保存桶策略',
      description: diff
        ? `即将更新桶 ${editingBucketPolicy.bucket} 的策略。\n\n${diff}`
        : `即将保存桶 ${editingBucketPolicy.bucket} 的策略。`,
      tone: 'warning',
      confirmLabel: '保存策略',
      cancelLabel: '取消',
      onConfirm: async () => {
        await withLoading(`action:save-policy:${editingBucketPolicy.bucket}`, async () =>
          api.updateBucketPolicy(session.sessionId, editingBucketPolicy.bucket, validation.normalizedJson),
        )
        const policy = await api.bucketPolicy(session.sessionId, editingBucketPolicy.bucket)
        setEditingBucketPolicy(policy)
        setBucketPolicyDraft(policy.policy)
        setBucketPolicyValidation(null)
        pushNotification('ok', '桶策略已更新')
        await loadBuckets()
      },
    })
  }

  async function setVisibility(bucket: string, visibility: Extract<BucketVisibility, 'private' | 'public-read'>) {
    if (!session?.sessionId || !canWrite) return
    try {
      await withLoading(`action:bucket-visibility:${bucket}:${visibility}`, async () =>
        api.setBucketVisibility(session.sessionId, bucket, visibility),
      )
      pushNotification('ok', `${bucket} 已更新为 ${visibility}`)
      await loadBuckets()
      if (editingBucketPolicy?.bucket === bucket) {
        await openBucketPolicyEditor(bucket)
      }
    } catch (error) {
      handleApiError(error)
    }
  }

  async function deleteBucket(bucket: string) {
    if (!session?.sessionId || !canWrite) return
    await performConfirmableMutation({
      actionKey: `action:delete-bucket:${bucket}`,
      title: '删除空桶',
      confirmLabel: '删除桶',
      successMessage: '桶已删除',
      run: async (confirmationToken) => {
        await api.deleteBucket(session.sessionId, bucket, confirmationToken)
      },
      afterSuccess: async () => {
        if (editingBucketPolicy?.bucket === bucket) {
          setEditingBucketPolicy(null)
          setBucketPolicyDraft('')
          setBucketPolicyValidation(null)
        }
        await loadBuckets()
      },
    })
  }

  async function createUser() {
    const name = newUser.name.trim()
    if (!session?.sessionId || !name || !newUser.password || !canWrite) return
    try {
      await withLoading('action:create-user', async () =>
        api.createUser(session.sessionId, name, newUser.password, newUser.role),
      )
      pushNotification('ok', '用户已创建')
      setNewUser({ name: '', password: '', role: 'user' })
      await loadUsersPage()
      setSelectedUser(name)
      setUserPaneMode('detail')
    } catch (error) {
      handleApiError(error)
    }
  }

  async function setUserStatus(user: string, status: string) {
    if (!session?.sessionId || !canWrite) return
    try {
      await withLoading(`action:user-status:${user}:${status}`, async () =>
        api.setUserStatus(session.sessionId, user, status),
      )
      pushNotification('ok', '用户状态已更新')
      await loadUsersPage()
    } catch (error) {
      handleApiError(error)
    }
  }

  async function saveUserRole() {
    if (!session?.sessionId || !currentUser || !canWrite) return
    if (userRoleDraft === currentUser.role) {
      pushNotification('info', '角色没有变化')
      return
    }
    openDialog({
      title: '更新用户角色',
      description: `将把用户 ${currentUser.name} 的角色从 ${roleLabel(currentUser.role)} 调整为 ${roleLabel(userRoleDraft)}。`,
      tone: 'warning',
      confirmLabel: '更新角色',
      cancelLabel: '取消',
      onConfirm: async () => {
        await withLoading(`action:user-role:${currentUser.name}`, async () =>
          api.setUserRole(session.sessionId, currentUser.name, userRoleDraft),
        )
        pushNotification('ok', '用户角色已更新')
        await loadUsersPage()
        await loadUserDetails(currentUser.name, userDetailTab === 'audit')
      },
    })
  }

  async function deleteUser(user: string, mode: 'safe' | 'force') {
    if (!session?.sessionId || !canWrite) return
    await performConfirmableMutation({
      actionKey: `action:delete-user:${user}:${mode}`,
      title: mode === 'force' ? '强制删除用户' : '安全删除用户',
      confirmLabel: mode === 'force' ? '强制删除' : '确认删除',
      successMessage: '用户已删除',
      run: async (confirmationToken) => {
        await api.deleteUser(session.sessionId, user, mode, confirmationToken)
      },
      afterSuccess: async () => {
        if (selectedUser === user) {
          setSelectedUser('')
          setUserPaneMode('list')
        }
        await loadUsersPage()
      },
      onError: (error) => {
        const details = error.payload.details?.dependencies as UserDependencyDetails | undefined
        if (details) {
          setUserDependencies(details)
          setUserDetailTab('dependencies')
          setUserPaneMode('detail')
        }
      },
    })
  }

  async function saveUserPermissions() {
    if (!session?.sessionId || !currentUser || !canWrite) return
    const summary = summarizePermissionDiff(currentUser.directPermissions, userPermissionDraft)
    if (summary.length === 0) {
      pushNotification('info', '没有待保存的权限改动')
      return
    }

    openDialog({
      title: '保存用户权限',
      description: `将更新用户 ${currentUser.name} 的桶权限：\n\n${summary.join('\n')}`,
      tone: 'warning',
      confirmLabel: '保存权限',
      cancelLabel: '取消',
      onConfirm: async () => {
        await performConfirmableMutation({
          actionKey: `action:user-permissions:${currentUser.name}`,
          title: '覆盖用户桶权限',
          confirmLabel: '继续覆盖',
          successMessage: '用户桶权限已更新',
          run: async (confirmationToken) => {
            await api.updateUserPermissions(session.sessionId, currentUser.name, userPermissionDraft, confirmationToken)
          },
          afterSuccess: async () => {
            await loadUsersPage()
            await loadUserDetails(currentUser.name, userDetailTab === 'audit')
          },
        })
      },
    })
  }

  async function batchApplyUserPermissions() {
    if (!session?.sessionId || !canWrite) return
    const usersToUpdate = parseCommaList(batchUserTargets)
    if (usersToUpdate.length === 0) {
      pushNotification('error', '请先输入至少一个用户名', { sticky: true })
      return
    }

    openDialog({
      title: '批量套用权限',
      description: `将把当前权限草稿应用到以下用户：\n\n${usersToUpdate.join('\n')}`,
      tone: 'warning',
      confirmLabel: '批量应用',
      cancelLabel: '取消',
      onConfirm: async () => {
        await performConfirmableMutation({
          actionKey: 'action:batch-user-permissions',
          title: '批量覆盖用户权限',
          confirmLabel: '继续覆盖',
          successMessage: '批量用户桶权限已更新',
          run: async (confirmationToken) => {
            await api.batchUpdateUserPermissions(session.sessionId, usersToUpdate, userPermissionDraft, confirmationToken)
          },
          afterSuccess: async () => {
            setBatchUserTargets('')
            await loadUsersPage()
            if (selectedUser) {
              await loadUserDetails(selectedUser, userDetailTab === 'audit')
            }
          },
        })
      },
    })
  }

  async function createGroup() {
    if (!session?.sessionId || !newGroupName.trim() || !canWrite) return
    try {
      await withLoading('action:create-group', async () => api.createGroup(session.sessionId, newGroupName.trim()))
      pushNotification('ok', '分组已创建')
      const nextGroup = newGroupName.trim()
      setNewGroupName('')
      await loadGroupsPage()
      setSelectedGroup(nextGroup)
      setGroupPaneMode('detail')
    } catch (error) {
      handleApiError(error)
    }
  }

  async function deleteGroup(group: string) {
    if (!session?.sessionId || !canWrite) return
    openDialog({
      title: '删除分组',
      description: `即将删除分组 ${group}。如果该分组仍被用户继承权限，请先确认影响。`,
      tone: 'danger',
      confirmLabel: '删除分组',
      cancelLabel: '取消',
      onConfirm: async () => {
        await withLoading(`action:delete-group:${group}`, async () => api.deleteGroup(session.sessionId, group))
        pushNotification('ok', '分组已删除')
        if (selectedGroup === group) {
          setSelectedGroup('')
          setGroupPaneMode('list')
        }
        await loadGroupsPage()
      },
    })
  }

  async function saveGroupMembers() {
    if (!session?.sessionId || !currentGroup || !canWrite) return
    const members = parseCommaList(groupMembersDraft)
    try {
      await withLoading(`action:group-members:${currentGroup.name}`, async () =>
        api.updateGroupMembers(session.sessionId, currentGroup.name, members),
      )
      pushNotification('ok', '分组成员已更新')
      await loadGroupsPage()
    } catch (error) {
      handleApiError(error)
    }
  }

  async function saveGroupPermissions() {
    if (!session?.sessionId || !currentGroup || !canWrite) return
    const summary = summarizePermissionDiff(currentGroup.permissions, groupPermissionDraft)
    if (summary.length === 0) {
      pushNotification('info', '没有待保存的权限改动')
      return
    }

    openDialog({
      title: '保存分组权限',
      description: `将更新分组 ${currentGroup.name} 的桶权限：\n\n${summary.join('\n')}`,
      tone: 'warning',
      confirmLabel: '保存权限',
      cancelLabel: '取消',
      onConfirm: async () => {
        await performConfirmableMutation({
          actionKey: `action:group-permissions:${currentGroup.name}`,
          title: '覆盖分组桶权限',
          confirmLabel: '继续覆盖',
          successMessage: '分组桶权限已更新',
          run: async (confirmationToken) => {
            await api.updateGroupPermissions(session.sessionId, currentGroup.name, groupPermissionDraft, confirmationToken)
          },
          afterSuccess: async () => {
            await loadGroupsPage()
          },
        })
      },
    })
  }

  async function createAccessKey() {
    if (!session?.sessionId || !selectedUser || !canWrite) return
    try {
      const result = await withLoading(`action:create-access-key:${selectedUser}`, async () =>
        api.createAccessKey(session.sessionId, selectedUser, newAccessKey.name, newAccessKey.description),
      )
      setLatestSecret(result.credentials)
      setNewAccessKey({ name: '', description: '' })
      setAccessKeys(await api.accessKeys(session.sessionId, selectedUser))
      pushNotification('ok', 'Access Key 已创建')
    } catch (error) {
      handleApiError(error)
    }
  }

  async function setAccessKeyStatus(key: string, status: string) {
    if (!session?.sessionId || !selectedUser || !canWrite) return
    try {
      await withLoading(`action:access-key:${key}:${status}`, async () =>
        api.setAccessKeyStatus(session.sessionId, selectedUser, key, status),
      )
      setAccessKeys(await api.accessKeys(session.sessionId, selectedUser))
      pushNotification('ok', 'Access Key 状态已更新')
    } catch (error) {
      handleApiError(error)
    }
  }

  async function deleteAccessKey(key: string) {
    if (!session?.sessionId || !selectedUser || !canWrite) return
    await performConfirmableMutation({
      actionKey: `action:delete-access-key:${key}`,
      title: '删除 Access Key',
      confirmLabel: '删除 Key',
      successMessage: 'Access Key 已删除',
      run: async (confirmationToken) => {
        await api.deleteAccessKey(session.sessionId, selectedUser, key, confirmationToken)
      },
      afterSuccess: async () => {
        setAccessKeys(await api.accessKeys(session.sessionId, selectedUser))
      },
    })
  }

  async function revokeSession(sessionId: string) {
    if (!session?.sessionId || !canWrite) return
    openDialog({
      title: '撤销后台会话',
      description: `即将撤销会话 ${sessionId}，该登录态会立刻失效。`,
      tone: 'warning',
      confirmLabel: '撤销会话',
      cancelLabel: '取消',
      onConfirm: async () => {
        await withLoading(`action:revoke-session:${sessionId}`, async () =>
          api.revokeSession(session.sessionId, sessionId),
        )
        pushNotification('ok', '会话已撤销')
        await loadDashboard()
      },
    })
  }

  async function exportVisibleAudits(format: 'json' | 'csv') {
    const rows = visibleAudits
    if (rows.length === 0) {
      pushNotification('error', '当前没有可导出的审计记录', { sticky: true })
      return
    }

    if (format === 'json') {
      downloadBlob(
        new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json;charset=utf-8' }),
        `audit-logs-${Date.now()}.json`,
      )
      pushNotification('ok', '审计日志 JSON 已导出')
      return
    }

    const header = ['createdAt', 'actor', 'action', 'resourceType', 'resourceId', 'result', 'sourceIp', 'requestSummary']
    const csv = [header.join(',')]
    for (const item of rows) {
      csv.push(
        [
          item.createdAt,
          item.actor,
          item.action,
          item.resourceType,
          item.resourceId,
          item.result,
          item.sourceIp,
          item.requestSummary,
        ]
          .map(csvEscape)
          .join(','),
      )
    }
    downloadBlob(new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8' }), `audit-logs-${Date.now()}.csv`)
    pushNotification('ok', '审计日志 CSV 已导出')
  }

  async function exportSnapshot() {
    if (!session?.sessionId) return
    try {
      const snapshot = await withLoading('action:export-snapshot', async () => api.exportSnapshot(session.sessionId))
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json;charset=utf-8' })
      downloadBlob(blob, `minio-manager-snapshot-${Date.now()}.json`)
      pushNotification('ok', '配置快照已导出')
    } catch (error) {
      handleApiError(error)
    }
  }

  async function restoreSnapshot() {
    if (!session?.sessionId || !canWrite) return
    let parsed: ConfigSnapshot
    try {
      parsed = JSON.parse(snapshotDraft) as ConfigSnapshot
    } catch {
      pushNotification('error', '快照 JSON 解析失败', { sticky: true })
      return
    }

    await performConfirmableMutation({
      actionKey: 'action:restore-snapshot',
      title: '恢复配置快照',
      confirmLabel: '恢复快照',
      successMessage: '配置快照已恢复',
      run: async (confirmationToken) => {
        await api.restoreSnapshot(session.sessionId, parsed, snapshotDefaultPassword, confirmationToken)
      },
      afterSuccess: async () => {
        await loadDashboard()
      },
    })
  }

  function downloadCurrentSecret() {
    if (!latestSecret) return
    const content = `AccessKey=${latestSecret.accessKey}\nSecretKey=${latestSecret.secretKey}\n`
    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), `access-key-${latestSecret.accessKey}.txt`)
  }

  function handleAuditResourceClick(item: AuditLog) {
    if (item.resourceType === 'bucket') {
      guardCurrentUnsaved(() => {
        setActiveTab('buckets')
        setSidebarOpen(false)
        requestOpenBucketPolicy(item.resourceId)
      })
      return
    }
    if (item.resourceType === 'user') {
      guardCurrentUnsaved(() => {
        setActiveTab('users')
        setSidebarOpen(false)
        setSelectedUser(item.resourceId)
        setUserPaneMode('detail')
        setUserDetailTab('audit')
      })
      return
    }
    if (item.resourceType === 'group') {
      guardCurrentUnsaved(() => {
        setActiveTab('groups')
        setSidebarOpen(false)
        setSelectedGroup(item.resourceId)
        setGroupPaneMode('detail')
      })
    }
  }

  if (!session) {
    return (
      <div className="login-shell">
        <ToastStack items={notifications} onDismiss={dismissNotification} />
        <DialogModal dialog={dialog} input={dialogInput} setInput={setDialogInput} onClose={() => setDialog(null)} onConfirm={submitDialog} />
        <div className="brand-panel">
          <p className="eyebrow">MinIO Manager Web</p>
          <h1>把 MinIO 的基础管理能力集中到一个后台里</h1>
          <p className="muted">
            管理桶 private/public/custom、空桶删除、用户与分组、桶权限模板、Access Key、会话、审计日志与配置快照。
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
          <button className="primary" type="submit" disabled={isLoading('action:login')}>
            {isLoading('action:login') ? '登录中...' : '进入后台'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <ToastStack items={notifications} onDismiss={dismissNotification} />
      <DialogModal dialog={dialog} input={dialogInput} setInput={setDialogInput} onClose={() => setDialog(null)} onConfirm={submitDialog} />
      <button
        className={sidebarOpen ? 'sidebar-overlay open' : 'sidebar-overlay'}
        aria-label="关闭导航"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-stack">
          <SidebarSection title="控制台">
            <p className="eyebrow">MinIO Manager Web</p>
            <h2>控制台</h2>
            <p className="muted sidebar-note">当前角色：{currentRoleLabel}</p>
            {!canWrite && <p className="sidebar-hint">只读管理员模式下，所有写操作都会被禁用。</p>}
          </SidebarSection>

          <SidebarSection title="导航菜单">
            <nav className="nav-list">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  className={tab.key === activeTab ? 'nav-item active' : 'nav-item'}
                  onClick={() => requestTabChange(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </SidebarSection>

          <SidebarSection title="当前会话">
            <div className="sidebar-account">
              <div>
                <div className="muted">当前账号</div>
                <strong>{session.username}</strong>
              </div>
              <button className="ghost" onClick={requestLogout} disabled={isLoading('action:logout')}>
                退出
              </button>
            </div>
          </SidebarSection>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-title">
            <button className="ghost nav-toggle" onClick={() => setSidebarOpen(true)}>
              菜单
            </button>
            <div>
              <p className="eyebrow">Single MinIO Instance</p>
              <h1>{tabs.find((tab) => tab.key === activeTab)?.label}</h1>
            </div>
          </div>
          <button
            className="ghost"
            onClick={() => void refreshCurrentTab()}
            disabled={isLoading(`section:${activeTab}`)}
          >
            {isLoading(`section:${activeTab}`) ? '刷新中...' : '刷新当前页'}
          </button>
        </header>

        {activeTab === 'dashboard' && (
          <section className="content-grid">
            <SectionBlock title="实例概览" hint="把核心数字拆成一个独立条块，便于快速浏览。" className="stats-grid">
              <StatCard label="Buckets" value={dashboard?.health.bucketCount ?? 0} />
              <StatCard label="Users" value={dashboard?.health.userCount ?? 0} />
              <StatCard label="Groups" value={dashboard?.health.groupCount ?? 0} />
              <StatCard label="Audit Logs" value={dashboard?.health.auditCount ?? 0} />
            </SectionBlock>

            <SectionBlock
              title="系统健康"
              hint="实例状态、容量和部署检查分开收纳。"
              className="wide"
              trailing={<span className="chip success">{systemHealth?.mode || 'unknown'}</span>}
            >
              <div className="info-grid">
                <InfoItem label="版本" value={systemHealth?.version || '-'} />
                <InfoItem label="部署 ID" value={systemHealth?.deploymentId || '-'} />
                <InfoItem label="Region" value={systemHealth?.region || '-'} />
                <InfoItem label="原始容量" value={formatBytes(systemHealth?.storageRaw ?? 0)} />
                <InfoItem label="已用容量" value={formatBytes(systemHealth?.storageUsed ?? 0)} />
                <InfoItem label="服务器时间" value={formatTime(systemHealth?.serverTime)} />
              </div>
              <Checklist title="健康检查" items={systemHealth?.checks ?? []} />
              <Checklist title="初始化向导 / 部署检查" items={systemHealth?.setupChecklist ?? []} />
            </SectionBlock>

            <SectionBlock title="活动会话" className="wide">
              <SessionTable items={sessions} canWrite={canWrite} onRevoke={revokeSession} loadingKeys={loadingKeys} />
            </SectionBlock>

            <SectionBlock title="配置快照" className="wide">
              <div className="action-row">
                <button className="primary" disabled={!canWrite || isLoading('action:export-snapshot')} onClick={() => void exportSnapshot()}>
                  导出快照
                </button>
              </div>
              <div className="stack-form">
                <textarea
                  rows={10}
                  value={snapshotDraft}
                  onChange={(event) => setSnapshotDraft(event.target.value)}
                  placeholder="粘贴先前导出的配置快照 JSON"
                />
                <input
                  value={snapshotDefaultPassword}
                  onChange={(event) => setSnapshotDefaultPassword(event.target.value)}
                  placeholder="为快照中缺失用户设置默认密码（可选）"
                />
                <button className="primary" disabled={!canWrite || isLoading('action:restore-snapshot')} onClick={() => void restoreSnapshot()}>
                  恢复快照
                </button>
              </div>
            </SectionBlock>

            <SectionBlock title="最近操作" className="wide">
              <AuditTable items={dashboard?.recentAudits ?? []} onResourceClick={handleAuditResourceClick} />
            </SectionBlock>
          </section>
        )}

        {activeTab === 'buckets' && (
          <section className="content-grid">
            <SectionBlock title="新建桶">
              <div className="inline-form">
                <input value={bucketName} onChange={(event) => setBucketName(event.target.value)} placeholder="bucket-name" />
                <button className="primary" disabled={!canWrite || isLoading('action:create-bucket')} onClick={() => void createBucket()}>
                  创建
                </button>
              </div>
            </SectionBlock>

            <SectionBlock title="桶列表" hint="把状态展示和策略编辑拆开，减少误操作。" className="wide">
              <table className="table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>创建时间</th>
                    <th>当前可见性</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => (
                    <tr key={bucket.name} className={editingBucketPolicy?.bucket === bucket.name ? 'table-row-active' : ''}>
                      <td data-label="名称">{bucket.name}</td>
                      <td data-label="创建时间">{formatTime(bucket.createdAt)}</td>
                      <td data-label="当前可见性">
                        <VisibilityBadge visibility={bucket.visibility} />
                      </td>
                      <td data-label="操作">
                        <div className="action-row">
                          {bucket.visibility !== 'private' && (
                            <button
                              className="ghost"
                              disabled={!canWrite || isLoading(`action:bucket-visibility:${bucket.name}:private`)}
                              onClick={() => void setVisibility(bucket.name, 'private')}
                            >
                              设为 private
                            </button>
                          )}
                          {bucket.visibility !== 'public-read' && (
                            <button
                              className="ghost"
                              disabled={!canWrite || isLoading(`action:bucket-visibility:${bucket.name}:public-read`)}
                              onClick={() => void setVisibility(bucket.name, 'public-read')}
                            >
                              设为 public-read
                            </button>
                          )}
                          <button
                            className="ghost"
                            disabled={isLoading(`action:bucket-policy:${bucket.name}`)}
                            onClick={() => requestOpenBucketPolicy(bucket.name)}
                          >
                            高级策略
                          </button>
                          <button
                            className="danger-link"
                            disabled={!canWrite || isLoading(`action:delete-bucket:${bucket.name}`)}
                            onClick={() => void deleteBucket(bucket.name)}
                          >
                            删除空桶
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionBlock>

            <SectionBlock
              title="高级桶策略"
              hint={
                editingBucketPolicy
                  ? `当前桶：${editingBucketPolicy.bucket}，识别状态：${editingBucketPolicy.visibility}`
                  : '从桶列表进入“高级策略”，即可查看或编辑原始 JSON。'
              }
              className="wide"
              trailing={isBucketPolicyDirty ? <span className="chip warning">未保存</span> : null}
            >
              {editingBucketPolicy ? (
                <div className="stack-form">
                  <textarea
                    rows={16}
                    value={bucketPolicyDraft}
                    onChange={(event) => setBucketPolicyDraft(event.target.value)}
                    placeholder='{"Version":"2012-10-17","Statement":[]}'
                  />
                  <div className="action-row">
                    <button
                      className="ghost"
                      disabled={isLoading(`action:validate-policy:${editingBucketPolicy.bucket}`)}
                      onClick={() => void validateCurrentBucketPolicy()}
                    >
                      校验策略
                    </button>
                    <button
                      className="primary"
                      disabled={!canWrite || isLoading(`action:save-policy:${editingBucketPolicy.bucket}`)}
                      onClick={() => void saveBucketPolicy()}
                    >
                      保存策略
                    </button>
                    <button className="ghost" onClick={resetBucketDraft}>
                      恢复已加载内容
                    </button>
                  </div>
                  {bucketPolicyValidation && <PolicyValidationCard result={bucketPolicyValidation} />}
                  <DiffPreview title="策略变更预览" lines={bucketPolicyDiff} />
                </div>
              ) : (
                <EmptyState title="选择一个桶" description="先从上方桶列表进入高级策略编辑。" />
              )}
            </SectionBlock>
          </section>
        )}

        {activeTab === 'users' && (
          <section className={`content-grid users-layout ${userPaneMode === 'detail' ? 'mobile-detail' : 'mobile-list'}`}>
            <SectionBlock title="用户菜单" hint="左侧单独作为列表下拉条，右侧聚焦详情。" className="master-pane" defaultOpen>
              <div className="card-header">
                <h3>用户</h3>
                <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="搜索用户" />
              </div>

              <div className="stack-form form-panel">
                <input value={newUser.name} onChange={(event) => setNewUser((prev) => ({ ...prev, name: event.target.value }))} placeholder="用户名" />
                <input type="password" value={newUser.password} onChange={(event) => setNewUser((prev) => ({ ...prev, password: event.target.value }))} placeholder="初始密码" />
                <select value={newUser.role} onChange={(event) => setNewUser((prev) => ({ ...prev, role: event.target.value as AdminRole }))}>
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="muted">{roleOptions.find((option) => option.value === newUser.role)?.description}</p>
                <button className="primary" disabled={!canWrite || isLoading('action:create-user')} onClick={() => void createUser()}>
                  新建用户
                </button>
              </div>

              <div className="list-panel">
                {filteredUsers.map((user) => (
                  <button
                    key={user.name}
                    className={user.name === selectedUser ? 'list-item active' : 'list-item'}
                    onClick={() => requestUserSelection(user.name)}
                  >
                    <span>{user.name}</span>
                    <span className="muted">{user.status} · {roleLabel(user.role)}</span>
                  </button>
                ))}
              </div>
            </SectionBlock>

            <SectionBlock
              title="核心窗体"
              hint={currentUser ? `当前用户：${currentUser.name}` : '请选择左侧用户进入详情。'}
              className="wide detail-pane"
              defaultOpen
            >
              {currentUser ? (
                <>
                  <div className="detail-header">
                    <div className="detail-header-main">
                      <button className="ghost mobile-back" onClick={() => setUserPaneMode('list')}>
                        返回列表
                      </button>
                      <div>
                        <h3>{currentUser.name}</h3>
                        <p className="muted">分组：{(currentUser.memberOf ?? []).join(', ') || '暂无'}</p>
                      </div>
                    </div>
                    <div className="action-row">
                      <button className="ghost" disabled={!canWrite || isLoading(`action:user-status:${currentUser.name}:enabled`)} onClick={() => void setUserStatus(currentUser.name, 'enabled')}>
                        启用
                      </button>
                      <button className="ghost" disabled={!canWrite || isLoading(`action:user-status:${currentUser.name}:disabled`)} onClick={() => void setUserStatus(currentUser.name, 'disabled')}>
                        停用
                      </button>
                      <button className="danger-link" disabled={!canWrite || isLoading(`action:delete-user:${currentUser.name}:safe`)} onClick={() => void deleteUser(currentUser.name, 'safe')}>
                        安全删除
                      </button>
                      <button className="danger-link" disabled={!canWrite || isLoading(`action:delete-user:${currentUser.name}:force`)} onClick={() => void deleteUser(currentUser.name, 'force')}>
                        强制删除
                      </button>
                    </div>
                  </div>

                  <div className="summary-strip">
                    <SummaryCard label="角色" value={roleLabel(currentUser.role)} />
                    <SummaryCard label="状态" value={currentUser.status} />
                    <SummaryCard label="分组数" value={String(currentUser.memberOf.length)} />
                    <SummaryCard label="Access Keys" value={String(accessKeys.length)} />
                  </div>

                  <SectionBlock title="角色管理" hint="已有用户也可以提升为全局管理员或切换为只读管理员。">
                    <div className="role-editor">
                      <select value={userRoleDraft} onChange={(event) => setUserRoleDraft(event.target.value as AdminRole)}>
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <div className="muted role-editor-copy">
                        {roleOptions.find((option) => option.value === userRoleDraft)?.description}
                      </div>
                      <button
                        className="primary"
                        disabled={!canWrite || isLoading(`action:user-role:${currentUser.name}`)}
                        onClick={() => void saveUserRole()}
                      >
                        更新角色
                      </button>
                    </div>
                  </SectionBlock>

                  <div className="subtabs">
                    {userDetailTabs.map((tab) => (
                      <button
                        key={tab.key}
                        className={tab.key === userDetailTab ? 'subtab active' : 'subtab'}
                        onClick={() => startTransition(() => setUserDetailTab(tab.key))}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {userDetailTab === 'permissions' && (
                    <div className="content-grid">
                      <div className="dual-grid">
                        <PermissionEditor
                          title="直接桶权限"
                          buckets={buckets}
                          draft={userPermissionDraft}
                          setDraft={setUserPermissionDraft}
                          onSave={() => void saveUserPermissions()}
                          disabled={!canWrite || isLoading(`action:user-permissions:${currentUser.name}`)}
                        />
                        <div className="card subcard">
                          <div className="card-header">
                            <h3>权限结果</h3>
                            {isUserDirty && <span className="chip warning">待保存</span>}
                          </div>
                          <PermissionList items={currentUser.finalPermissions} />
                          <DiffList title="待保存改动" items={currentUserPermissionDiff} />
                          <div className="spacer" />
                          <EffectivePermissionTable rows={effectivePermissions} />
                        </div>
                      </div>

                      <div className="card subcard">
                        <div className="card-header">
                          <h3>批量套用权限</h3>
                          <span className="muted">把当前草稿复制给多个用户</span>
                        </div>
                        <textarea
                          rows={4}
                          value={batchUserTargets}
                          onChange={(event) => setBatchUserTargets(event.target.value)}
                          placeholder="输入多个用户名，使用逗号或换行分隔"
                        />
                        <button className="primary" disabled={!canWrite || isLoading('action:batch-user-permissions')} onClick={() => void batchApplyUserPermissions()}>
                          批量应用当前权限草稿
                        </button>
                      </div>
                    </div>
                  )}

                  {userDetailTab === 'access_keys' && (
                    <div className="card subcard">
                      <div className="card-header">
                        <h3>Access Keys</h3>
                      </div>
                      <div className="stack-form compact">
                        <input value={newAccessKey.name} onChange={(event) => setNewAccessKey((prev) => ({ ...prev, name: event.target.value }))} placeholder="Key 名称" />
                        <input value={newAccessKey.description} onChange={(event) => setNewAccessKey((prev) => ({ ...prev, description: event.target.value }))} placeholder="描述" />
                        <button className="primary" disabled={!canWrite || isLoading(`action:create-access-key:${selectedUser}`)} onClick={() => void createAccessKey()}>
                          创建 Access Key
                        </button>
                      </div>
                      {latestSecret && (
                        <div className="secret-box">
                          <strong>仅展示一次</strong>
                          <code>{latestSecret.accessKey}</code>
                          <code>{latestSecret.secretKey}</code>
                          <div className="action-row">
                            <button className="ghost" onClick={downloadCurrentSecret}>下载文本</button>
                            <button className="ghost" onClick={() => setLatestSecret(null)}>我已保存，关闭</button>
                          </div>
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
                              <td data-label="Access Key">{item.accessKey}</td>
                              <td data-label="状态">{item.status}</td>
                              <td data-label="描述">{item.description || item.name || '-'}</td>
                              <td data-label="操作">
                                <div className="action-row">
                                  <button className="ghost" disabled={!canWrite || isLoading(`action:access-key:${item.accessKey}:on`)} onClick={() => void setAccessKeyStatus(item.accessKey, 'on')}>
                                    启用
                                  </button>
                                  <button className="ghost" disabled={!canWrite || isLoading(`action:access-key:${item.accessKey}:off`)} onClick={() => void setAccessKeyStatus(item.accessKey, 'off')}>
                                    停用
                                  </button>
                                  <button className="danger-link" disabled={!canWrite || isLoading(`action:delete-access-key:${item.accessKey}`)} onClick={() => void deleteAccessKey(item.accessKey)}>
                                    删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {userDetailTab === 'dependencies' && (
                    <div className="dual-grid">
                      <div className="card subcard">
                        <div className="card-header">
                          <h3>删除依赖明细</h3>
                        </div>
                        <DependencyList details={userDependencies} />
                      </div>
                      <div className="card subcard">
                        <div className="card-header">
                          <h3>最终生效权限</h3>
                        </div>
                        <EffectivePermissionTable rows={effectivePermissions} />
                      </div>
                    </div>
                  )}

                  {userDetailTab === 'audit' && (
                    <div className="card subcard">
                      <div className="card-header">
                        <h3>用户相关审计</h3>
                        <button className="ghost" disabled={isLoading(`section:user:${selectedUser}`)} onClick={() => void loadUserDetails(selectedUser, true)}>
                          刷新
                        </button>
                      </div>
                      <AuditTable items={userAudits} onResourceClick={handleAuditResourceClick} />
                    </div>
                  )}
                </>
              ) : (
                <EmptyState title="选择一个用户" description="从左侧选择用户后，可管理权限、状态、依赖和 Access Key。" />
              )}
            </SectionBlock>
          </section>
        )}

        {activeTab === 'groups' && (
          <section className={`content-grid users-layout ${groupPaneMode === 'detail' ? 'mobile-detail' : 'mobile-list'}`}>
            <SectionBlock title="分组菜单" hint="左侧作为分组列表条。" className="master-pane" defaultOpen>
              <div className="card-header">
                <h3>分组</h3>
                <input value={groupSearch} onChange={(event) => setGroupSearch(event.target.value)} placeholder="搜索分组" />
              </div>
              <div className="inline-form form-panel">
                <input value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="新分组名" />
                <button className="primary" disabled={!canWrite || isLoading('action:create-group')} onClick={() => void createGroup()}>
                  创建
                </button>
              </div>
              <div className="list-panel">
                {filteredGroups.map((group) => (
                  <button
                    key={group.name}
                    className={group.name === selectedGroup ? 'list-item active' : 'list-item'}
                    onClick={() => requestGroupSelection(group.name)}
                  >
                    <span>{group.name}</span>
                    <span className="muted">{(group.members ?? []).length} members</span>
                  </button>
                ))}
              </div>
            </SectionBlock>

            <SectionBlock
              title="核心窗体"
              hint={currentGroup ? `当前分组：${currentGroup.name}` : '请选择左侧分组进入详情。'}
              className="wide detail-pane"
              defaultOpen
            >
              {currentGroup ? (
                <>
                  <div className="detail-header">
                    <div className="detail-header-main">
                      <button className="ghost mobile-back" onClick={() => setGroupPaneMode('list')}>
                        返回列表
                      </button>
                      <div>
                        <h3>{currentGroup.name}</h3>
                        <p className="muted">状态：{currentGroup.status}</p>
                      </div>
                    </div>
                    <button className="danger-link" disabled={!canWrite || isLoading(`action:delete-group:${currentGroup.name}`)} onClick={() => void deleteGroup(currentGroup.name)}>
                      删除分组
                    </button>
                  </div>

                  <div className="summary-strip">
                    <SummaryCard label="成员数" value={String(currentGroup.members.length)} />
                    <SummaryCard label="权限模板数" value={String(currentGroup.permissions.length)} />
                    <SummaryCard label="状态" value={currentGroup.status} />
                    <SummaryCard label="保存状态" value={isGroupDirty ? '有改动' : '已同步'} />
                  </div>

                  <div className="dual-grid">
                    <div className="card subcard">
                      <div className="card-header">
                        <h3>成员</h3>
                        {groupMembersDirty && <span className="chip warning">待保存</span>}
                      </div>
                      <textarea rows={6} value={groupMembersDraft} onChange={(event) => setGroupMembersDraft(event.target.value)} placeholder="用英文逗号或换行分隔成员名" />
                      <button className="primary" disabled={!canWrite || isLoading(`action:group-members:${currentGroup.name}`)} onClick={() => void saveGroupMembers()}>
                        保存成员
                      </button>
                    </div>

                    <PermissionEditor
                      title="分组桶权限"
                      buckets={buckets}
                      draft={groupPermissionDraft}
                      setDraft={setGroupPermissionDraft}
                      onSave={() => void saveGroupPermissions()}
                      disabled={!canWrite || isLoading(`action:group-permissions:${currentGroup.name}`)}
                    />
                  </div>

                  <DiffList title="待保存改动" items={[...currentGroupPermissionDiff, ...(groupMembersDirty ? ['成员列表已变更'] : [])]} />
                </>
              ) : (
                <EmptyState title="选择一个分组" description="从左侧选择分组后，可管理成员和桶权限模板。" />
              )}
            </SectionBlock>
          </section>
        )}

        {activeTab === 'audit' && (
          <section className="content-grid">
            <SectionBlock title="筛选条件">
              <div className="quick-filters">
                {auditRangeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={auditFilters.range === option.value ? 'subtab active' : 'subtab'}
                    onClick={() => setAuditFilters((prev) => ({ ...prev, range: option.value }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="quad-grid">
                <input value={auditFilters.actor} onChange={(event) => setAuditFilters((prev) => ({ ...prev, actor: event.target.value }))} placeholder="操作者" />
                <input value={auditFilters.action} onChange={(event) => setAuditFilters((prev) => ({ ...prev, action: event.target.value }))} placeholder="动作" />
                <input value={auditFilters.resourceType} onChange={(event) => setAuditFilters((prev) => ({ ...prev, resourceType: event.target.value }))} placeholder="资源类型" />
                <input value={auditFilters.result} onChange={(event) => setAuditFilters((prev) => ({ ...prev, result: event.target.value }))} placeholder="结果前缀，例如 success" />
                <input className="wide-input" value={auditFilters.query} onChange={(event) => setAuditFilters((prev) => ({ ...prev, query: event.target.value }))} placeholder="全文搜索 actor/action/resource/summary/result" />
              </div>
              <div className="action-row">
                <button className="primary" disabled={isLoading('section:audit')} onClick={() => void loadAuditPage()}>
                  应用筛选
                </button>
                <button className="ghost" onClick={() => setAuditFilters({ actor: '', action: '', resourceType: '', result: '', query: '', range: 'all' })}>
                  清空筛选
                </button>
                <button className="ghost" onClick={() => void exportVisibleAudits('json')}>
                  导出当前 JSON
                </button>
                <button className="ghost" onClick={() => void exportVisibleAudits('csv')}>
                  导出当前 CSV
                </button>
              </div>
            </SectionBlock>

            <SectionBlock title="审计日志" hint="点击资源可跳到对应的用户、分组或桶。" className="wide">
              <AuditTable items={visibleAudits} onResourceClick={handleAuditResourceClick} />
            </SectionBlock>
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

function SidebarSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section-title">{title}</div>
      <div className="sidebar-section-body">{children}</div>
    </section>
  )
}

function SectionBlock({
  title,
  hint,
  children,
  trailing,
  className = '',
  defaultOpen = true,
}: {
  title: string
  hint?: string
  children: ReactNode
  trailing?: ReactNode
  className?: string
  defaultOpen?: boolean
}) {
  return (
    <details className={`card section-block ${className}`.trim()} open={defaultOpen}>
      <summary className="section-summary">
        <div>
          <h3>{title}</h3>
          {hint ? <p className="muted section-hint">{hint}</p> : null}
        </div>
        <div className="section-summary-right">
          {trailing}
          <span className="section-caret">展开/收起</span>
        </div>
      </summary>
      <div className="section-body">{children}</div>
    </details>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-card">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <span className="muted">{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function Checklist({ title, items }: { title: string; items: { name: string; status: string; message: string }[] }) {
  return (
    <div className="stack-block">
      <strong>{title}</strong>
      <div className="stack-list">
        {items.map((item) => (
          <div key={`${title}:${item.name}`} className={`check-item ${item.status}`}>
            <span>{item.name}</span>
            <span className="muted">{item.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PermissionEditor({
  title,
  buckets,
  draft,
  setDraft,
  onSave,
  disabled,
}: {
  title: string
  buckets: BucketInfo[]
  draft: Record<string, PermissionTemplate>
  setDraft: Dispatch<SetStateAction<Record<string, PermissionTemplate>>>
  onSave: () => void
  disabled: boolean
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
      <button className="primary" disabled={disabled} onClick={onSave}>
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
          <span>{permissionTemplateLabel(item.template)}</span>
          <span className="muted">{item.source}</span>
        </div>
      ))}
    </div>
  )
}

function EffectivePermissionTable({ rows }: { rows: EffectivePermissionRow[] }) {
  if (rows.length === 0) {
    return <p className="muted">暂无可展示的权限结果</p>
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>桶</th>
          <th>直接</th>
          <th>继承</th>
          <th>生效</th>
          <th>继承来源</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.bucket}>
            <td data-label="桶">{row.bucket}</td>
            <td data-label="直接">{permissionTemplateLabel(row.direct)}</td>
            <td data-label="继承">{permissionTemplateLabel(row.inherited)}</td>
            <td data-label="生效">{permissionTemplateLabel(row.effective)}</td>
            <td data-label="继承来源">{row.inheritedVia.join(', ') || '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DependencyList({ details }: { details: UserDependencyDetails | null }) {
  if (!details) {
    return <p className="muted">尚未加载依赖信息。</p>
  }

  return (
    <div className="stack-list">
      <DependencyItem label="所属分组" items={details.memberOf} />
      <DependencyItem label="Access Keys" items={details.serviceKeys} />
      <DependencyItem label="直接策略" items={details.directPolicies} />
    </div>
  )
}

function DependencyItem({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="dependency-item">
      <strong>{label}</strong>
      <span className="muted">{items.length > 0 ? items.join(', ') : '无'}</span>
    </div>
  )
}

function PolicyValidationCard({ result }: { result: PolicyValidationResult }) {
  return (
    <div className={result.valid ? 'notice ok' : 'notice error'}>
      <strong>{result.valid ? '策略校验通过' : '策略校验失败'}</strong>
      {result.errors.length > 0 && <div>{result.errors.join('；')}</div>}
      {result.warnings.length > 0 && <div>{result.warnings.join('；')}</div>}
    </div>
  )
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="card subcard">
      <div className="card-header">
        <h3>{title}</h3>
      </div>
      <ul className="simple-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function DiffPreview({ title, lines }: { title: string; lines: { kind: 'same' | 'add' | 'remove'; text: string }[] }) {
  if (lines.length === 0) {
    return null
  }

  return (
    <div className="card subcard">
      <div className="card-header">
        <h3>{title}</h3>
      </div>
      <pre className="diff-block">
        {lines.map((line, index) => (
          <div key={`${line.kind}:${index}`} className={`diff-line ${line.kind}`}>
            <span>{line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}

function SessionTable({
  items,
  canWrite,
  onRevoke,
  loadingKeys,
}: {
  items: SessionInfo[]
  canWrite: boolean
  onRevoke: (sessionId: string) => void
  loadingKeys: Record<string, boolean>
}) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>账号</th>
          <th>角色</th>
          <th>来源 IP</th>
          <th>最近活动</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.sessionId}>
            <td data-label="账号">
              {item.username}
              {item.isCurrent ? '（当前）' : ''}
            </td>
            <td data-label="角色">{roleLabel(item.role)}</td>
            <td data-label="来源 IP">{item.sourceIp || '-'}</td>
            <td data-label="最近活动">{formatTime(item.lastSeenAt)}</td>
            <td data-label="操作">
              {item.isCurrent ? (
                <span className="muted">当前会话</span>
              ) : (
                <button className="danger-link" disabled={!canWrite || loadingKeys[`action:revoke-session:${item.sessionId}`]} onClick={() => onRevoke(item.sessionId)}>
                  撤销
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AuditTable({
  items,
  onResourceClick,
}: {
  items: AuditLog[]
  onResourceClick?: (item: AuditLog) => void
}) {
  if (items.length === 0) {
    return <EmptyState title="暂无记录" description="当前条件下没有匹配的审计日志。" />
  }

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
            <td data-label="时间">{formatTime(item.createdAt)}</td>
            <td data-label="操作者">{item.actor}</td>
            <td data-label="动作">{item.action}</td>
            <td data-label="资源">
              {onResourceClick ? (
                <button className="text-link" onClick={() => onResourceClick(item)}>
                  {item.resourceType}:{item.resourceId}
                </button>
              ) : (
                `${item.resourceType}:${item.resourceId}`
              )}
            </td>
            <td data-label="结果">{item.result}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function VisibilityBadge({ visibility }: { visibility: BucketVisibility }) {
  return <span className={`chip visibility-chip ${visibility}`}>{visibility}</span>
}

function ToastStack({ items, onDismiss }: { items: NotificationItem[]; onDismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`}>
          <span>{item.text}</span>
          <button className="toast-close" onClick={() => onDismiss(item.id)}>
            关闭
          </button>
        </div>
      ))}
    </div>
  )
}

function DialogModal({
  dialog,
  input,
  setInput,
  onClose,
  onConfirm,
}: {
  dialog: DialogState | null
  input: string
  setInput: (value: string) => void
  onClose: () => void
  onConfirm: () => void
}) {
  if (!dialog) return null

  return (
    <div className="modal-overlay" role="presentation">
      <div className={`modal-card ${dialog.tone}`}>
        <div className="card-header">
          <h3>{dialog.title}</h3>
          <button className="ghost" onClick={onClose} disabled={dialog.busy}>
            关闭
          </button>
        </div>
        <div className="modal-copy">
          {dialog.description.split('\n').map((line, index) => (
            <p key={`${dialog.title}:${index}`}>{line}</p>
          ))}
        </div>
        {dialog.expected && (
          <label className="stack-form">
            <span>{dialog.prompt ?? `请输入 ${dialog.expected} 继续`}</span>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={dialog.expected} />
          </label>
        )}
        <div className="action-row">
          <button className="ghost" onClick={onClose} disabled={dialog.busy}>
            {dialog.cancelLabel ?? '取消'}
          </button>
          <button className={dialog.tone === 'danger' ? 'danger-link' : 'primary'} onClick={onConfirm} disabled={dialog.busy}>
            {dialog.busy ? '处理中...' : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
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

function bindingsToMap(bindings: PermissionBinding[] = []) {
  return bindings.reduce<Record<string, PermissionTemplate>>((acc, item) => {
    acc[item.bucket] = item.template
    return acc
  }, {})
}

function summarizePermissionDiff(existing: PermissionBinding[] = [], draft: Record<string, PermissionTemplate>) {
  const existingMap = bindingsToMap(existing)
  const buckets = Array.from(new Set([...Object.keys(existingMap), ...Object.keys(draft)])).sort()
  const changes: string[] = []
  for (const bucket of buckets) {
    const before = existingMap[bucket] ?? 'none'
    const after = draft[bucket] ?? 'none'
    if (before !== after) {
      changes.push(`${bucket}: ${permissionTemplateLabel(before)} -> ${permissionTemplateLabel(after)}`)
    }
  }
  return changes
}

function buildLineDiff(before: string, after: string) {
  const beforeLines = before.split('\n')
  const afterLines = after.split('\n')
  const max = Math.max(beforeLines.length, afterLines.length)
  const out: { kind: 'same' | 'add' | 'remove'; text: string }[] = []
  for (let index = 0; index < max; index += 1) {
    const left = beforeLines[index]
    const right = afterLines[index]
    if (left === right) {
      if (left !== undefined) out.push({ kind: 'same', text: left })
      continue
    }
    if (left !== undefined) out.push({ kind: 'remove', text: left })
    if (right !== undefined) out.push({ kind: 'add', text: right })
  }
  return out
}

function summarizeLineDiff(lines: { kind: 'same' | 'add' | 'remove'; text: string }[]) {
  const changed = lines.filter((line) => line.kind !== 'same')
  if (changed.length === 0) {
    return ''
  }
  return changed
    .slice(0, 12)
    .map((line) => `${line.kind === 'add' ? '+' : '-'} ${line.text}`)
    .join('\n')
}

function buildAuditParams(filters: {
  actor?: string
  action?: string
  resourceType?: string
  result?: string
  query?: string
  limit?: number
}) {
  const params = new URLSearchParams({ limit: String(filters.limit ?? 100) })
  if (filters.actor?.trim()) params.set('actor', filters.actor.trim())
  if (filters.action?.trim()) params.set('action', filters.action.trim())
  if (filters.resourceType?.trim()) params.set('resourceType', filters.resourceType.trim())
  if (filters.result?.trim()) params.set('result', filters.result.trim())
  if (filters.query?.trim()) params.set('query', filters.query.trim())
  return params
}

function filterAuditsByRange(items: AuditLog[], range: AuditRange) {
  if (range === 'all') return items
  const now = Date.now()
  return items.filter((item) => {
    const created = new Date(item.createdAt).getTime()
    if (Number.isNaN(created)) return false
    if (range === '1h') return now - created <= 60 * 60 * 1000
    if (range === '7d') return now - created <= 7 * 24 * 60 * 60 * 1000
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return created >= date.getTime()
  })
}

function sameStringSet(left: string[], right: string[]) {
  const normalizedLeft = Array.from(new Set(left.map((item) => item.trim()).filter(Boolean))).sort()
  const normalizedRight = Array.from(new Set(right.map((item) => item.trim()).filter(Boolean))).sort()
  if (normalizedLeft.length !== normalizedRight.length) return false
  return normalizedLeft.every((item, index) => item === normalizedRight[index])
}

function parseCommaList(value: string) {
  return Array.from(new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)))
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`
}

function permissionTemplateLabel(template: PermissionTemplate) {
  return permissionOptions.find((option) => option.value === template)?.label ?? template
}

function roleLabel(role?: AdminRole) {
  switch (role) {
    case 'global_admin':
      return '全局管理员'
    case 'readonly_admin':
      return '只读管理员'
    default:
      return '普通用户'
  }
}

function formatTime(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatBytes(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let index = 0
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024
    index += 1
  }
  return `${current.toFixed(current >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

export default App
