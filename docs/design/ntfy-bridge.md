# ntfy-bridge: Android 原生推送方案

## 目标

让 Android app（MyClaudia 及未来其他 app）在后台收到 ntfy 推送时，以 **app 自身** 的名义弹出 Android 系统通知，点击通知打开对应 app。不依赖 ntfy app。

## 设计原则

1. **daemon 不感知具体 app** — app 主动注册订阅，daemon 纯转发
2. **多 app 复用** — 任何 app 都可以通过 HTTP API 注册，daemon 为每个订阅独立维护 SSE 连接
3. **多 ntfy server** — 每个订阅可指向不同的 ntfy server（自建或公共）
4. **零配置模块** — Magisk 模块安装即用，所有配置由 app 在运行时通过 API 提供
5. **显式广播投递** — `am broadcast -n pkg/receiver`，精确投递，其他 app 无法截获

## 架构总览

```
Server                    Gateway                  ntfy Server(s)
  │ event                    │                         │
  ├─ ws: push_notification ─→├─ HTTP POST ────────────→│
  │   _request               │  ntfy.example.com/topic │
  │                          │                         │
  │                          │                         │
  │                    Android Device                   │
  │              ┌─────────────────────────┐           │
  │              │  ntfy-bridge daemon     │           │
  │              │  (Go binary, root)      │           │
  │              │                         │←─ SSE ────┘
  │              │  127.0.0.1:9595        │
  │              │  - POST /subscribe     │ ←── app 注册
  │              │  - DELETE /subscribe   │ ←── app 注销
  │              │  - GET /status         │ ←── app 查询
  │              └────────┬───────────────┘
  │                       │ am broadcast -n pkg/receiver (显式)
  │          ┌────────────┼──────────────────┐
  │          ▼            ▼                  ▼
  │     MyClaudia      FutureApp1       FutureApp2
  │     NtfyReceiver   NtfyReceiver     AlertReceiver
  │     → 系统通知      → 系统通知        → 系统通知
  │     → 点击打开app   → 点击打开app     → 点击打开app
```

## 组件

### 1. ntfy-bridge Magisk 模块

#### 模块结构

```
ntfy-bridge/
├── module.prop
├── service.sh                # Magisk service.d 入口
├── system/                   # 空，无系统文件修改
└── bin/
    └── ntfy-bridged          # Go 编译的 daemon 二进制 (arm64)
```

#### module.prop

```ini
id=ntfy-bridge
name=ntfy Bridge
version=1.0.0
versionCode=1
author=zhvala
description=Background ntfy subscription daemon with app broadcast delivery
```

#### service.sh

```bash
#!/system/bin/sh
MODDIR=${0%/*}
DATADIR=/data/local/ntfy-bridge

mkdir -p $DATADIR

# 等待系统启动完成
while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 5; done
sleep 10

# 启动 daemon（仅监听 loopback）
nohup $MODDIR/bin/ntfy-bridged \
  -listen 127.0.0.1:9595 \
  -data $DATADIR \
  > $DATADIR/daemon.log 2>&1 &
```

#### Daemon HTTP API

固定地址 `127.0.0.1:9595`，不可配置（app 硬编码即可）。

**注册订阅**：

```
POST /subscribe
Content-Type: application/json

{
  "id": "com.myClaudia.desktop",
  "ntfy_url": "https://ntfy.example.com",
  "topic": "my-claudia-alerts",
  "package": "com.myClaudia.desktop",
  "receiver": ".NtfyReceiver"
}
```

- `id` — 订阅唯一标识（建议用包名）。重复注册会停掉旧 SSE 连接并替换。
- `ntfy_url` — ntfy server 地址（公共或自建均可）
- `topic` — ntfy topic
- `package` — Android 包名（广播目标）
- `receiver` — BroadcastReceiver 类名（相对于 package）

响应：`200 {"ok": true}`

#### HTTP API 详细约束

##### `POST /subscribe`

请求体 schema：

```json
{
  "id": "com.myClaudia.desktop",
  "ntfy_url": "https://ntfy.example.com",
  "topic": "my-claudia-alerts",
  "package": "com.myClaudia.desktop",
  "receiver": ".NtfyReceiver"
}
```

字段约束：

