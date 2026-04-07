# `server/src/router`

这里不是 Express / HTTP REST router。

这个目录当前承载的是 **WebSocket message routing**：
- 根据共享协议里的 `request.type` 分发消息
- 组合消息级 middleware
- 给旧的 WS CRUD message handlers 提供注册入口

当前 HTTP API surface 的真实装配入口在：
- [server/src/server-setup.ts](/Users/zhvala/SourceCode/my-claudia/server/src/server-setup.ts)

当前职责边界：
- `server/src/routes/`: HTTP controllers / REST routes
- `server/src/router/`: WebSocket message router
- `server/src/handlers/`: WebSocket message handlers
- `server/src/middleware/`: WebSocket message middleware

如果后续做目录重命名，`router/` 更准确的名字会是 `message-router/`。
