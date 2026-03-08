# Server Gateway UI 配置指南

现在你可以直接在 UI 中配置 Server 是否连接到 Gateway，无需手动编辑环境变量或配置文件！

## 🎉 新功能

你现在可以：
- ✅ 在 UI 中开启/关闭 Gateway 连接
- ✅ 配置 Gateway URL 和密钥
- ✅ 设置后端显示名称
- ✅ 实时查看连接状态和 Backend ID
- ✅ 一键连接/断开 Gateway

## 📍 在哪里配置

1. **打开应用** - http://localhost:1420
2. **打开设置** - 点击右上角的设置图标 ⚙️
3. **选择 Gateway 标签** - 在设置面板中选择 "Gateway" 标签

> ⚠️ **注意**：Gateway 标签只在**本地连接**到 Server 时显示（即 UI 和 Server 在同一台机器上）

## 🔧 配置步骤

### 1. 启用 Gateway 连接

在 Gateway 配置页面：

1. **打开开关** - 将 "Enable Gateway Connection" 切换为开启
2. **填写配置**：
   - **Gateway URL**: `http://localhost:3200` (或你的 Gateway 地址)
   - **Gateway Secret**: `test-secret-my-claudia-2026` (你的 Gateway 密钥)
   - **Backend Name**: `My Mac` (可选，显示名称)

3. **保存配置** - 点击 "Save Configuration" 按钮

### 2. 连接到 Gateway

保存配置后：

- 如果一切正常，Server 会自动尝试连接到 Gateway
- 你可以在状态区域看到连接状态
- 成功后会显示 Backend ID

如果需要手动连接/断开：
- 点击 "Connect" 按钮连接
- 点击 "Disconnect" 按钮断开

## 📊 状态说明

**Status 字段显示：**
- 🟢 **Connected** - 已成功连接到 Gateway
- 🟡 **Connecting...** - 正在连接中
- ⚪ **Disabled** - 未启用 Gateway 连接

**Backend ID：**
- 连接成功后会显示 Gateway 分配的 Backend ID
- 客户端可以使用这个 ID 来连接你的 Server

## 🔄 完整流程示例

### 场景：在家里的 Mac 上配置 Server 连接到 Gateway

1. **启动服务**
   ```bash
   # 启动 Server（默认不连接 Gateway）
   pnpm dev
   ```

2. **打开 UI**
   - 访问 http://localhost:1420
   - 打开设置 → Gateway 标签

3. **配置 Gateway**
   - 启用开关：✅ 开启
   - Gateway URL: `http://localhost:3200`
   - Gateway Secret: `test-secret-my-claudia-2026`
   - Backend Name: `Home Mac`
   - 点击 "Save Configuration"

4. **查看状态**
   - Status: Connected ✅
   - Backend ID: `backend-xxx-xxx-xxx`

5. **在手机上连接**
   - 打开手机上的 UI
   - 添加服务器，选择 Gateway 模式
   - 填写 Gateway 信息和 Backend ID
   - 连接成功！

## 🔍 故障排查

### 问题：保存后没有连接

**可能原因：**
1. Gateway 服务未运行
2. Gateway URL 或 Secret 不正确
3. 网络连接问题

**解决方法：**
1. 检查 Gateway 是否运行：
   ```bash
   curl http://localhost:3200/health
   ```
2. 验证配置信息
3. 查看 Server 日志中的错误信息
4. 点击 "Connect" 按钮手动重试

### 问题：无法看到 Gateway 标签

**原因：**
- 你不是本地连接（从远程访问的 Server）

**解决方法：**
- Gateway 配置只能在本地 Server 上进行
- 请在运行 Server 的机器上访问 UI

### 问题：Backend ID 没有显示

**可能原因：**
1. Gateway 注册失败
2. 需要等待几秒钟

**解决方法：**
1. 等待 5-10 秒后刷新状态
2. 查看 Server 日志确认注册是否成功
3. 尝试断开后重新连接

## 📝 配置存储

配置保存在 Server 的数据库中：
- 位置：`~/.my-claudia/data.db`
- 表：`gateway_config`
- Server 重启后配置会自动加载

## 🔐 安全提示

1. **Gateway Secret 是敏感信息**
   - 只在必要时输入
   - UI 中显示为 `********`
   - 留空表示保持现有密钥

2. **本地配置功能**
   - Gateway 配置 API 只能从本地访问
   - 远程客户端无法修改 Server 的 Gateway 配置

3. **数据库加密**
   - 建议对包含 Gateway Secret 的数据库文件设置适当的文件权限
   - 考虑使用加密文件系统

## 🆚 环境变量 vs UI 配置

### 优先级

1. **环境变量**（最高优先级）
   ```bash
   GATEWAY_URL=http://localhost:3200 \
   GATEWAY_SECRET=my-secret \
   pnpm dev
   ```

2. **数据库配置**（通过 UI 设置）
   - 只在没有环境变量时使用

### 推荐使用场景

- **环境变量**：Docker 部署、自动化脚本
- **UI 配置**：日常使用、快速测试

## 📚 相关文档

- [Gateway 连接指南](./gateway-connection-guide.md) - 客户端连接 Gateway 的详细说明
- [技术规格](./technical-spec.md) - 完整的系统架构文档

## 🎯 下一步

配置完成后，你可以：

1. **测试连接** - 使用 Gateway 测试脚本验证
2. **配置客户端** - 在另一台设备上连接到你的 Backend
3. **监控状态** - 定期查看 Gateway 标签确认连接正常
4. **备份配置** - 导出数据库以备份配置

---

**提示**：如果遇到问题，请查看：
- Server 控制台日志
- Gateway 控制台日志
- Browser 开发者工具 Console