- `id`: 必填，`1-128` 字符；第一版强制等于 `package`
- `ntfy_url`: 必填，必须是合法 `http` / `https` URL；不允许 path/query/fragment，统一到 host 级别
- `topic`: 必填，`1-128` 字符；仅允许 ntfy topic 安全字符
- `package`: 必填，Android 包名格式
- `receiver`: 必填；允许 `.ReceiverName` 或完整类名

成功响应：

```json
{
  "ok": true,
  "subscription": {
    "id": "com.myClaudia.desktop",
    "connected": false,
    "status": "connecting"
  }
}
```

失败响应：

```json
{
  "ok": false,
  "error": {
    "code": "invalid_receiver",
    "message": "receiver must be relative or fully-qualified class name"
  }
}
```

错误码约定：

- `invalid_json`
- `missing_field`
- `invalid_id`
- `invalid_ntfy_url`
- `invalid_topic`
- `invalid_package`
- `invalid_receiver`
- `id_package_mismatch`
- `internal_error`

**取消订阅**：

```
DELETE /subscribe
Content-Type: application/json

{
  "id": "com.myClaudia.desktop"
}
```

响应：`200 {"ok": true}`

`DELETE /subscribe` 请求体 schema：

```json
{
  "id": "com.myClaudia.desktop"
}
```

成功响应：

```json
{
  "ok": true,
  "removed": true
}
```

说明：

- 删除不存在的订阅也返回 `200`，其中 `removed=false`
- 这样 app 侧可以安全重试，不需要先查状态

**查询状态**：

```
GET /status
```

响应：

```json
{
  "ok": true,
  "uptime": "2h35m",
  "subscriptions": {
    "com.myClaudia.desktop": {
      "ntfy_url": "https://ntfy.example.com",
      "topic": "my-claudia-alerts",
      "package": "com.myClaudia.desktop",
      "receiver": ".NtfyReceiver",
      "connected": true,
      "last_message_at": "2026-04-14T10:30:00Z"
    }
  }
}
```

`GET /status` 响应字段定义：

- `ok`: 固定 `true`
- `uptime`: daemon 启动到当前的运行时长
- `version`: daemon 版本号，便于后续排障
- `subscriptions`: 以 `id` 为 key 的订阅状态快照

每个订阅状态包含：

- `ntfy_url`
- `topic`
- `package`
- `receiver`
- `status`: `connecting` / `connected` / `backoff` / `stopped`
- `connected`: 便于 UI 快速判断的布尔字段
- `last_message_at`: 最近一次收到合法 ntfy message 的时间
- `last_connect_at`: 最近一次 SSE 建连成功时间
- `last_error`: 最近一次错误摘要，成功后可保留最近一条错误
- `retry_in_ms`: 当前退避剩余时间；非 backoff 状态下为 `0`

推荐响应示例：

```json
{
  "ok": true,
  "uptime": "2h35m",
  "version": "1.0.0",
  "subscriptions": {
    "com.myClaudia.desktop": {
      "ntfy_url": "https://ntfy.example.com",
      "topic": "my-claudia-alerts",
      "package": "com.myClaudia.desktop",
      "receiver": ".NtfyReceiver",
      "status": "connected",
      "connected": true,
      "last_message_at": "2026-04-14T10:30:00Z",
      "last_connect_at": "2026-04-14T10:25:12Z",
      "last_error": "",
      "retry_in_ms": 0
    }
  }
}
```

#### 广播 payload 协议（daemon → app）

为避免 ntfy 原始字段语义漂移，daemon 对外广播的 extras 固定为以下字段：

| Extra | 类型 | 说明 |
|------|------|------|
| `title` | string | 通知标题，缺失时回退到 app 名 |
| `body` | string | 通知正文 |
| `topic` | string | 当前订阅 topic |
| `tags` | string | ntfy tags 归一化后以逗号拼接 |
| `priority` | string | 归一化后的优先级：`min` / `low` / `default` / `high` / `max` |
| `message_id` | string | ntfy 消息 ID，缺失时为空字符串 |
| `timestamp` | string | RFC3339 时间戳，优先使用 ntfy 事件时间 |

说明：

- 不再直接传 `event_type`；业务侧如需事件类型，可自行从 `tags` 中解析。
- `priority` 由 daemon 统一做格式转换，app 不直接消费 ntfy 原始值。
- 所有 extras 都按字符串传输，app 侧只做展示和轻量跳转，不依赖隐式类型推断。

#### Daemon 核心逻辑 (Go)

