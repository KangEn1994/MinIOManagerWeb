# MinIOManagerWeb

MinIO 基础管理后台，面向单个 MinIO 实例的管理员使用场景。

## 功能

- 管理桶的 `private` / `public-read` / `custom`
- 创建桶、删除空桶
- 新增/删除用户，启用/停用用户
- 支持创建 `global_admin` 和 `readonly_admin`
- 分组管理与批量成员维护
- 用户与分组的桶权限模板绑定
- 用户删除依赖检查与最终权限汇总
- Access Key 创建、停用、删除
- 审计日志查询与导出
- 后台会话管理与撤销
- 系统健康检查与部署检查项
- 配置快照导出 / 恢复
- 高风险操作二次确认

## 目录

- `backend/`: Go API 服务
- `frontend/`: React 管理台
- `docker/`: 镜像构建入口
- `deploy/`: Docker 与 Nginx 示例配置
- `docs/`: 接口和部署说明

## 本地开发

前端：

```bash
cd frontend
npm install
npm run dev
```

后端：

```bash
cd backend
go mod tidy
go run ./cmd/server
```

## 关键环境变量

参考 [deploy/.env.example](/Users/kang_en/codex/MinIOManagerWeb/deploy/.env.example)。

## 角色模型

- `user`: 普通对象存储用户，不能登录当前后台
- `global_admin`: 全局管理员，可登录后台并执行所有管理操作
- `readonly_admin`: 只读管理员，可登录后台查看配置与审计，但不能执行写操作

## 与现有 MinIO 集成部署

这个项目不是替代 MinIO，而是作为一个独立管理后台接到你现有的 MinIO 实例上。

### 现有 MinIO 形态

如果你现在已经有类似下面的访问方式：

- `minio-api.example.com` 反向代理到 MinIO API
- `minio-console.example.com` 反向代理到 MinIO Console

那么 `MinIOManagerWeb` 可以作为第三个独立服务部署，例如：

- `minio-manager.example.com` 反向代理到管理后台容器

### 1. 准备环境变量

进入 [deploy](/Users/kang_en/codex/MinIOManagerWeb/deploy) 目录：

```bash
cd deploy
cp .env.example .env
```

按你自己的环境修改 `.env`：

```env
APP_NAME=MinIO Manager Web
BIND_ADDRESS=:8080
BASE_URL=https://minio-manager.example.com
TZ=Asia/Shanghai
APP_MASTER_KEY=replace-with-a-random-string-at-least-32-characters
SQLITE_PATH=./data/minio-manager.db
FRONTEND_DIST_DIR=/app/frontend/dist
SESSION_TTL=8h
CONFIRMATION_TTL=5m
REQUEST_TIMEOUT=15s
ALLOW_ORIGIN=*

MINIO_ENDPOINT=minio-api.example.com
MINIO_USE_SSL=true
MINIO_REGION=us-east-1
```

说明：

- `TZ=Asia/Shanghai` 表示容器默认使用东八区
- `MINIO_ENDPOINT` 填你自己的 MinIO API 域名、内网地址或 compose 服务名
- `MINIO_ENDPOINT` 不要带 `http://` 或 `https://`
- 如果 MinIO API 走 HTTPS，就把 `MINIO_USE_SSL=true`
- 这个后台登录时使用的是现有 MinIO 管理员账号

### 2. 启动管理后台

```bash
cd deploy
docker compose up -d --build
```

### 2.1 如果你想直接塞进现有 MinIO 的 `docker-compose.yml`

可以，完全可以不使用 `.env`，直接把配置写在 `docker-compose.yml` 的 `environment:` 里。

如果 `MinIOManagerWeb` 和 `MinIO` 放在同一个 compose 文件里，推荐直接通过服务名访问：

- `MINIO_ENDPOINT=minio:9000`

完整样例见：

- [docker-compose.with-minio.example.yml](/Users/kang_en/codex/MinIOManagerWeb/deploy/docker-compose.with-minio.example.yml)

核心片段如下：

