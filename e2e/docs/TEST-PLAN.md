# My Claudia — 功能清单与 E2E 测试计划

## 一、已实现功能清单

### 1. 项目与会话管理

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 创建项目 | 输入名称和工作目录创建项目 | Sidebar.tsx, api.ts, routes/projects.ts |
| 删除项目 | 右键菜单删除项目及关联数据 | Sidebar.tsx |
| 项目设置 | 编辑项目名称、工作目录、Provider | ProjectSettings.tsx |
| 创建会话 | 在项目下创建新会话 | Sidebar.tsx |
| 删除会话 | 右键菜单删除会话 | Sidebar.tsx |
| 会话切换 | 点击切换不同会话，加载对应消息 | Sidebar.tsx, ChatInterface.tsx |
| 侧边栏折叠 | 桌面端可折叠/展开侧边栏 | Sidebar.tsx |
| 移动端抽屉 | 移动端侧边栏以抽屉形式显示 | Sidebar.tsx |

### 2. 聊天功能

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 发送消息 | 输入文本按 Enter 发送 | MessageInput.tsx, ChatInterface.tsx |
| 流式响应 | 实时显示 Claude 返回的内容 | ChatInterface.tsx, useUnifiedSocket.ts |
| 消息分页 | 滚动到顶部自动加载历史消息 | ChatInterface.tsx |
| 工具调用显示 | 展示 Claude 使用的工具及结果 | ToolCallItem.tsx |
| 加载指示器 | 等待响应时显示加载动画 | LoadingIndicator.tsx |
| 取消运行 | 运行中可取消当前请求 | ChatInterface.tsx |
| Markdown 渲染 | 消息支持 Markdown 格式显示 | MessageList.tsx |
| Tool 结果持久化 | tool_use/tool_result 写入 metadata，刷新后恢复 | server.ts, chatStore.ts, MessageList.tsx |
| 内联 Diff 视图 | Edit tool 自动显示红删绿增的 diff | DiffViewer.tsx, ToolCallItem.tsx |
| 终端风格 Bash 输出 | 深色背景、等宽字体、默认 10 行 + "展开全部" | ToolCallItem.tsx |
| Model 切换 | 工具栏下拉选择 Default/Opus/Sonnet/Haiku | ModelSelector.tsx, ChatInterface.tsx |
| Token 用量显示 | 显示累计 input/output tokens，接近上限变色 | TokenUsageDisplay.tsx, chatStore.ts |
| Compact 快捷按钮 | 工具栏按钮触发 /compact 命令压缩上下文 | ChatInterface.tsx |
| 字体大小切换 | 小/中/大三档字体大小调整 | FontSizeSelector.tsx |

### 3. 斜杠命令 (/)

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 命令下拉菜单 | 输入 `/` 显示可用命令列表 | MessageInput.tsx |
| 命令过滤 | 继续输入可过滤命令 | MessageInput.tsx |
| 内置命令 | /clear, /help, /status, /cost, /model, /memory | ChatInterface.tsx |
| 插件命令 | 来自 Claude 插件的命令（/commit 等） | ChatInterface.tsx |
| 无 Provider 回退 | 未配置 Provider 时加载默认命令 | ChatInterface.tsx |

### 4. 文件引用 (@)

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 文件浏览器 | 输入 `@` 显示项目目录结构 | MessageInput.tsx |
| 目录导航 | 点击目录进入子目录 | MessageInput.tsx |
| 文件选择 | 选择文件插入到消息中 | MessageInput.tsx |
| 模糊搜索 | 输入路径片段过滤文件 | MessageInput.tsx, routes/files.ts |

### 5. 文件上传与附件

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 按钮上传 | 点击附件按钮选择文件 | MessageInput.tsx |
| 拖拽上传 | 拖拽文件到输入区域 | MessageInput.tsx |
| 粘贴上传 | Cmd+V 粘贴图片 | MessageInput.tsx |
| 图片预览 | 上传图片显示缩略图 | MessageInput.tsx |
| 文件大小限制 | 超过 10MB 拒绝上传 | routes/files.ts |

