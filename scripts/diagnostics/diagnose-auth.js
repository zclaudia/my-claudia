#!/usr/bin/env node

// 诊断认证和数据加载问题

console.log('=== MyClaudia 诊断工具 ===\n');

async function diagnose() {
  const baseUrl = 'http://localhost:3100';

  // 1. 检查 Server Info
  console.log('1. 检查 Server Info...');
  try {
    const infoRes = await fetch(`${baseUrl}/api/server/info`);
    const info = await infoRes.json();
    console.log('   ✅ Server Info:', JSON.stringify(info.data, null, 2));
  } catch (err) {
    console.log('   ❌ Server Info 失败:', err.message);
    return;
  }

  // 2. 检查 API Key
  console.log('\n2. 检查 API Key...');
  try {
    const keyRes = await fetch(`${baseUrl}/api/auth/key`);
    const keyData = await keyRes.json();
    if (keyData.success) {
      console.log('   ✅ API Key:', keyData.data.maskedKey);
      console.log('   完整 Key:', keyData.data.fullKey);

      const apiKey = keyData.data.fullKey;

      // 3. 验证 API Key
      console.log('\n3. 验证 API Key...');
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (verifyRes.ok) {
        console.log('   ✅ API Key 验证成功');
      } else {
        console.log('   ❌ API Key 验证失败:', verifyRes.status);
        return;
      }

      // 4. 测试 Projects API
      console.log('\n4. 测试 Projects API...');
      const projectsRes = await fetch(`${baseUrl}/api/projects`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      const projectsData = await projectsRes.json();
      if (projectsData.success) {
        console.log(`   ✅ Projects: ${projectsData.data.length} 个`);
        projectsData.data.forEach(p => {
          console.log(`      - ${p.name} (${p.type})`);
        });
      } else {
        console.log('   ❌ Projects 失败:', projectsData.error);
      }

      // 5. 测试 Providers API
      console.log('\n5. 测试 Providers API...');
      const providersRes = await fetch(`${baseUrl}/api/providers`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      const providersData = await providersRes.json();
      if (providersData.success) {
        console.log(`   ✅ Providers: ${providersData.data.length} 个`);
        providersData.data.forEach(p => {
          console.log(`      - ${p.name} (${p.type})${p.isDefault ? ' [默认]' : ''}`);
        });
      } else {
        console.log('   ❌ Providers 失败:', providersData.error);
      }

    } else {
      console.log('   ❌ 无法获取 API Key:', keyData.error);
    }
  } catch (err) {
    console.log('   ❌ API Key 检查失败:', err.message);
  }

  console.log('\n=== 诊断完成 ===');
  console.log('\n建议：');
  console.log('1. 在浏览器访问 http://localhost:1420');
  console.log('2. 打开开发者工具 Console 标签');
  console.log('3. 检查是否有认证相关的错误');
  console.log('4. 如果看到 API Key，在 Console 中执行：');
  console.log('   localStorage.setItem("my-claudia-servers", JSON.stringify({...JSON.parse(localStorage.getItem("my-claudia-servers")), state: {...JSON.parse(localStorage.getItem("my-claudia-servers")).state, servers: JSON.parse(localStorage.getItem("my-claudia-servers")).state.servers.map(s => s.name === "Local Server" ? {...s, apiKey: "<API_KEY>"} : s)}}))');
}

diagnose().catch(console.error);