```yaml
services:
  minio:
    image: minio/minio:latest
    container_name: minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    ports:
      - "19000:9000"
      - "19001:9001"
    environment:
      TZ: Asia/Shanghai
      MINIO_ROOT_USER: admin
      MINIO_ROOT_PASSWORD: change-this-password
      MINIO_REGION: us-east-1
    volumes:
      - ./data:/data

  minio-manager-web:
    image: registry.example.com/team/minio-manager-web:latest
    container_name: minio-manager-web
    restart: unless-stopped
    depends_on:
      - minio
    ports:
      - "18080:8080"
    environment:
      TZ: Asia/Shanghai
      APP_NAME: MinIO Manager Web
      BIND_ADDRESS: :8080
      BASE_URL: https://minio-manager.example.com
      APP_MASTER_KEY: change-to-a-random-string-with-at-least-32-characters
      SQLITE_PATH: /app/data/minio-manager.db
      FRONTEND_DIST_DIR: /app/frontend/dist
      SESSION_TTL: 8h
      CONFIRMATION_TTL: 5m
      REQUEST_TIMEOUT: 15s
      ALLOW_ORIGIN: "*"
      MINIO_ENDPOINT: minio:9000
      MINIO_USE_SSL: "false"
      MINIO_REGION: us-east-1
    volumes:
      - ./minio-manager-data:/app/data
```

### 2.2 `.env` 和直接写进 yml 的区别

两种都可以：

- 用 `.env`
  - 配置更干净
  - 敏感信息更方便单独管理
  - 适合以后迁移和 CI/CD
- 直接写进 `docker-compose.yml`
  - 最直观
  - 适合和现有 MinIO 写在一起

建议：

- `APP_MASTER_KEY`、`MINIO_ROOT_PASSWORD` 这类敏感信息放 `.env`
- 其他字段直接写在 yml 里也没问题

### 2.3 这些字段怎么获取

- `APP_MASTER_KEY`
  - 用来加密后台保存的会话凭证
  - 你自己生成

```bash
openssl rand -base64 48
```

- `BASE_URL`
  - 你的管理后台访问地址
  - 例如 `https://minio-manager.example.com`

- `TZ`
  - 容器时区，建议固定为 `Asia/Shanghai`
  - 对应东八区

- `MINIO_ENDPOINT`
  - 如果和 MinIO 在同一个 compose 里，填 `minio:9000`
  - 如果连接外部或宿主机上的 MinIO，填可访问地址，例如 `host.docker.internal:9000` 或 MinIO API 域名
  - 不要带协议头

- `MINIO_USE_SSL`
  - 如果 MinIO API 是 HTTPS，填 `"true"`
  - 如果是 HTTP，填 `"false"`

- `MINIO_REGION`
  - 一般和你现有 MinIO 的 `MINIO_REGION` 一样
  - 常见默认值是 `us-east-1`

- `SQLITE_PATH`
  - 后台自己的 SQLite 文件保存路径
  - 容器里建议写 `/app/data/minio-manager.db`

- `ALLOW_ORIGIN`
  - 默认可以写 `"*"`
  - 如果你后续想收紧跨域，再改成管理后台域名

### 2.4 按常见单机目录结构落地

如果你的线上目录类似：

```text
/srv/minio-stack
├── docker-compose.yml
└── data/
```

那么常见做法是：

1. 保留原来的 `minio` 服务
2. 在同一个 `docker-compose.yml` 里追加 `minio-manager-web`
3. 新增一个数据目录：

```bash
mkdir -p /srv/minio-stack/minio-manager-data
```

4. 把 [docker-compose.opt-minio.example.yml](/Users/kang_en/codex/MinIOManagerWeb/deploy/docker-compose.opt-minio.example.yml) 里的 `minio-manager-web` 段合并到你现有文件
5. 执行：

```bash
cd /srv/minio-stack
docker compose pull
docker compose up -d
```

如果你已经把镜像推到了自己的仓库，比如：

