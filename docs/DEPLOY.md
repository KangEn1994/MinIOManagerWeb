# 部署说明

## 1. 配置环境变量

复制 `deploy/.env.example` 为 `deploy/.env`，至少修改：

- `APP_MASTER_KEY`
- `MINIO_ENDPOINT`
- `MINIO_USE_SSL`
- `MINIO_REGION`

## 2. 容器启动

```bash
cd deploy
cp .env.example .env
docker compose up -d --build
```

`docker compose` 会使用仓库根目录下的 [Dockerfile](/Users/kang_en/codex/MinIOManagerWeb/docker/Dockerfile) 进行构建。

## 2.1 合并进现有 MinIO compose

如果你准备把 `MinIOManagerWeb` 直接合并进你现在的 `MinIO` compose 文件，推荐直接参考：

- [docker-compose.with-minio.example.yml](/Users/kang_en/codex/MinIOManagerWeb/deploy/docker-compose.with-minio.example.yml)

关键点：

- 两个服务放同一个 compose 文件里时，`MINIO_ENDPOINT` 直接写 `minio:9000`
- `MINIO_ENDPOINT` 不要写 `http://`
- `SQLITE_PATH` 建议写 `/app/data/minio-manager.db`
- 后台数据目录单独挂载，比如 `./minio-manager-data:/app/data`

## 2.2 是否必须使用 `.env`

不是必须。

两种都支持：

- 用 `env_file: .env`
- 直接在 `docker-compose.yml` 中写 `environment:`

建议：

- 敏感值如 `APP_MASTER_KEY` 放 `.env`
- 其他普通字段可直接写在 yml 中

## 2.3 字段获取方式

- `APP_MASTER_KEY`
  - 自己生成，建议使用：

```bash
openssl rand -base64 48
```

- `BASE_URL`
  - 你打算给管理后台使用的域名或反向代理地址

- `MINIO_ENDPOINT`
  - 同 compose：`minio:9000`
  - 现有宿主机服务：`host.docker.internal:9000` 或实际 API 域名

- `MINIO_USE_SSL`
  - MinIO API 走 HTTPS 就是 `true`
  - 走 HTTP 就是 `false`

- `MINIO_REGION`
  - 与你当前 MinIO 配置保持一致，通常是 `us-east-1`

## 2.4 单机目录示例

如果你的线上目录类似：

```text
/srv/minio-stack
├── docker-compose.yml
├── data/
└── minio-manager-data/
```

那么推荐你在 `docker-compose.yml` 中：

- 保留原有 `minio` 服务
- 新增 `minio-manager-web` 服务
- 把 SQLite 数据挂载到 `./minio-manager-data:/app/data`

完整示例见：

- [docker-compose.opt-minio.example.yml](/Users/kang_en/codex/MinIOManagerWeb/deploy/docker-compose.opt-minio.example.yml)

如果只是最小增量改动，你只需要在现有 compose 里追加 `minio-manager-web` 段，并确保：

- `depends_on` 指向现有的 `minio`
- `MINIO_ENDPOINT` 写成 `minio:9000`
- 新建目录：

```bash
mkdir -p /srv/minio-stack/minio-manager-data
```

然后执行：

```bash
cd /srv/minio-stack
docker compose pull
docker compose up -d
```

## 3. Nginx 反向代理

把 [nginx.minio-manager.conf](/Users/kang_en/codex/MinIOManagerWeb/deploy/nginx.minio-manager.conf) 放到 Nginx 配置目录，再 reload。

## 4. 登录说明

- 登录页的“用户名/密码”实际对应 MinIO 管理员凭证
- 必须是具备 MinIO 管理权限的账号
- 前端会把会话令牌保存在浏览器本地存储

## 5. GitHub Actions 自动发布

仓库包含 [docker-publish.yml](/Users/kang_en/codex/MinIOManagerWeb/.github/workflows/docker-publish.yml)。

发布前先在 GitHub 仓库设置：

- `DOCKER_USERNAME`
- `DOCKER_PASSWORD`
- `DOCKER_REGISTRY`
- `DOCKER_IMAGE_REPOSITORY`

这 4 个都放在 `Repository secrets` 中即可。

镜像标签默认包含：

- 分支名
- Git tag
- commit sha
- `latest`，仅在 `main` 分支推送时生成

示例：

```text
DOCKER_REGISTRY=registry.example.com
DOCKER_IMAGE_REPOSITORY=team/minio-manager-web
```