### 6. 权限系统

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 权限请求弹窗 | 工具执行前请求用户授权 | PermissionModal.tsx |
| 倒计时自动拒绝 | 超时自动拒绝权限请求 | PermissionModal.tsx |
| 记住决定 | 可勾选记住本次决定 | PermissionModal.tsx |
| 权限模式切换 | Default / Plan / Auto-Edit / Bypass | PermissionModeToggle.tsx |

### 7. 服务器管理

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 服务器选择器 | 顶部下拉切换服务器 | ServerSelector.tsx |
| 添加服务器 | 配置地址、API Key、Client ID | SettingsPanel.tsx |
| 连接模式 | 直连 (Direct) 或 Gateway 中继 | ServerSelector.tsx |
| 连接状态显示 | 实时显示连接/断开/重连状态 | ServerSelector.tsx |

### 8. Gateway 中继

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| Gateway 配置 | 配置 URL、Secret、Backend ID | ServerGatewayConfig.tsx |
| 多后端支持 | 同一 Gateway 连接多个后端 | gateway/src/ |
| HTTP 代理 | REST API 通过 Gateway 转发 | gateway/src/server.ts |
| NAT 穿透 | 通过中继服务器穿透防火墙 | gateway/src/ |

### 9. Provider 管理

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 添加 Provider | 配置 AI 提供商（Claude/自定义） | ProviderManager.tsx |
| 编辑 Provider | 修改名称、CLI 路径、环境变量 | ProviderManager.tsx |
| 删除 Provider | 删除 Provider 配置 | ProviderManager.tsx |

### 10. 会话导入

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 扫描 Claude CLI | 自动发现本地 Claude CLI 会话 | ImportDialog.tsx |
| 选择导入 | 勾选要导入的会话 | ImportDialog.tsx |
| 冲突处理 | 跳过/覆盖/重命名已存在的会话 | ImportDialog.tsx |
| 进度显示 | 导入过程显示进度条 | ImportDialog.tsx |

### 11. 设置面板

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 主题切换 | 深色/浅色主题 | ThemeToggle.tsx |
| API Key 管理 | 查看/重新生成 API Key | ApiKeyManager.tsx |
| SOCKS5 代理 | 配置代理服务器连接 | ServerGatewayConfig.tsx |
| 系统信息 | 显示版本、模型、连接信息 | SystemInfoButton.tsx |

### 12. 会话管理增强

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 会话导出 Markdown | 导出完整会话为 Markdown（消息 + tool 摘要 + token 统计） | sessions.ts, api.ts, Sidebar.tsx |
| 跨会话全文搜索 | FTS5 全文搜索消息内容，300ms debounce | sessions.ts, db.ts, Sidebar.tsx |
| 搜索结果导航 | 点击搜索结果跳转到对应会话 | Sidebar.tsx |

### 13. 移动端触控优化

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| 44px 最小触控区域 | 所有按钮和可交互元素 ≥ 44x44px | Sidebar.tsx, PermissionModal.tsx |
| active: 触控反馈 | 触摸时有 active 状态高亮样式 | 各组件 |
| 移动端上下文菜单 | 三点菜单按钮增大触控区域 | Sidebar.tsx |

### 14. 安全特性

| 功能 | 描述 | 关键文件 |
|------|------|----------|
| API Key 认证 | 所有 HTTP/WS 请求需认证 | server.ts |
| 路径遍历防护 | 文件操作检查路径安全 | routes/files.ts |
| 本地限制 | 敏感操作仅允许本地访问 | server.ts |

---

## 二、E2E 测试计划

### 测试策略说明

**编程式测试 (Playwright API)**：适用于精确断言、数据验证、API 测试、性能测试、安全测试。
**自然语言测试 (Stagehand AI)**：适用于模拟真实用户交互、探索性测试、UI 可用性验证、跨页面工作流。

标记说明：
- 🤖 = 自然语言 (Stagehand `act` / `extract` / `observe`)
- 🔧 = 编程式 (Playwright locators / assertions)
- 🔀 = 混合模式（两者结合）

---

