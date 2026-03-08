# Server 独立部署指南

My Claudia Server 可以独立部署在任意 Linux/macOS 机器上，作为 Claude Code CLI 的远程后端。部署后，桌面端或移动端可以通过直连或 Gateway 中继的方式远程使用该 Server。

## 架构概览

```
┌──────────────┐        ┌──────────────┐        ┌──────────────┐
│  Desktop/    │──WS──▶ │   Gateway    │──WS──▶ │   Server     │
│  Mobile UI   │        │  (可选中继)   │        │  + Claude CLI│
└──────────────┘        └──────────────┘        └──────────────┘
       │                                               │
       └──────────── 直连（局域网）─────────────────────┘
```

**Server 负责什么：**
- 管理项目、会话、消息（SQLite 存储）
- 调用本机的 Claude Code CLI 执行 AI 对话
- 提供 WebSocket + HTTP API 给客户端
- 可选：注册到 Gateway 供远程客户端发现

**Server 不需要：**
- Anthropic API Key（Claude CLI 自行管理认证）
- GPU 或特殊硬件

## 前置条件

| 依赖 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | ≥ 20.x | 推荐通过 [fnm](https://github.com/Schniz/fnm) 或 [nvm](https://github.com/nvm-sh/nvm) 安装 |
| pnpm | ≥ 9.x | `corepack enable && corepack prepare pnpm@latest --activate` |
| Claude CLI | 最新版 | `npm install -g @anthropic-ai/claude-code` |
| python3, make, gcc | — | better-sqlite3 原生编译需要 |

安装 Claude CLI 后需要登录：

```bash
claude login
```

## 快速开始（开发模式）

```bash
# 1. 克隆仓库
git clone https://github.com/zhvala/my-claudia.git
cd my-claudia

# 2. 安装依赖
pnpm install

# 3. 构建 shared 包（server 依赖它）
pnpm --filter @my-claudia/shared run build

# 4. 启动 server（开发模式，支持热重载）
pnpm --filter @my-claudia/server run dev
```

Server 默认监听 `http://0.0.0.0:3100`，WebSocket 端点为 `ws://0.0.0.0:3100/ws`。

## 生产部署

### 方式一：systemd 服务（推荐）

使用内置的一键部署脚本：

```bash
# 安装（检查依赖 → 构建 → 创建 systemd 服务）
./scripts/setup-server.sh install

# 编辑环境配置
./scripts/setup-server.sh env

# 启动服务
./scripts/setup-server.sh start
```

可用命令：

| 命令 | 说明 |
|------|------|
| `install` | 检查依赖、构建项目、创建 systemd 服务 |
| `start` | 启动服务 |
| `stop` | 停止服务 |
| `restart` | 重启服务 |
| `status` | 查看服务状态 |
| `logs` | 实时查看日志 |
| `rebuild` | 重新构建（代码更新后） |
| `env` | 编辑环境配置文件 |
| `uninstall` | 卸载 systemd 服务 |

### 方式二：手动运行

```bash
# 构建
pnpm --filter @my-claudia/shared run build
pnpm --filter @my-claudia/server run build

# 运行
cd server
node dist/index.js
```

可搭配 `pm2` 等进程管理器：

```bash
pm2 start server/dist/index.js --name my-claudia-server
```

## 环境变量

在 `.env.server` 文件（systemd 部署）或系统环境中配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3100` | HTTP/WebSocket 监听端口 |
| `SERVER_HOST` | `0.0.0.0` | 绑定地址（`0.0.0.0` = 所有网卡，`127.0.0.1` = 仅本机） |
| `GATEWAY_URL` | — | Gateway 地址，如 `http://192.168.2.1:3200` |
| `GATEWAY_SECRET` | — | Gateway 认证密钥 |
| `GATEWAY_NAME` | `Backend on <hostname>` | 在 Gateway 上显示的名称 |

> **注意：** WSL2 环境会自动设置 `HOST` 环境变量，因此 Server 使用 `SERVER_HOST` 避免冲突。

### 配置示例

```bash
# .env.server

# 基础配置
PORT=3100
SERVER_HOST=0.0.0.0

# 连接到 Gateway（可选，也可通过 UI 配置）
GATEWAY_URL=http://192.168.2.1:3200
GATEWAY_SECRET=your-gateway-secret
GATEWAY_NAME=Home Server
```

## Gateway 连接

Server 可以注册到 Gateway，让远程客户端通过 Gateway 发现和连接。有两种配置方式：

### 方式一：环境变量（优先级最高）

设置 `GATEWAY_URL` 和 `GATEWAY_SECRET`，Server 启动时自动连接。

### 方式二：UI 配置

1. 在桌面端打开 Settings → Gateway 标签
2. 启用 Gateway 连接
3. 填写 Gateway URL、Secret、名称
4. 保存后 Server 自动连接
5. 配置保存在数据库中，重启后自动加载

> 环境变量优先于数据库配置。如果同时设置了两者，以环境变量为准。

## 数据存储

| 路径 | 内容 |
|------|------|
| `~/.my-claudia/data.db` | SQLite 数据库（项目、会话、消息、配置） |
| `~/.my-claudia/files/` | 上传的文件存储 |

### 备份

```bash
# 备份数据库
cp ~/.my-claudia/data.db ~/.my-claudia/data.db.backup

# 完整备份
tar czf my-claudia-backup.tar.gz ~/.my-claudia/
```

### 迁移到新机器

1. 在新机器上完成部署步骤
2. 停止服务：`./scripts/setup-server.sh stop`
3. 复制 `~/.my-claudia/` 目录到新机器
4. 启动服务：`./scripts/setup-server.sh start`

## 客户端连接

### 局域网直连

桌面端 → 添加服务器：
- 名称：任意
- 地址：`<server-ip>:3100`
- API Key：从 Server 本地 UI 获取（首次本地连接时自动生成）

### 通过 Gateway 连接

1. Server 注册到 Gateway（见上文）
2. 桌面端 → 连接 Gateway → 输入 Gateway URL 和 Secret
3. 自动发现可用的后端
4. 选择后端 → 输入 API Key → 开始使用

## 安全建议

1. **API Key 认证**：所有客户端连接（包括本地）都需要 API Key
2. **局域网使用**：默认绑定 `0.0.0.0`，确保只在可信网络暴露
3. **公网暴露**：强烈建议通过 Gateway（支持 TLS）或反向代理（Nginx + TLS）
4. **文件权限**：`chmod 600 ~/.my-claudia/data.db`（包含 Gateway Secret）
5. **防火墙**：仅开放必要端口（默认 3100）

## 故障排查

### Server 启动失败

```bash
# 检查端口是否被占用
ss -tlnp | grep 3100

# 检查 Node.js 版本
node -v  # 需要 >= 20.x

# 检查 Claude CLI
claude --version
claude login  # 确保已登录
```

### 连接失败

```bash
# 测试 Server 是否可达
curl http://<server-ip>:3100/api/health

# 测试 WebSocket（需要 wscat）
npx wscat -c ws://<server-ip>:3100/ws
```

### Gateway 注册失败

```bash
# 检查 Gateway 是否运行
curl http://<gateway-ip>:3200/health

# 查看 Server 日志中的 Gateway 连接信息
./scripts/setup-server.sh logs
# 或开发模式下直接看控制台输出
```

### WSL2 环境注意事项

- WSL2 会设置 `HOST` 环境变量，Server 使用 `SERVER_HOST` 避免冲突
- WSL2 内的服务默认只能从 Windows 宿主机访问，局域网访问需要端口转发：
  ```bash
  # 在 Windows PowerShell 中（管理员）
  netsh interface portproxy add v4tov4 listenport=3100 listenaddress=0.0.0.0 connectport=3100 connectaddress=$(wsl hostname -I)
  ```

## 更新

```bash
# 拉取最新代码
git pull

# 重新构建
./scripts/setup-server.sh rebuild

# 重启服务
./scripts/setup-server.sh restart
```