#### 数据模型

建议的核心结构：

```go
type Subscription struct {
    ID       string `json:"id"`
    NtfyURL  string `json:"ntfy_url"`
    Topic    string `json:"topic"`
    Package  string `json:"package"`
    Receiver string `json:"receiver"`

    ctx        context.Context    `json:"-"`
    cancel     context.CancelFunc `json:"-"`
    statusMu   sync.RWMutex       `json:"-"`
    status     SubscriptionStatus `json:"-"`
}

type SubscriptionStatus struct {
    State         string    `json:"status"`
    Connected     bool      `json:"connected"`
    LastMessageAt time.Time `json:"last_message_at,omitempty"`
    LastConnectAt time.Time `json:"last_connect_at,omitempty"`
    LastError     string    `json:"last_error,omitempty"`
    RetryInMs     int64     `json:"retry_in_ms"`
}

type PersistedSubscriptions struct {
    Version       int                       `json:"version"`
    Subscriptions map[string]*Subscription  `json:"subscriptions"`
}
```

约束：

- `status` 是运行时状态，不持久化到 `subs.json`
- `subs.json` 需要带 `version`，为后续字段演进留空间
- `last_error` 仅用于诊断，不参与行为决策
- `ID` 作为唯一键，不支持同一 app 注册多个 topic；若未来需要多 topic，需显式升级模型

**订阅管理**（并发安全）：

```go
type Manager struct {
    mu       sync.RWMutex
    subs     map[string]*Subscription
    dataDir  string
}

func (m *Manager) Add(sub *Subscription) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if old, ok := m.subs[sub.ID]; ok {
        old.Stop()
    }
    m.subs[sub.ID] = sub
    go sub.StartSSE()
    m.persist()  // 原子写入：写临时文件 → rename
}

func (m *Manager) Remove(id string) {
    m.mu.Lock()
    defer m.mu.Unlock()
    if sub, ok := m.subs[id]; ok {
        sub.Stop()
        delete(m.subs, id)
        m.persist()
    }
}

func (m *Manager) List() map[string]SubStatus {
    m.mu.RLock()
    defer m.mu.RUnlock()
    // 返回快照
}
```

**SSE 订阅**（每个订阅一个 goroutine）：

```go
func (s *Subscription) StartSSE() {
    backoff := 5 * time.Second
    maxBackoff := 60 * time.Second

    for {
        select {
        case <-s.ctx.Done():
            return
        default:
        }

        s.setStatus("connecting", false, "", 0)

        err := s.connectAndListen()  // 阻塞直到断线
        if err != nil {
            s.setStatus("backoff", false, err.Error(), backoff.Milliseconds())
            log.Printf("[%s] SSE disconnected: %v, retry in %v", s.ID, err, backoff)
        }

        select {
        case <-s.ctx.Done():
            s.setStatus("stopped", false, "", 0)
            return
        case <-time.After(backoff):
        }

        backoff = min(backoff*2, maxBackoff)
    }
}

func (s *Subscription) connectAndListen() error {
    url := fmt.Sprintf("%s/%s/json", s.NtfyURL, s.Topic)
    req, err := http.NewRequest(http.MethodGet, url, nil)
    if err != nil {
        return err
    }

    client := &http.Client{
        Timeout: 0, // SSE 长连接不设总超时
    }

    resp, err := client.Do(req)
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode >= 400 {
        return fmt.Errorf("unexpected status: %d", resp.StatusCode)
    }

    s.markConnected()

    reader := bufio.NewReader(resp.Body)
    for {
        line, err := reader.ReadString('\n')
        if err != nil {
            if errors.Is(err, io.EOF) {
                return nil
            }
            return err
        }
        line = strings.TrimSpace(line)
        if line == "" {
            continue
        }
        var msg NtfyMessage
        if json.Unmarshal([]byte(line), &msg) == nil && msg.Event == "message" {
            s.deliver(msg)
            s.markMessageReceived()
        }
    }
}
```

SSE 行为约定：

- 每个订阅一个 goroutine，一条独立 SSE 连接
- 连接成功后将 backoff 重置为 `5s`
- `4xx` 视为配置错误，仍进入退避，但在 `last_error` 中保留 HTTP 状态码
- `5xx`、网络断开、DNS 失败都按可重试错误处理
- 忽略非 `message` 事件，但保留 debug 日志
- `http.Client.Timeout` 不设置总超时，避免主动切断 SSE；如需细粒度控制，可通过 `Transport` 配置连接超时和 keepalive