### 模块 A：项目与会话管理

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| A1 | 创建项目（填写名称和工作目录） | 🤖 | 自然语言填表更贴近用户行为 |
| A2 | 创建项目后自动展开并选中 | 🔧 | 需要精确验证 DOM 状态 |
| A3 | 创建项目时名称为空应禁用按钮 | 🔧 | 验证 disabled 属性 |
| A4 | 取消创建项目应清空表单 | 🤖 | 自然语言："Click cancel and verify the form disappears" |
| A5 | 删除项目（含确认流程） | 🤖 | 自然语言点击菜单更自然 |
| A6 | 删除项目后关联会话也被删除 | 🔧 | 需要精确验证列表内容 |
| A7 | 创建会话（可选名称） | 🤖 | 自然语言："Create a new session named Test Session" |
| A8 | 删除会话 | 🤖 | 自然语言操作右键菜单 |
| A9 | 切换会话加载对应消息历史 | 🔀 | AI 操作切换，编程式验证消息内容 |
| A10 | 侧边栏折叠与展开 | 🤖 | 自然语言："Collapse the sidebar, then expand it" |
| A11 | 多项目之间数据隔离 | 🔧 | 需要精确断言数据不串 |

### 模块 B：聊天核心功能

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| B1 | 发送文本消息并收到响应 | 🔀 | AI 输入消息，编程式验证响应出现 |
| B2 | 空消息不应发送 | 🔧 | 验证按钮 disabled 状态 |
| B3 | 流式响应实时显示 | 🔧 | 需要精确监控 DOM 更新 |
| B4 | 消息分页：滚动到顶部加载更多 | 🔀 | AI 执行滚动，编程式验证消息数量变化 |
| B5 | 工具调用展示（工具名称和结果） | 🔧 | 需要精确验证工具调用结构 |
| B6 | 取消正在进行的运行 | 🤖 | 自然语言："Click the cancel button to stop the current run" |
| B7 | 消息中的 Markdown 正确渲染 | 🔀 | AI 发送含 Markdown 的消息，extract 验证渲染结果 |
| B8 | 发送消息后自动滚动到底部 | 🔧 | 需要精确计算滚动位置 |

### 模块 C：斜杠命令 (/)

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| C1 | 输入 `/` 显示命令列表 | 🤖 | 自然语言："Type / in the message input" |
| C2 | 输入 `/cl` 过滤出 /clear | 🔀 | AI 输入，编程式验证过滤结果 |
| C3 | 选择 /clear 清空聊天记录 | 🤖 | 自然语言："Select the /clear command from the dropdown" |
| C4 | 选择 /help 显示帮助信息 | 🤖 | 自然语言操作，extract 验证帮助内容 |
| C5 | 选择 /status 显示系统状态 | 🔀 | AI 操作，编程式验证状态字段 |
| C6 | 选择 /model 显示模型信息 | 🤖 | 自然语言操作，extract 提取模型名称 |
| C7 | 无 Provider 时仍显示默认命令 | 🔧 | 需要精确验证命令列表内容 |
| C8 | 插件命令显示来源标识 | 🔧 | 验证 DOM 中的 plugin 标签 |
| C9 | Escape 键关闭命令菜单 | 🔧 | 需要精确的键盘事件和 DOM 断言 |

### 模块 D：文件引用 (@)

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| D1 | 输入 `@` 显示目录浏览器 | 🤖 | 自然语言："Type @ in the message input" |
| D2 | 点击目录进入子目录 | 🤖 | 自然语言："Click on the apps directory" |
| D3 | 选择文件插入路径到消息 | 🤖 | 自然语言："Select the package.json file" |
| D4 | 输入路径片段模糊过滤 | 🔀 | AI 输入过滤词，编程式验证结果数量 |
| D5 | 无工作目录时不显示 @ 浏览器 | 🔧 | 需要精确验证下拉菜单不出现 |
| D6 | 目录列表排序（文件夹优先） | 🔧 | 需要精确验证列表顺序 |
| D7 | 隐藏文件和 node_modules 不显示 | 🔧 | 需要精确验证列表内容 |

