# Gateway 连接指南

本指南说明如何在 UI 中连接到 Gateway 服务器。

## 架构概览

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Desktop UI │ ◄─WS──► │   Gateway   │ ◄─WS──► │   Server    │
│  (客户端)   │         │  (中继服务) │         │  (后端)     │
└─────────────┘         └─────────────┘         └─────────────┘
     手机/远程              localhost:3200          localhost:3100
```

**连接模式：**
1. **Direct 模式** (默认): UI 直接连接 Server (适合本地使用)
2. **Gateway 模式**: UI 通过 Gateway 连接 Server (适合远程访问)

## 当前测试环境

- **Server**: http://localhost:3100 (WebSocket: ws://localhost:3100/ws)
- **Gateway**: http://localhost:3200 (WebSocket: ws://localhost:3200/ws)
- **Gateway Secret**: `test-secret-my-claudia-2026`
- **Desktop UI**: http://localhost:1420

## 在 UI 中连接 Gateway

### 方式一：使用代码 (开发调试)

在你的 UI 代码中使用 `useServerStore` 配置 Gateway 连接：

```typescript
import { useServerStore } from '@/stores/serverStore';

// 添加一个 Gateway 连接的服务器
const addGatewayServer = () => {
  const { addServer, setGatewayConfig } = useServerStore.getState();

  // 1. 添加服务器配置
  const server = addServer({
    name: '远程 Gateway 连接',
    address: 'localhost:3200',  // Gateway 地址
    isDefault: false
  });

  // 2. 设置 Gateway 配置
  setGatewayConfig(server.id, {
    gatewayUrl: 'ws://localhost:3200',  // Gateway WebSocket URL
    gatewaySecret: 'test-secret-my-claudia-2026',  // Gateway 密钥
    backendId: 'your-backend-id'  // 可选：指定后端 ID
  });

  // 3. 设置 API Key (用于后端认证)
  // setApiKey(server.id, 'your-server-api-key');
};
```

### 方式二：使用 UI 界面 (推荐用户使用)

应用启动后，在服务器设置界面：

1. **添加新服务器**
   - 服务器名称: `远程 Gateway`
   - 连接模式: 选择 `Gateway`

2. **Gateway 配置**
   - Gateway URL: `ws://localhost:3200`
   - Gateway Secret: `test-secret-my-claudia-2026`

3. **后端配置** (可选)
   - Backend ID: 如果已知后端 ID，填入
   - API Key: 用于后端认证的密钥

4. **连接**
   - 点击连接按钮
   - UI 会自动：
     1. 连接 Gateway
     2. 认证 Gateway Secret
     3. 列出可用后端
     4. 连接到指定的后端

### 方式三：LocalStorage 手动配置

打开浏览器开发者工具，执行：

```javascript
// 获取当前服务器配置
const data = JSON.parse(localStorage.getItem('my-claudia-servers'));

// 添加 Gateway 服务器
const newServer = {
  id: 'gateway-test',
  name: 'Gateway Test',
  address: 'localhost:3200',
  isDefault: false,
  requiresAuth: true,
  connectionMode: 'gateway',
  gatewayUrl: 'ws://localhost:3200',
  gatewaySecret: 'test-secret-my-claudia-2026',
  createdAt: Date.now()
};

data.state.servers.push(newServer);
localStorage.setItem('my-claudia-servers', JSON.stringify(data));

// 刷新页面
location.reload();
```

## 连接流程详解

当 UI 使用 Gateway 模式连接时，会自动执行以下步骤：

### 1. 连接 Gateway
```
Client -> Gateway: WebSocket 连接 ws://localhost:3200/ws
```

### 2. Gateway 认证
```json
Client -> Gateway: {
  "type": "gateway_auth",
  "gatewaySecret": "test-secret-my-claudia-2026"
}

Gateway -> Client: {
  "type": "gateway_auth_result",
  "success": true
}
```

### 3. 列出可用后端
```json
Client -> Gateway: {
  "type": "list_backends"
}

Gateway -> Client: {
  "type": "backends_list",
  "backends": [
    {
      "backendId": "backend-123",
      "name": "My Mac",
      "online": true
    }
  ]
}
```

### 4. 连接到后端
```json
Client -> Gateway: {
  "type": "connect_backend",
  "backendId": "backend-123",
  "apiKey": "your-server-api-key"
}

Gateway -> Client: {
  "type": "backend_auth_result",
  "backendId": "backend-123",
  "success": true
}
```

### 5. 发送消息到后端
```json
Client -> Gateway: {
  "type": "send_to_backend",
  "backendId": "backend-123",
  "message": {
    "type": "run_start",
    "sessionId": "session-456",
    "input": "Hello"
  }
}

Gateway -> Client: {
  "type": "backend_message",
  "backendId": "backend-123",
  "message": {
    "type": "delta",
    "content": "Hi!"
  }
}
```

## 测试验证

### 1. 检查 Gateway 状态
```bash
curl http://localhost:3200/health
```

预期输出：
```json
{
  "status": "ok",
  "backends": 0,
  "clients": 0
}
```

### 2. 使用测试脚本
```bash
cd gateway
node test-ws.mjs
```

### 3. 在 UI 中验证
打开浏览器开发者工具 Console，查看连接日志：
```
[Gateway] Connecting to: ws://localhost:3200/ws
[Gateway] Connected, authenticating...
[Gateway] Authenticated to gateway
[Gateway] Available backends: [...]
```

## 常见问题

### Q: Gateway 认证失败
**错误**: `Invalid gateway secret`

**解决**:
- 检查 Gateway Secret 是否正确
- 确认 Gateway 服务正在运行
- 查看 Gateway 日志

### Q: 找不到后端
**错误**: `Backend not found or offline`

**解决**:
- 确认 Server 是否在运行
- Server 需要先注册到 Gateway
- 检查 backendId 是否正确

### Q: 无法发送消息
**错误**: `Not authenticated to this backend`

**解决**:
- 确认已成功连接到后端
- 检查 API Key 是否有效
- 查看认证状态

## 代码参考

关键文件：
- [useGatewaySocket.ts](../apps/desktop/src/hooks/useGatewaySocket.ts) - Gateway 连接逻辑
- [useConnection.ts](../apps/desktop/src/hooks/useConnection.ts) - 连接模式选择
- [serverStore.ts](../apps/desktop/src/stores/serverStore.ts) - 服务器配置管理
- [Gateway 服务器](../gateway/src/server.ts) - Gateway 实现

## 下一步

1. 实现 Server 注册到 Gateway 的功能
2. 在 UI 中添加 Gateway 配置界面
3. 支持多后端切换
4. 添加 TLS 支持用于生产环境
