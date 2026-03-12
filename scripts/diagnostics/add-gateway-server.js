// 在浏览器控制台中运行此脚本，快速添加 Gateway 服务器配置
// 使用方法：
//   1. 打开 http://localhost:1420
//   2. 打开开发者工具 Console
//   3. 复制粘贴此脚本并回车

(function addGatewayServer() {
  const STORAGE_KEY = 'my-claudia-servers';

  // Gateway 配置
  const GATEWAY_CONFIG = {
    name: 'Gateway Test',
    address: 'localhost:3200',
    gatewayUrl: 'ws://localhost:3200',
    gatewaySecret: 'test-secret-my-claudia-2026',
    // backendId: 'your-backend-id',  // 如果知道后端 ID，取消注释并填入
    // apiKey: 'your-api-key'         // 如果需要后端认证，取消注释并填入
  };

  try {
    // 读取当前配置
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.error('❌ 未找到服务器配置');
      return;
    }

    const data = JSON.parse(stored);

    // 检查是否已存在同名服务器
    const exists = data.state.servers.find(s => s.name === GATEWAY_CONFIG.name);
    if (exists) {
      console.log(`⚠️  服务器 "${GATEWAY_CONFIG.name}" 已存在`);
      console.log('   如需重新添加，请先删除旧配置或修改名称');
      return;
    }

    // 创建新服务器配置
    const newServer = {
      id: `gateway-${Date.now()}`,
      name: GATEWAY_CONFIG.name,
      address: GATEWAY_CONFIG.address,
      isDefault: false,
      requiresAuth: true,
      connectionMode: 'gateway',
      gatewayUrl: GATEWAY_CONFIG.gatewayUrl,
      gatewaySecret: GATEWAY_CONFIG.gatewaySecret,
      createdAt: Date.now()
    };

    // 添加可选字段
    if (GATEWAY_CONFIG.backendId) {
      newServer.backendId = GATEWAY_CONFIG.backendId;
    }
    if (GATEWAY_CONFIG.apiKey) {
      newServer.apiKey = GATEWAY_CONFIG.apiKey;
    }

    // 添加到服务器列表
    data.state.servers.push(newServer);

    // 保存
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    console.log('✅ Gateway 服务器已添加！');
    console.log('📋 服务器配置:');
    console.log('   名称:', newServer.name);
    console.log('   地址:', newServer.address);
    console.log('   Gateway URL:', newServer.gatewayUrl);
    console.log('   连接模式:', newServer.connectionMode);
    console.log('');
    console.log('🔄 请刷新页面以应用配置');
    console.log('');

    // 询问是否立即刷新
    if (confirm('是否立即刷新页面以应用新配置？')) {
      location.reload();
    }
  } catch (error) {
    console.error('❌ 添加服务器失败:', error);
  }
})();