### 模块 E：文件上传

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| E1 | 点击按钮上传图片 | 🤖 | 自然语言："Click the attachment button and upload an image" |
| E2 | 拖拽文件到输入区域上传 | 🔧 | 拖拽事件需要编程式模拟 |
| E3 | Cmd+V 粘贴图片上传 | 🔧 | 需要编程式模拟剪贴板事件 |
| E4 | 图片预览缩略图显示 | 🔀 | 上传后 observe 检查预览区域 |
| E5 | 超过 10MB 文件被拒绝 | 🔧 | 需要精确验证错误提示 |
| E6 | 多文件同时上传 | 🔧 | 需要编程式设置多个文件 |
| E7 | 删除已添加的附件 | 🤖 | 自然语言："Remove the attached file" |

### 模块 F：权限系统

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| F1 | 权限请求弹窗显示工具信息 | 🔀 | extract 提取弹窗中的工具名称 |
| F2 | 点击允许继续执行 | 🤖 | 自然语言："Click Allow in the permission dialog" |
| F3 | 点击拒绝终止执行 | 🤖 | 自然语言："Click Deny in the permission dialog" |
| F4 | 倒计时结束自动拒绝 | 🔧 | 需要精确等待计时器 |
| F5 | 勾选记住决定后不再弹窗 | 🔀 | AI 勾选，编程式验证后续不弹窗 |
| F6 | 切换权限模式（Default→Plan） | 🤖 | 自然语言："Switch to Plan mode" |
| F7 | Plan 模式下输入框提示语变化 | 🔧 | 需要精确验证 placeholder 文本 |
| F8 | Bypass 模式不弹权限窗 | 🔧 | 需要精确验证无弹窗出现 |

### 模块 G：服务器管理

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| G1 | 服务器选择器显示当前服务器 | 🔀 | extract 提取服务器名称 |
| G2 | 打开设置面板添加新服务器 | 🤖 | 自然语言完成整个添加流程 |
| G3 | 切换服务器后重新连接 | 🔀 | AI 切换服务器，编程式验证连接状态 |
| G4 | 断开连接后显示重连状态 | 🔧 | 需要精确验证状态指示器 |
| G5 | 无效服务器地址显示错误 | 🔀 | AI 输入无效地址，编程式验证错误提示 |

### 模块 H：Gateway 中继

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| H1 | 配置 Gateway URL 和 Secret | 🤖 | 自然语言填写表单 |
| H2 | 连接 Gateway 显示成功状态 | 🔧 | 需要精确验证连接状态 |
| H3 | 通过 Gateway 发送消息 | 🔀 | AI 操作，编程式验证消息到达 |
| H4 | Gateway 断开后自动重连 | 🔧 | 需要精确监控连接事件 |
| H5 | HTTP API 通过 Gateway 代理 | 🔧 | 需要验证网络请求路径 |

### 模块 I：设置面板

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| I1 | 打开设置面板 | 🤖 | 自然语言："Click the Settings button" |
| I2 | 切换深色/浅色主题 | 🤖 | 自然语言："Switch to light theme" |
| I3 | 主题切换后页面样式变化 | 🔀 | AI 切换，extract 验证背景色 |
| I4 | 查看 API Key（脱敏显示） | 🔀 | observe 查找 Security tab，extract 提取脱敏 Key |
| I5 | 重新生成 API Key | 🤖 | 自然语言："Regenerate the API key" |
| I6 | 各 Tab 切换正常 | 🤖 | 自然语言依次点击每个 Tab |

### 模块 J：会话导入

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| J1 | 打开导入面板 | 🤖 | 自然语言："Open the Import tab in settings" |
| J2 | 扫描 Claude CLI 目录 | 🔀 | AI 点击扫描，编程式验证结果列表 |
| J3 | 选择会话并导入 | 🤖 | 自然语言："Select the first session and click Import" |
| J4 | 导入进度条显示 | 🔧 | 需要精确验证进度百分比 |
| J5 | 冲突处理（跳过/覆盖/重命名） | 🔀 | AI 选择处理方式，编程式验证结果 |
| J6 | 导入后会话出现在列表中 | 🔀 | 导入完成后 extract 验证会话名称 |

