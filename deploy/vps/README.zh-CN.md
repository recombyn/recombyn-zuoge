# VPS 部署（MySQL + MinIO）

目标机器：`43.143.230.24` · 域名 `recombyn.com` · 文件 CDN `files.recombyn.com`

不再使用腾讯云 CynosDB / COS；数据库和对象存储都在本机 Docker 里。

## 一、云上一键部署

### 1. 登录 VPS

```bash
ssh root@43.143.230.24
```

### 2. 首次装 Docker + Caddy（只需一次）

```bash
cd /opt
git clone <你的私有仓库地址> recombyn
cd recombyn
bash deploy/vps/bootstrap-server.sh
```

### 3. 配置密钥

```bash
cp deploy/vps/.env.production.example .env
nano .env                    # MySQL / MinIO / COLLAB 等强密码

cp apps/api/.env.selfhost.example apps/api/.env
nano apps/api/.env           # 合并 Profile B + 你的 LLM API keys
```

`apps/api/.env` 里务必包含（容器内网络）：

```env
DATABASE_URL=mysql://recombyn:<密码>@mysql:3306/recombyn
S3_ENABLED=true
S3_ENDPOINT_URL=http://minio:9000
S3_PUBLIC_BASE_URL=https://files.recombyn.com/recombyn
S3_ACCESS_KEY=<与 .env 里 MINIO_ROOT_USER 一致>
S3_SECRET_KEY=<与 .env 里 MINIO_ROOT_PASSWORD 一致>
CORS_ORIGINS=["https://recombyn.com","https://www.recombyn.com"]
COLLAB_PUBLIC_WS_URL=wss://recombyn.com/collab
AUTH_CONSOLE_LOGIN_CODE=false
```

**不要**再设置 `*.tencentcdb.com` 或 `cos.*.myqcloud.com`。

### 4. DNS

| 记录 | 指向 |
|------|------|
| `recombyn.com` / `www` | `43.143.230.24` |
| `files.recombyn.com` | `43.143.230.24` |

### 5. Caddy + 启动

```bash
cp deploy/caddy/Caddyfile.recombyn /etc/caddy/Caddyfile
systemctl enable caddy && systemctl reload caddy

bash deploy/vps/deploy.sh
```

### 6. 验收

```bash
curl -s http://127.0.0.1:8000/api/v1/health
# 期望: "db":"mysql", "s3": true

curl -I https://recombyn.com
curl -I https://files.recombyn.com/minio/health/live
```

---

## 二、本地搭建（与线上同栈：MySQL + MinIO）

Windows / macOS 开发机：

### 1. 安装 Docker Desktop

确保 `docker compose` 可用。

### 2. 起基础设施

```powershell
cd E:\Tianmeng\resume-creation-web
npm run dev:infra
```

会启动：`mysql` · `redis` · `minio` · 自动建桶 `recombyn`。

### 3. API 环境

`apps/api/.env` 已配置为：

- `DATABASE_URL=mysql://recombyn:recombyn@127.0.0.1:3306/recombyn`
- MinIO：`http://127.0.0.1:9000`，公开 URL 前缀 `http://127.0.0.1:9000/recombyn`

### 4. 启动应用

```powershell
npm run dev:api
npm run dev:worker
npm run dev:web
# 可选
npm run dev:intelligence
```

或使用一键栈：

```powershell
npm run dev:stack
```

### 5. 本地验收

| 服务 | 地址 |
|------|------|
| Web | http://localhost:3000 |
| API | http://localhost:8000/docs |
| MinIO 控制台 | http://127.0.0.1:9001 （minioadmin / minioadmin） |
| Health | http://127.0.0.1:8000/api/v1/health → `"s3": true` |

---

## 从腾讯云迁出（已有数据时）

1. 导出 CynosDB → `mysqldump`，导入 compose MySQL 卷。
2. COS 对象可用 `mc mirror cos/... local/recombyn/` 迁到 MinIO。
3. 确认 `S3_PUBLIC_BASE_URL` 指向新域名后再切流量。