**广播投递**（`am broadcast` 显式发送）：

```go
func (s *Subscription) deliver(msg NtfyMessage) {
    normalized := normalizeMessage(msg, s.Topic)
    target := fmt.Sprintf("%s/%s", s.Package, s.Receiver)
    cmd := exec.Command("am", "broadcast",
        "-n", target,
        "--es", "title", normalized.Title,
        "--es", "body", normalized.Body,
        "--es", "topic", normalized.Topic,
        "--es", "tags", normalized.Tags,
        "--es", "priority", normalized.Priority,
        "--es", "message_id", normalized.MessageID,
        "--es", "timestamp", normalized.Timestamp,
    )
    if err := cmd.Run(); err != nil {
        log.Printf("[%s] broadcast failed: %v", s.ID, err)
    }
}
```

**DNS 处理**（Android 环境）：

```go
func init() {
    // Go 纯 Go DNS resolver，不依赖 CGO/libc
    net.DefaultResolver = &net.Resolver{PreferGo: true}
}
```

**持久化**（原子写入防 crash 损坏）：

```go
func (m *Manager) persist() {
    data, _ := json.MarshalIndent(m.exportSubs(), "", "  ")
    tmpFile := filepath.Join(m.dataDir, "subs.json.tmp")
    finalFile := filepath.Join(m.dataDir, "subs.json")
    os.WriteFile(tmpFile, data, 0600)
    os.Rename(tmpFile, finalFile)  // 原子操作
}
```

**启动恢复**：

```go
func (m *Manager) Load() error {
    data, err := os.ReadFile(filepath.Join(m.dataDir, "subs.json"))
    if err != nil {
        if errors.Is(err, os.ErrNotExist) {
            return nil
        }
        return err
    }

    var persisted PersistedSubscriptions
    if err := json.Unmarshal(data, &persisted); err != nil {
        return err
    }

    for _, sub := range persisted.Subscriptions {
        m.subs[sub.ID] = sub
        go sub.StartSSE()
    }
    return nil
}
```

daemon 启动流程约定为：

1. 初始化 `Manager`
2. 调用 `Load()` 恢复 `subs.json`
3. 为每个订阅重建 SSE 连接
4. 再启动 HTTP API 对外服务

这样设备重启、daemon crash 或 Magisk 重拉起后，订阅会自动恢复。

**输入校验**：

- `id` / `package` / `receiver` / `topic` / `ntfy_url` 必填
- `id` 必须等于 `package`
- `ntfy_url` 仅允许 `http` / `https`
- `receiver` 必须是 `.ReceiverName` 或完整类名
- `topic` 和各字段长度需要有上限，避免异常 payload
- 重复注册同一 `id` 时，替换旧 SSE 连接并持久化新配置

建议的长度上限：

- `id` / `package` / `receiver`: `<= 128`
- `topic`: `<= 128`
- `ntfy_url`: `<= 512`
- 广播给 app 的 `title`: `<= 120`
- 广播给 app 的 `body`: `<= 500`

**交叉编译**：

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -o ntfy-bridged -ldflags="-s -w" .
# 产出约 6-8MB 静态链接二进制，无外部依赖
```

**持久化文件** `/data/local/ntfy-bridge/subs.json`：

```json
{
  "version": 1,
  "subscriptions": {
    "com.myClaudia.desktop": {
      "id": "com.myClaudia.desktop",
      "ntfy_url": "https://ntfy.example.com",
      "topic": "my-claudia-alerts",
      "package": "com.myClaudia.desktop",
      "receiver": ".NtfyReceiver"
    },
    "com.futureapp": {
      "ntfy_url": "https://ntfy.sh",
      "topic": "futureapp-xyz",
      "package": "com.futureapp",
      "receiver": ".NtfyReceiver"
    }
  }
}
```

---

### 2. App 侧集成（以 MyClaudia 为例）

App 侧只需两件事：一个 Kotlin BroadcastReceiver + 一个 TS HTTP 客户端。

#### 2.1 BroadcastReceiver (Kotlin)

```kotlin
// NtfyReceiver.kt
package com.myClaudia.desktop

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

class NtfyReceiver : BroadcastReceiver() {