### 模块 K：安全测试

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| K1 | 路径遍历攻击（../../../etc/passwd） | 🔧 | 需要精确构造恶意路径 |
| K2 | XSS 注入防护 | 🔧 | 需要精确构造恶意脚本 |
| K3 | SQL 注入防护 | 🔧 | 需要精确构造恶意 SQL |
| K4 | 无 API Key 访问被拒绝 | 🔧 | 需要精确验证 401 响应 |
| K5 | 上传可执行文件被拒绝 | 🔧 | 需要精确构造恶意文件 |
| K6 | 文件大小超限被拒绝 | 🔧 | 需要精确构造大文件 |

### 模块 L：性能测试

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| L1 | 页面首次加载时间 < 3s | 🔧 | 需要精确测量加载时间 |
| L2 | 100 条消息渲染性能 | 🔧 | 需要精确测量渲染帧率 |
| L3 | 大量文件的目录浏览响应 | 🔧 | 需要精确测量 API 响应时间 |
| L4 | 并发文件上传 (10 files) | 🔧 | 需要精确验证完成时间和结果 |
| L5 | 内存占用在合理范围内 | 🔧 | 需要精确测量 JS 堆内存 |

### 模块 M：跨功能工作流

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| M1 | 完整工作流：创建项目→创建会话→发送消息→查看响应 | 🤖 | 全程自然语言操作最贴近用户 |
| M2 | 导入会话→继续对话→上传文件→发送 | 🤖 | 自然语言串联多步骤操作 |
| M3 | 多项目切换并验证数据隔离 | 🔀 | AI 操作切换，编程式验证隔离性 |
| M4 | 使用 / 命令切换模式后发送消息 | 🤖 | 自然语言操作命令菜单 |
| M5 | 文件 @ 引用后发送带附件消息 | 🤖 | 自然语言："Type @ select package.json then send a message asking about it" |
| M6 | 断网重连后消息不丢失 | 🔀 | 编程式模拟断网，AI 验证恢复 |
| M7 | 页面刷新后数据持久化 | 🔀 | 编程式刷新页面，extract 验证数据恢复 |

### 模块 N：Tool 持久化与 Diff 视图

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| N1 | 发消息触发 tool 调用后刷新页面，tool 结果仍显示 | 🔧 | 编程式刷新 + 验证 metadata 中 toolCalls 恢复 |
| N2 | Edit tool 输出自动显示内联 diff（红删绿增） | 🔧 | 验证 DiffViewer 渲染 +/- 行和颜色 |
| N3 | Bash tool 输出以终端风格显示（深色背景等宽字体） | 🔧 | 验证 CSS class 和样式属性 |
| N4 | 终端输出默认折叠 10 行，点击展开全部 | 🔀 | AI 点击展开，编程式验证行数变化 |
| N5 | Tool 调用状态图标（running/completed/error） | 🔧 | 验证 status icon 和颜色变化 |

### 模块 O：开发效率工具

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| O1 | Model 切换器显示当前模型名称并可切换 | 🤖 | 自然语言："Select Sonnet from the model dropdown" |
| O2 | 切换 Model 后发消息，run_start 包含新 model | 🔧 | 拦截 WebSocket 消息验证 model 字段 |
| O3 | Token 用量显示并随每次对话累加 | 🔧 | 发送消息后验证 token 计数增加 |
| O4 | Token 超过 80% 上限时显示红色警告 | 🔧 | 注入大量 token 数据验证颜色变化 |
| O5 | 点击 Compact 按钮发送 /compact 命令 | 🤖 | 自然语言："Click the Compact button in the toolbar" |
| O6 | 字体大小切换在 Small/Medium/Large 间切换 | 🤖 | 自然语言操作字体按钮 |

### 模块 P：会话管理增强

| # | 测试用例 | 方式 | 说明 |
|---|---------|------|------|
| P1 | 右键菜单导出会话为 Markdown 文件 | 🤖 | 自然语言："Click export in the session menu" |
| P2 | 导出内容包含消息、时间戳和 tool 调用摘要 | 🔧 | API 直接调用验证返回的 markdown 内容结构 |
| P3 | 搜索框输入关键词返回匹配消息列表 | 🔀 | AI 输入搜索词，编程式验证结果数量和内容 |
| P4 | 搜索 debounce 300ms 后才发出 HTTP 请求 | 🔧 | 监控网络请求计时验证防抖 |
| P5 | 点击搜索结果跳转到对应会话并高亮 | 🤖 | 自然语言点击搜索结果 |
| P6 | 搜索结果跨项目，不受当前选中项目限制 | 🔧 | 创建多项目多会话验证搜索范围 |

