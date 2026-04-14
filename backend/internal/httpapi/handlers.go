package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"minio-manager-web/backend/internal/config"
	"minio-manager-web/backend/internal/domain"
	"minio-manager-web/backend/internal/minioadmin"
	"minio-manager-web/backend/internal/service"
)

type Handler struct {
	cfg     config.Config
	service *service.Service
}

func NewHandler(cfg config.Config, svc *service.Service) *Handler {
	return &Handler{cfg: cfg, service: svc}
}

func (h *Handler) Router() *gin.Engine {
	router := gin.Default()
	router.Use(cors(h.cfg.AllowOrigin))

	router.POST("/api/auth/login", h.login)

	auth := router.Group("/api")
	auth.Use(h.authMiddleware())
	auth.GET("/me", h.me)
	auth.POST("/auth/logout", h.logout)
	auth.GET("/health", h.health)
	auth.GET("/dashboard", h.dashboard)
	auth.GET("/system/health", h.systemHealth)
	auth.GET("/sessions", h.listSessions)
	auth.DELETE("/sessions/:session", h.deleteSession)
	auth.GET("/system/snapshot", h.exportSnapshot)
	auth.POST("/system/snapshot/restore", h.restoreSnapshot)
	auth.GET("/buckets", h.listBuckets)
	auth.POST("/buckets", h.createBucket)
	auth.GET("/buckets/:bucket/policy", h.getBucketPolicy)
	auth.POST("/buckets/:bucket/policy/validate", h.validateBucketPolicy)
	auth.PUT("/buckets/:bucket/policy", h.putBucketPolicy)
	auth.PATCH("/buckets/:bucket/visibility", h.patchBucketVisibility)
	auth.DELETE("/buckets/:bucket", h.deleteBucket)
	auth.GET("/users", h.listUsers)
	auth.POST("/users", h.createUser)
	auth.GET("/users/:user", h.getUser)
	auth.GET("/users/:user/dependencies", h.getUserDependencies)
	auth.GET("/users/:user/effective-permissions", h.getUserEffectivePermissions)
	auth.PATCH("/users/:user/role", h.patchUserRole)
	auth.PATCH("/users/:user/status", h.patchUserStatus)
	auth.DELETE("/users/:user", h.deleteUser)
	auth.PUT("/users/:user/bucket-permissions", h.putUserPermissions)
	auth.PUT("/users/batch/bucket-permissions", h.putBatchUserPermissions)
	auth.GET("/groups", h.listGroups)
	auth.POST("/groups", h.createGroup)
	auth.DELETE("/groups/:group", h.deleteGroup)
	auth.PUT("/groups/:group/members", h.putGroupMembers)
	auth.PUT("/groups/:group/bucket-permissions", h.putGroupPermissions)
	auth.GET("/users/:user/access-keys", h.listAccessKeys)
	auth.POST("/users/:user/access-keys", h.createAccessKey)
	auth.PATCH("/users/:user/access-keys/:key", h.patchAccessKey)
	auth.DELETE("/users/:user/access-keys/:key", h.deleteAccessKey)
	auth.GET("/audit-logs", h.listAuditLogs)
	auth.GET("/audit-logs/export", h.exportAuditLogs)

	h.mountFrontend(router)
	return router
}

func (h *Handler) login(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()

	result, err := h.service.Login(ctx, req.Username, req.Password, c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		if errors.Is(err, service.ErrUnauthorized) {
			writeError(c, http.StatusUnauthorized, domain.APIError{Code: "unauthorized", Message: "账号或密码错误，或不具备管理权限"})
			return
		}
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *Handler) me(c *gin.Context) {
	session := mustSession(c)
	c.JSON(http.StatusOK, gin.H{"data": session})
}

func (h *Handler) logout(c *gin.Context) {
	session := mustSession(c)
	if err := h.service.Logout(c.Request.Context(), session.SessionID); err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": true}})
}

func (h *Handler) health(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	client := mustMinIO(c)
	data, err := h.service.Dashboard(ctx, client)
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data.Health})
}

