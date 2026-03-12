#!/usr/bin/env node

/**
 * 测试 Kimi SDK 事件解析
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

const kimiPath = '/Users/zhvala/.local/bin/kimi';

async function testSdk() {
  console.log('=== Kimi SDK 事件解析测试 ===\n');

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--prompt', 'Say "hello world"',
    '--yolo',
    '--work-dir', process.cwd()
  ];

  console.log('启动 kimi:', kimiPath, args.join(' '));
  console.log('');

  const proc = spawn(kimiPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  // 记录 stderr
  proc.stderr?.on('data', (data) => {
    console.error('[stderr]', data.toString());
  });

  let eventCount = 0;
  let parsedCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    eventCount++;
    console.log(`\n--- 原始事件 #${eventCount} ---`);
    console.log(line.substring(0, 200) + (line.length > 200 ? '...' : ''));

    try {
      const event = JSON.parse(line);
      parsedCount++;

      // 模拟 SDK 的事件处理
      const role = event.role;
      const type = event.type;

      console.log('\n--- 解析结果 ---');
      console.log('role:', role);
      console.log('type:', type);

      if (!type && role === 'assistant' && Array.isArray(event.content)) {
        console.log('✅ 检测到新格式 (无 type, 有 role + content 数组)');
        console.log('content 数量:', event.content.length);

        for (const block of event.content) {
          const blockType = block.type;
          if (blockType === 'think') {
            console.log('  📝 思考块:', block.think?.substring(0, 50) + '...');
          } else if (blockType === 'text') {
            console.log('  📄 文本块:', block.text?.substring(0, 50) + '...');
          } else {
            console.log('  ❓ 未知块类型:', blockType);
          }
        }
      } else if (type) {
        console.log('✅ 检测到标准格式 (有 type 字段)');
      } else {
        console.log('⚠️ 未知格式');
      }
    } catch (err) {
      console.log('❌ JSON 解析失败:', err.message);
    }
  }

  console.log('\n=== 测试完成 ===');
  console.log(`总事件数: ${eventCount}`);
  console.log(`成功解析: ${parsedCount}`);

  proc.kill();
}

testSdk().catch(console.error);