---

## 三、测试分布统计

| 方式 | 数量 | 占比 |
|------|------|------|
| 🤖 自然语言 | 36 | 37% |
| 🔧 编程式 | 41 | 42% |
| 🔀 混合模式 | 20 | 21% |
| **合计** | **97** | **100%** |

### 自然语言测试的优势场景

1. **表单填写流程**（A1, A7, G2, H1）— 贴近真实用户操作
2. **菜单导航操作**（A5, A8, C3, I6）— 无需记忆 data-testid
3. **多步骤工作流**（M1, M2, M4, M5）— 自然描述复杂操作
4. **UI 交互探索**（A10, B6, D1, D2）— 以用户视角验证
5. **信息提取验证**（C6, I4, G1）— extract 结构化提取页面数据

### 编程式测试的优势场景

1. **精确断言**（A3, B2, C9）— disabled 属性、DOM 状态
2. **安全测试**（K1-K6）— 需要精确构造恶意输入
3. **性能测试**（L1-L5）— 需要精确测量时间和内存
4. **事件模拟**（E2, E3）— 拖拽、剪贴板等浏览器事件
5. **网络监控**（H5, G4）— 请求路径和状态码验证

---

## 四、与现有测试的对应关系

| 现有测试文件 | 覆盖模块 | 状态 |
|-------------|---------|------|
| example.spec.ts | 基础冒烟 | ✅ 已有 |
| http-migration-api.spec.ts | G (API 层) | ✅ 已有 |
| http-migration.spec.ts | G (UI 层) | ✅ 已有 |
| user-workflows.spec.ts | M1-M3 部分 | ✅ 已有 |
| file-upload.spec.ts | E1-E6 | ✅ 已有 |
| session-import.spec.ts | J1-J6 | ✅ 已有 |
| performance.spec.ts | L1-L5 | ✅ 已有 |
| security.spec.ts | K1-K6 | ✅ 已有 |
| socks5-proxy.spec.ts | H (代理部分) | ✅ 已有 |
| shared/chat.spec.ts | B1 部分 | ✅ 已有 |
| slash-commands.spec.ts | C1-C9 | ✅ 已有 |
| file-reference.spec.ts | D1-D7 | ✅ 已有 |
| permission-system.spec.ts | F1-F8 | ✅ 已有 |
| settings-panel.spec.ts | I1-I6 | ✅ 已有 |
| project-management.spec.ts | A1-A11 | ✅ 已有 |
| workflows.spec.ts | M1-M7 | ✅ 已有 |
| tool-persistence.spec.ts | N1-N5 | ❌ 待新增 |
| dev-tools.spec.ts | O1-O6 | ❌ 待新增 |
| session-management.spec.ts | P1-P6 | ❌ 待新增 |

---

## 五、优先级建议

### P0 — 核心功能（应首先实现）
- **C1-C9**: 斜杠命令 — 刚修复的功能，需要回归测试
- **D1-D7**: 文件引用 — 刚修复的功能，需要回归测试
- **M1**: 完整工作流 — 端到端验证核心路径
- **N1**: Tool 持久化 — 移动端数据不丢失的核心保障

### P1 — 重要功能
- **A1-A11**: 项目管理完整测试
- **B1-B8**: 聊天核心功能
- **F1-F8**: 权限系统
- **N2-N5**: Diff 视图和终端输出 — 代码审查核心
- **O1-O4**: Model/Token — 开发成本控制

### P2 — 辅助功能
- **I1-I6**: 设置面板
- **M2-M7**: 跨功能工作流
- **E7**: 删除附件
- **G2-G5**: 服务器管理 UI
- **O5-O6**: Compact 和字体 — 开发效率辅助
- **P1-P6**: 会话导出和搜索 — 长期开发组织