    companion object {
        const val CHANNEL_ID = "ntfy_alerts"
        private var notifId = 0
    }

    override fun onReceive(context: Context, intent: Intent) {
        val title = intent.getStringExtra("title")?.take(120)?.ifBlank { "MyClaudia" } ?: "MyClaudia"
        val body = intent.getStringExtra("body")?.take(500) ?: ""
        val tags = intent.getStringExtra("tags") ?: ""
        val messageId = intent.getStringExtra("message_id") ?: ""

        ensureChannel(context)

        val launchIntent = context.packageManager
            .getLaunchIntentForPackage(context.packageName)
            ?.apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("from_notification", true)
                putExtra("tags", tags)
                putExtra("message_id", messageId)
            }

        val pendingIntent = PendingIntent.getActivity(
            context, notifId, launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val priority = when (intent.getStringExtra("priority")) {
            "max", "high" -> NotificationCompat.PRIORITY_HIGH
            "low", "min" -> NotificationCompat.PRIORITY_LOW
            else -> NotificationCompat.PRIORITY_DEFAULT
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(priority)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val manager = context.getSystemService(NotificationManager::class.java)
        val stableId = if (messageId.isNotBlank()) messageId.hashCode() else notifId++
        manager.notify(stableId, notification)
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Ntfy Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Push notifications from ntfy-bridge"
            }
            context.getSystemService(NotificationManager::class.java)
                .createNotificationChannel(channel)
        }
    }
}
```

Receiver 行为约定：

- `message_id` 非空时用于通知去重；相同 `message_id` 覆盖旧通知
- 点击通知统一打开 app 主入口，不在 receiver 内直接做复杂业务跳转
- app 前台与后台都显示系统通知，避免前后台逻辑分叉
- 只消费固定 extras；忽略未知字段
- 如果 `getLaunchIntentForPackage()` 返回空，则仍展示通知，但不附带点击动作

#### 2.2 AndroidManifest.xml 追加

```xml
<receiver
    android:name=".NtfyReceiver"
    android:exported="true"
    android:enabled="true" />
```

#### 2.3 前端 API（TS，WebView 内调用）

```typescript
// apps/desktop/src/services/ntfyBridge.ts

const BRIDGE_URL = 'http://127.0.0.1:9595';