func (h *Handler) dashboard(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	client := mustMinIO(c)
	data, err := h.service.Dashboard(ctx, client)
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) systemHealth(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.SystemHealth(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) listSessions(c *gin.Context) {
	data, err := h.service.ListSessions(c.Request.Context(), mustSession(c).SessionID)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) deleteSession(c *gin.Context) {
	err := h.service.RevokeSession(c.Request.Context(), mustSession(c).SessionID, c.Param("session"))
	h.writeMutation(c, err, mustSession(c).Username, "revoke_session", "session", c.Param("session"), "Revoke session "+c.Param("session"))
}

func (h *Handler) exportSnapshot(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.BuildSnapshot(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) restoreSnapshot(c *gin.Context) {
	var req struct {
		ConfirmationToken string                `json:"confirmationToken"`
		DefaultPassword   string                `json:"defaultPassword"`
		Snapshot          domain.ConfigSnapshot `json:"snapshot"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.RestoreSnapshot(ctx, mustSession(c).Username, mustMinIO(c), req.Snapshot, req.DefaultPassword, req.ConfirmationToken)
	h.writeMutation(c, err, mustSession(c).Username, "restore_snapshot", "snapshot", req.Snapshot.Endpoint, "Restore configuration snapshot")
}

func (h *Handler) listBuckets(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.ListBuckets(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) createBucket(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "桶名不能为空"})
		return
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.CreateBucket(ctx, mustMinIO(c), req.Name)
	h.writeMutation(c, err, mustSession(c).Username, "create_bucket", "bucket", req.Name, "Create bucket "+req.Name)
}

func (h *Handler) getBucketPolicy(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.GetBucketPolicy(ctx, mustMinIO(c), c.Param("bucket"))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) validateBucketPolicy(c *gin.Context) {
	var req struct {
		Policy string `json:"policy"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.service.ValidateBucketPolicy(c.Param("bucket"), req.Policy)})
}

func (h *Handler) putBucketPolicy(c *gin.Context) {
	var req struct {
		Policy string `json:"policy"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	bucket := c.Param("bucket")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.SetBucketPolicy(ctx, mustMinIO(c), bucket, req.Policy)
	h.writeMutation(c, err, mustSession(c).Username, "set_bucket_policy", "bucket", bucket, "Update bucket policy")
}

func (h *Handler) patchBucketVisibility(c *gin.Context) {
	var req struct {
		Visibility domain.BucketVisibility `json:"visibility"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	bucket := c.Param("bucket")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.SetBucketVisibility(ctx, mustMinIO(c), bucket, req.Visibility)
	h.writeMutation(c, err, mustSession(c).Username, "set_bucket_visibility", "bucket", bucket, "Set bucket visibility to "+string(req.Visibility))
}

func (h *Handler) deleteBucket(c *gin.Context) {
	bucket := c.Param("bucket")
	token := c.Query("confirmationToken")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.DeleteBucket(ctx, mustSession(c).Username, mustMinIO(c), bucket, token)
	h.writeMutation(c, err, mustSession(c).Username, "delete_bucket", "bucket", bucket, "Delete bucket "+bucket)
}

func (h *Handler) listUsers(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.ListUsers(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) getUser(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.GetUser(ctx, mustMinIO(c), c.Param("user"))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) createUser(c *gin.Context) {
	var req struct {
		Name     string           `json:"name"`
		Password string           `json:"password"`
		Role     domain.AdminRole `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" || req.Password == "" {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "用户名和密码不能为空"})
		return
	}
	if req.Role == "" {
		req.Role = domain.RoleUser
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.CreateUser(ctx, mustMinIO(c), req.Name, req.Password, req.Role)
	h.writeMutation(c, err, mustSession(c).Username, "create_user", "user", req.Name, "Create user "+req.Name)
}

func (h *Handler) getUserDependencies(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.UserDependencies(ctx, mustMinIO(c), c.Param("user"))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) getUserEffectivePermissions(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	user, err := h.service.GetUser(ctx, mustMinIO(c), c.Param("user"))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	groups, err := h.service.ListGroups(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	buckets, err := h.service.ListBuckets(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.service.EffectivePermissions(user, groups, buckets)})
}

func (h *Handler) patchUserRole(c *gin.Context) {
	var req struct {
		Role domain.AdminRole `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	user := c.Param("user")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.UpdateUserRole(ctx, mustMinIO(c), user, req.Role)
	h.writeMutation(c, err, mustSession(c).Username, "set_user_role", "user", user, "Set user role to "+string(req.Role))
}

func (h *Handler) patchUserStatus(c *gin.Context) {
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	user := c.Param("user")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.SetUserStatus(ctx, mustMinIO(c), user, req.Status)
	h.writeMutation(c, err, mustSession(c).Username, "set_user_status", "user", user, "Set user status to "+req.Status)
}

func (h *Handler) deleteUser(c *gin.Context) {
	user := c.Param("user")
	mode := c.DefaultQuery("mode", "safe")
	token := c.Query("confirmationToken")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.DeleteUser(ctx, mustSession(c).Username, mustMinIO(c), user, mode, token)
	h.writeMutation(c, err, mustSession(c).Username, "delete_user", "user", user, "Delete user "+user+" with mode "+mode)
}

func (h *Handler) putUserPermissions(c *gin.Context) {
	var req struct {
		ConfirmationToken string                               `json:"confirmationToken"`
		Permissions       map[string]domain.PermissionTemplate `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	user := c.Param("user")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.UpdateUserPermissions(ctx, mustSession(c).Username, mustMinIO(c), user, req.Permissions, req.ConfirmationToken)
	h.writeMutation(c, err, mustSession(c).Username, "update_user_permissions", "user", user, "Overwrite user bucket permissions")
}

func (h *Handler) putBatchUserPermissions(c *gin.Context) {
	var req struct {
		ConfirmationToken string                               `json:"confirmationToken"`
		Users             []string                             `json:"users"`
		Permissions       map[string]domain.PermissionTemplate `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.BatchUpdateUserPermissions(ctx, mustSession(c).Username, mustMinIO(c), req.Users, req.Permissions, req.ConfirmationToken)
	h.writeMutation(c, err, mustSession(c).Username, "batch_update_user_permissions", "user_batch", strings.Join(req.Users, ","), "Overwrite bucket permissions for multiple users")
}

func (h *Handler) listGroups(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.ListGroups(ctx, mustMinIO(c))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) createGroup(c *gin.Context) {
	var req struct {
		Name string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Name == "" {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "组名不能为空"})
		return
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.CreateGroup(ctx, mustMinIO(c), req.Name)
	h.writeMutation(c, err, mustSession(c).Username, "create_group", "group", req.Name, "Create group "+req.Name)
}

func (h *Handler) deleteGroup(c *gin.Context) {
	group := c.Param("group")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.DeleteGroup(ctx, mustMinIO(c), group)
	h.writeMutation(c, err, mustSession(c).Username, "delete_group", "group", group, "Delete group "+group)
}

func (h *Handler) putGroupMembers(c *gin.Context) {
	var req struct {
		Members []string `json:"members"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	group := c.Param("group")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.UpdateGroupMembers(ctx, mustMinIO(c), group, req.Members)
	h.writeMutation(c, err, mustSession(c).Username, "update_group_members", "group", group, "Update group members")
}

func (h *Handler) putGroupPermissions(c *gin.Context) {
	var req struct {
		ConfirmationToken string                               `json:"confirmationToken"`
		Permissions       map[string]domain.PermissionTemplate `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	group := c.Param("group")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.UpdateGroupPermissions(ctx, mustSession(c).Username, mustMinIO(c), group, req.Permissions, req.ConfirmationToken)
	h.writeMutation(c, err, mustSession(c).Username, "update_group_permissions", "group", group, "Overwrite group bucket permissions")
}

func (h *Handler) listAccessKeys(c *gin.Context) {
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.ListAccessKeys(ctx, mustMinIO(c), c.Param("user"))
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) createAccessKey(c *gin.Context) {
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	data, err := h.service.CreateAccessKey(ctx, mustMinIO(c), c.Param("user"), req.Name, req.Description)
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		_ = h.service.RecordAudit(context.Background(), mustSession(c).Username, "create_access_key", "access_key", c.Param("user"), "Create access key", "failed: "+err.Error(), c.ClientIP())
		return
	}
	_ = h.service.RecordAudit(context.Background(), mustSession(c).Username, "create_access_key", "access_key", c.Param("user"), "Create access key", "success", c.ClientIP())
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) patchAccessKey(c *gin.Context) {
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		writeError(c, http.StatusBadRequest, domain.APIError{Code: "bad_request", Message: "请求参数错误"})
		return
	}
	key := c.Param("key")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.SetAccessKeyStatus(ctx, mustMinIO(c), key, req.Status)
	h.writeMutation(c, err, mustSession(c).Username, "set_access_key_status", "access_key", key, "Set access key status to "+req.Status)
}

func (h *Handler) deleteAccessKey(c *gin.Context) {
	key := c.Param("key")
	token := c.Query("confirmationToken")
	ctx, cancel := h.timeoutContext(c)
	defer cancel()
	err := h.service.DeleteAccessKey(ctx, mustSession(c).Username, mustMinIO(c), key, token)
	h.writeMutation(c, err, mustSession(c).Username, "delete_access_key", "access_key", key, "Delete access key "+key)
}

func (h *Handler) listAuditLogs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	filter := service.AuditFilter{
		Actor:        c.Query("actor"),
		Action:       c.Query("action"),
		ResourceType: c.Query("resourceType"),
		Result:       c.Query("result"),
		Query:        c.Query("query"),
		Limit:        limit,
	}
	if from := c.Query("from"); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil {
			filter.From = &parsed
		}
	}
	if to := c.Query("to"); to != "" {
		if parsed, err := time.Parse(time.RFC3339, to); err == nil {
			filter.To = &parsed
		}
	}
	data, err := h.service.ListAudits(c.Request.Context(), filter)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (h *Handler) exportAuditLogs(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "500"))
	filter := service.AuditFilter{
		Actor:        c.Query("actor"),
		Action:       c.Query("action"),
		ResourceType: c.Query("resourceType"),
		Result:       c.Query("result"),
		Query:        c.Query("query"),
		Limit:        limit,
	}
	if from := c.Query("from"); from != "" {
		if parsed, err := time.Parse(time.RFC3339, from); err == nil {
			filter.From = &parsed
		}
	}
	if to := c.Query("to"); to != "" {
		if parsed, err := time.Parse(time.RFC3339, to); err == nil {
			filter.To = &parsed
		}
	}
	format := c.DefaultQuery("format", "json")
	body, contentType, err := h.service.ExportAudits(c.Request.Context(), filter, format)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.Header("Content-Type", contentType)
	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="audit-logs.%s"`, format))
	c.Data(http.StatusOK, contentType, body)
}

func (h *Handler) authMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID := c.GetHeader("Authorization")
		if sessionID == "" {
			writeError(c, http.StatusUnauthorized, domain.APIError{Code: "unauthorized", Message: "缺少会话令牌"})
			c.Abort()
			return
		}
		sessionID = trimBearer(sessionID)
		ctx, cancel := h.timeoutContext(c)
		defer cancel()
		session, client, err := h.service.GetSession(ctx, sessionID)
		if err != nil {
			writeError(c, http.StatusUnauthorized, domain.APIError{Code: "unauthorized", Message: "会话无效或已过期"})
			c.Abort()
			return
		}
		c.Set("session", session)
		c.Set("minioClient", client)
		if session.Role == domain.RoleReadOnlyAdmin && c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			if c.FullPath() != "/api/auth/logout" {
				writeError(c, http.StatusForbidden, domain.APIError{Code: "permission_denied", Message: "只读管理员不可执行写操作"})
				c.Abort()
				return
			}
		}
		c.Next()
	}
}

func (h *Handler) timeoutContext(c *gin.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(c.Request.Context(), h.cfg.RequestTimeout)
}

func (h *Handler) writeMutation(c *gin.Context, err error, actor, action, resourceType, resourceID, summary string) {
	if err != nil {
		writeServiceError(c, service.NormalizeMinIOError(err))
		_ = h.service.RecordAudit(context.Background(), actor, action, resourceType, resourceID, summary, "failed: "+err.Error(), c.ClientIP())
		return
	}
	_ = h.service.RecordAudit(context.Background(), actor, action, resourceType, resourceID, summary, "success", c.ClientIP())
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"success": true}})
}

func writeServiceError(c *gin.Context, err error) {
	if apiErr, ok := service.IsAPIError(err); ok {
		status := http.StatusBadRequest
		if apiErr.Code == "confirmation_required" {
			status = http.StatusConflict
		}
		if apiErr.Code == "permission_denied" || apiErr.Code == "unauthorized" {
			status = http.StatusUnauthorized
		}
		writeError(c, status, apiErr)
		return
	}
	writeError(c, http.StatusBadGateway, domain.APIError{Code: "minio_error", Message: err.Error()})
}

func writeError(c *gin.Context, status int, err domain.APIError) {
	c.JSON(status, gin.H{"error": err})
}

func mustSession(c *gin.Context) service.SessionData {
	value, _ := c.Get("session")
	return value.(service.SessionData)
}

func mustMinIO(c *gin.Context) *minioadmin.SessionClient {
	value, _ := c.Get("minioClient")
	return value.(*minioadmin.SessionClient)
}

func trimBearer(header string) string {
	if len(header) > 7 && header[:7] == "Bearer " {
		return header[7:]
	}
	return header
}

func (h *Handler) mountFrontend(router *gin.Engine) {
	distDir := filepath.Clean(h.cfg.FrontendDistDir)
	if _, err := os.Stat(distDir); err != nil {
		return
	}
	router.NoRoute(func(c *gin.Context) {
		if filepath.Ext(c.Request.URL.Path) != "" {
			c.File(filepath.Join(distDir, c.Request.URL.Path))
			return
		}
		c.File(filepath.Join(distDir, "index.html"))
	})
}

func cors(origin string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