```text
registry.example.com/team/minio-manager-web:latest
```

那 compose 里直接写这个镜像即可。

### 2.5 适合现有 compose 的最小追加片段

如果你不想替换整份 compose，只想追加最少内容，可以直接加这一段：

```yaml
  minio-manager-web:
    image: registry.example.com/team/minio-manager-web:latest
    container_name: minio-manager-web
    restart: unless-stopped
    depends_on:
      - minio
    ports:
      - "18080:8080"
    environment:
      TZ: Asia/Shanghai
      APP_NAME: MinIO Manager Web
      BIND_ADDRESS: :8080
      BASE_URL: https://minio-manager.example.com
      APP_MASTER_KEY: change-to-a-random-string-with-at-least-32-characters
      SQLITE_PATH: /app/data/minio-manager.db
      FRONTEND_DIST_DIR: /app/frontend/dist
      SESSION_TTL: 8h
      CONFIRMATION_TTL: 5m
      REQUEST_TIMEOUT: 15s
      ALLOW_ORIGIN: "*"
      MINIO_ENDPOINT: minio:9000
      MINIO_USE_SSL: "false"
      MINIO_REGION: us-east-1
    volumes:
      - ./minio-manager-data:/app/data
```

这个片段的前提是：

- 你的 MinIO 服务名就是 `minio`
- MinIO API 在容器内监听 `9000`
- `minio-manager-web` 和 `minio` 在同一个 compose 网络里

如果你的 MinIO 服务名不是 `minio`，就把 `MINIO_ENDPOINT: minio:9000` 改成实际服务名即可。

### 3. 配置 Nginx 新域名

保留你现有的 MinIO API 和 Console 域名不动，再为管理后台新增一个域名，例如：

- `minio-manager.example.com`

Nginx 可以参考 [nginx.minio-manager.conf](/Users/kang_en/codex/MinIOManagerWeb/deploy/nginx.minio-manager.conf)，核心就是把新域名反向代理到管理后台端口：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name minio-manager.example.com;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_read_timeout 600s;
    }
}
```

### 4. 登录和使用方式

访问你为管理后台配置的域名，例如：

- `https://minio-manager.example.com`

使用你现有的 MinIO 管理员账号登录，或者使用通过本后台创建的 `global_admin` / `readonly_admin` 账号登录。

这个后台会直接调用 MinIO 的管理能力，所以它管理的是你当前在线运行的 MinIO：

- 桶 private/public-read/custom
- 删除空桶
- 用户新增删除
- 分组管理
- 桶权限模板
- Access Key 管理
- 后台会话管理
- 审计日志与配置快照

### 5. 部署建议

- 推荐把这个后台部署在和 MinIO 同一台机器或同一内网里
- 推荐只给管理员访问，不直接开放给普通用户
- 推荐给管理后台单独配置 HTTPS
- 如果 MinIO API 本身只监听内网地址，也可以把 `MINIO_ENDPOINT` 直接写成内网地址或内网服务名
- 如果你把两个服务写在同一个 compose 文件里，优先使用服务名互联，例如 `minio:9000`

## GitHub Actions 发布镜像

仓库已包含 [docker-publish.yml](/Users/kang_en/codex/MinIOManagerWeb/.github/workflows/docker-publish.yml)，会在以下时机自动构建并推送 Docker 镜像：

- push 到 `main`
- push `v*` 标签
- 手动触发 `workflow_dispatch`

需要在 GitHub 仓库中配置这 4 个 `Repository secrets`：

- `DOCKER_USERNAME`
- `DOCKER_PASSWORD`
- `DOCKER_REGISTRY`
- `DOCKER_IMAGE_REPOSITORY`

变量示例：

```text
DOCKER_REGISTRY=registry.example.com
DOCKER_IMAGE_REPOSITORY=team/minio-manager-web
```

如果你用官方 Docker Hub，也可以这样填：

```text
DOCKER_REGISTRY=docker.io
DOCKER_IMAGE_REPOSITORY=your-user/minio-manager-web
```