export async function registerNtfySubscription(config: {
  ntfyUrl: string;
  topic: string;
}): Promise<void> {
  const resp = await fetch(`${BRIDGE_URL}/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'com.myClaudia.desktop',
      ntfy_url: config.ntfyUrl,
      topic: config.topic,
      package: 'com.myClaudia.desktop',
      receiver: '.NtfyReceiver',
    }),
  });

  if (!resp.ok) {
    throw new Error(`subscribe failed: ${resp.status}`);
  }
}

export async function unregisterNtfySubscription(): Promise<void> {
  const resp = await fetch(`${BRIDGE_URL}/subscribe`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'com.myClaudia.desktop' }),
  });

  if (!resp.ok) {
    throw new Error(`unsubscribe failed: ${resp.status}`);
  }
}

export async function getNtfyBridgeStatus(): Promise<{
  ok: boolean;
  uptime?: string;
  subscriptions: Record<string, unknown>;
}> {
  try {
    const resp = await fetch(`${BRIDGE_URL}/status`);
    return await resp.json();
  } catch {
    return { ok: false, subscriptions: {} };
  }
}
```

前端行为约定：

- 设置页保存配置时，先写 gateway，再注册本地 daemon；本地注册失败时向用户展示降级提示
- daemon 不可达时，UI 不阻止保存远端 ntfy 配置，但明确提示“本机无法弹系统通知”
- `getNtfyBridgeStatus()` 用于轮询显示状态，不作为业务写入前置条件

#### 2.4 前端集成点

Gateway 设置页中（或独立 Notifications 页），用户配置 ntfy URL + topic 后：

1. 保存到 gateway（用于 server → gateway → ntfy 推送链路）
2. 同时调用 `registerNtfySubscription()` 注册到本地 daemon（用于 ntfy → 手机通知链路）
3. 设置页展示 daemon 状态（`getNtfyBridgeStatus()` 检查 daemon 是否运行 + 订阅是否活跃）
4. App 仅依赖固定广播协议，不直接解析 ntfy 原始 payload

---

## 完整推送链路

```
1. Server 产生事件（permission_request, run_completed 等）
       │
2. Server → Gateway (WebSocket: push_notification_request)
       │
3. Gateway 检查 NotificationConfig（事件类型是否启用）
       │
4. Gateway → ntfy Server (HTTP POST: ntfy.example.com/topic)
       │
5. ntfy Server 持有 SSE 连接 → ntfy-bridge daemon
       │
6. daemon 解析消息 → am broadcast -n pkg/receiver (显式)
       │
7. Android 唤起 NtfyReceiver → NotificationManager → 系统通知
       │
8. 用户点击通知 → PendingIntent → 打开 MyClaudia app
```

## Gateway → ntfy 消息约束

为避免 bridge 层消费到形态不稳定的 ntfy 消息，gateway 写入 ntfy 的 payload 需要统一：

```json
{
  "topic": "my-claudia-alerts",
  "title": "MyClaudia",
  "message": "Permission request requires your attention",
  "tags": ["permission_request"],
  "priority": 4
}
```

约定：

- `title` 和 `message` 由 gateway 生成，bridge 不再拼装业务文案
- `tags` 为数组；daemon 收到后归一化为逗号分隔字符串
- `priority` 使用 ntfy 原生优先级整数，由 daemon 统一映射到广播协议
- 建议网关只发送对用户可见的事件，不把纯内部同步事件推入 ntfy

推荐映射表：

| 事件 | ntfy `tags` | ntfy `priority` | 默认标题 |
|------|-------------|-----------------|----------|
| `permission_request` | `["permission_request"]` | `4` | `MyClaudia` |
| `run_completed` | `["run_completed"]` | `3` | `MyClaudia` |
| `run_failed` | `["run_failed"]` | `4` | `MyClaudia` |
| `mention` | `["mention"]` | `3` | `MyClaudia` |

## 保活策略

**ntfy-bridge daemon**：
- Magisk service.sh 开机自启，root 身份运行
- 不会被 Android 后台管理杀掉（不属于 app 进程）

**App 的 BroadcastReceiver**：
- 静态注册在 AndroidManifest.xml 中
- root `am broadcast` 可唤醒被杀 app 的 Receiver
- 配合 Magisk service.d 白名单脚本：

```bash
# /data/adb/service.d/app-keepalive.sh
#!/system/bin/sh
while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 5; done
sleep 15

# MyClaudia
PKG="com.myClaudia.desktop"
dumpsys deviceidle whitelist +$PKG
appops set $PKG RUN_IN_BACKGROUND allow
appops set $PKG RUN_ANY_IN_BACKGROUND allow

# 未来的其他 app 也可以加在这里
```

## 日志与可观测性

daemon 日志建议使用单行文本，统一前缀 `[subscription_id]`，至少覆盖：

- daemon 启动 / 停止
- 配置恢复结果
- 订阅新增 / 替换 / 删除
- SSE 建连成功
- SSE 断开与重试
- 广播投递成功 / 失败

示例：

```text
2026-04-14T18:22:01Z [system] daemon started listen=127.0.0.1:9595
2026-04-14T18:22:03Z [com.myClaudia.desktop] sse connected url=https://ntfy.example.com/my-claudia-alerts/json
2026-04-14T18:23:10Z [com.myClaudia.desktop] broadcast delivered message_id=abc123
2026-04-14T18:25:41Z [com.myClaudia.desktop] sse disconnected err=unexpected status: 502 retry_in=5000ms
```

说明：

- 第一版日志直接写入 `daemon.log` 即可，不做轮转
- `/status` 暴露最近状态，日志负责完整追踪
- 如后续发现日志过大，再补 rotate 机制

## 安全考虑

1. **网络隔离** — daemon 只监听 `127.0.0.1:9595`，外部不可访问
2. **精确投递** — 显式广播 `-n pkg/receiver`，其他 app 无法截获
3. **Topic 隐私** — ntfy topic 使用随机难猜字符串，防止第三方推送垃圾消息
4. **持久化安全** — `/data/local/ntfy-bridge/` 仅 root 可读写，普通 app 无法篡改订阅
5. **最小注册约束** — 第一版不做调用方强鉴权，但 daemon 需要校验字段合法性，并强制 `id == package`
6. **Receiver 输入兜底** — app 侧不信任广播 extras，所有字段都需要长度限制和默认值，避免异常 payload 影响通知展示

### 已知限制 / 后续加固

当前方案仍然存在一个低优先级本地安全缺口：任意本机 app 都可以访问 `127.0.0.1:9595`，理论上可伪造 `package` 调用 `/subscribe`，或直接向 exported receiver 发送显式广播。

这在个人自用场景下优先级可接受，但应明确记为后续加固项。推荐顺序：

1. `/subscribe` 引入 app token 或配对 token
2. 广播 extras 增加签名，receiver 校验后再展示通知
3. 如后续演进为多用户或公开分发，再考虑 Unix domain socket + peer credential 方案

## 兼容性

- **Go 二进制** — `CGO_ENABLED=0 GOOS=linux GOARCH=arm64`，静态链接，无 .so 依赖。已被大量 Magisk 模块验证（AdGuard、Clash 等）
- **DNS** — 使用 Go 纯 Go resolver（`PreferGo: true`），不依赖 `/etc/resolv.conf`
- **Android 版本** — BroadcastReceiver + NotificationManager 是 Android 基础 API，兼容 Android 8+
- **二进制大小** — 约 6-8MB（`-ldflags="-s -w"` strip 后）

## 实现边界

第一版明确不做：

- 调用方强鉴权（Unix domain socket / peer credential）
- 广播签名校验
- 多 topic 绑定到同一个 package
- 通知分组、通知动作按钮、富媒体通知
- daemon 日志轮转和远程诊断上报

第一版必须做到：

- 单 app 单 topic 稳定收通知
- 重复注册能替换旧连接
- 断线自动重连
- 设备重启后自动恢复订阅
- daemon 不可达时 UI 有明确状态提示

## 开发计划

### Phase 1: ntfy-bridge daemon (Go)
- [ ] Go 项目初始化 + 目录结构
- [ ] HTTP server（subscribe / unsubscribe / status）
- [ ] `/subscribe` 输入校验（必填项 / URL / receiver / `id == package`）
- [ ] 订阅管理器（sync.RWMutex 并发安全）
- [ ] SSE client（ntfy JSON 流 + 指数退避重连）
- [ ] 广播 payload 归一化（`tags` / `priority` / `message_id` / `timestamp`）
- [ ] `am broadcast` 投递
- [ ] 订阅持久化（subs.json 原子写入）
- [ ] 启动恢复（读取 subs.json 并自动重连）
- [ ] 日志输出
- [ ] 交叉编译 arm64
- [ ] Magisk 模块打包（module.prop + service.sh + binary）

### Phase 2: MyClaudia Android 集成
- [ ] NtfyReceiver (Kotlin BroadcastReceiver)
- [ ] Receiver extras 兜底（默认值 / 长度限制 / 固定字段协议）
- [ ] AndroidManifest.xml 注册 Receiver
- [ ] ntfyBridge.ts（前端 HTTP API 客户端）
- [ ] Gateway 设置页集成（配置 ntfy URL/topic → 同时注册到 gateway + daemon）
- [ ] 设置页展示 daemon 运行状态

### Phase 3: 测试 + 保活
- [ ] daemon 启动 / 重启 / crash 恢复
- [ ] SSE 断线重连
- [ ] 长消息 / 超长 body / 缺失字段的通知兼容性
- [ ] app 注册 / 注销 / 重复注册（替换旧订阅）
- [ ] 多 app 同时注册不同 topic
- [ ] 多 ntfy server 同时订阅
- [ ] 端到端：server 事件 → 手机通知
- [ ] app 被杀后仍能收到通知
- [ ] 设备重启后自动恢复所有订阅
- [ ] Magisk 保活脚本验证

## 验收标准

满足以下条件即可认为第一版可用：

1. App 在设置页填写 `ntfy_url + topic` 后，本地 daemon 注册成功，`/status` 可看到 `connected=true`
2. gateway 发送一条 `permission_request` 到 ntfy 后，Android 设备在 app 退到后台或被杀时仍能显示系统通知
3. 点击通知可打开 MyClaudia 主界面，并带上 `from_notification=true`
4. 关闭 ntfy server 或断网后，`/status` 进入 `backoff`，网络恢复后自动回到 `connected`
5. 重复调用 `/subscribe` 可替换旧配置，不留下僵尸 goroutine
6. 重启手机后，无需再次打开 app，daemon 能自动恢复订阅并继续收通知
