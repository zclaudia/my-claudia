#!/usr/bin/env node
/**
 * 快速测试并行运行器
 * 只运行 stores/hooks/utils/services（跳过组件测试）
 */

import { spawn } from 'child_process';
import { mkdir, writeFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// 颜色
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// 快速测试分组（不含组件测试）
const TEST_GROUPS = [
  { name: 'stores', dir: 'src/stores', timeout: 30 },
  { name: 'hooks-base', dir: 'src/hooks/__tests__', pattern: 'use*.test.ts', timeout: 30 },
  { name: 'hooks-transport', dir: 'src/hooks/transport/__tests__', timeout: 30 },
  { name: 'services', dir: 'src/services/__tests__', timeout: 60 },
  { name: 'utils', dirs: ['src/utils/__tests__', 'src/contexts/__tests__', 'src/plugins/__tests__', 'src/config/__tests__'], timeout: 30 },
];

// 并发限制
const MAX_PARALLEL = 3;

// 结果目录
const RESULTS_DIR = 'test-results';

async function setup() {
  if (!existsSync(RESULTS_DIR)) await mkdir(RESULTS_DIR, { recursive: true });
  
  // 清理旧结果
  try {
    const files = await readdirSafe(RESULTS_DIR);
    for (const file of files) {
      await rm(path.join(RESULTS_DIR, file), { force: true });
    }
  } catch {}
}

async function readdirSafe(dir) {
  try {
    const { readdir } = await import('fs/promises');
    return await readdir(dir);
  } catch {
    return [];
  }
}

function runTestGroup(group) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // 构建测试路径
    let testPaths = [];
    if (group.dir) {
      testPaths.push(group.dir);
    } else if (group.dirs) {
      testPaths.push(...group.dirs);
    }
    
    console.log(`${colors.blue}▶ Starting: ${group.name}${colors.reset}`);
    
    // 构建命令 - 使用 JSON reporter 获取准确结果
    const args = ['vitest', 'run', ...testPaths, '--reporter=json', '--reporter=dot'];
    
    const child = spawn('npx', args, {
      cwd: process.cwd(),
      stdio: 'pipe',
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    // 超时处理
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      console.log(`${colors.yellow}⚠ ${group.name} 超时，已终止${colors.reset}`);
    }, (group.timeout || 60) * 1000);
    
    child.on('close', async (code) => {
      clearTimeout(timeout);
      const duration = Math.round((Date.now() - startTime) / 1000);
      
      // 解析 JSON 结果 - vitest 在 JSON reporter 后输出 JSON
      let passed = 0;
      let failed = 0;
      
      try {
        // 查找 JSON 输出部分
        const jsonMatch = stdout.match(/\{[\s\S]*"numPassedTests":[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          passed = result.numPassedTests || 0;
          failed = result.numFailedTests || 0;
        }
      } catch (e) {
        // 降级到文本解析
        const testsMatch = stdout.match(/Tests\s+(\d+)\s+passed\s+\|\s+(\d+)\s+failed/);
        if (testsMatch) {
          passed = parseInt(testsMatch[1]);
          failed = parseInt(testsMatch[2]);
        }
      }
      
      // 保存日志
      await writeFile(
        path.join(RESULTS_DIR, `${group.name}.log`),
        `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
        'utf-8'
      );
      
      const result = {
        name: group.name,
        status: code === 0 ? 'PASSED' : 'FAILED',
        exitCode: code,
        duration,
        passed,
        failed,
      };
      
      await writeFile(
        path.join(RESULTS_DIR, `${group.name}.json`),
        JSON.stringify(result, null, 2),
        'utf-8'
      );
      
      if (code === 0) {
        console.log(`${colors.green}✓ ${group.name}: ${passed} passed (${duration}s)${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ ${group.name}: ${failed} failed (${duration}s)${colors.reset}`);
      }
      
      resolve(result);
    });
  });
}

async function runInBatches(groups, batchSize) {
  const results = [];
  
  for (let i = 0; i < groups.length; i += batchSize) {
    const batch = groups.slice(i, i + batchSize);
    console.log(`${colors.cyan}\n[批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(groups.length / batchSize)}] 运行 ${batch.length} 个组...${colors.reset}\n`);
    
    const batchResults = await Promise.all(batch.map(runTestGroup));
    results.push(...batchResults);
  }
  
  return results;
}

async function printSummary(results, totalTime) {
  console.log(`\n${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}  测试结果汇总                        ${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);
  
  let totalPassed = 0;
  let totalFailed = 0;
  const failedGroups = [];
  
  for (const result of results) {
    totalPassed += result.passed || 0;
    totalFailed += result.failed || 0;
    
    if (result.status === 'FAILED') {
      failedGroups.push(result);
      console.log(`${colors.red}✗ ${result.name}: ${result.failed} failed${colors.reset} (${result.duration}s)`);
    } else {
      console.log(`${colors.green}✓ ${result.name}: ${result.passed} passed${colors.reset} (${result.duration}s)`);
    }
  }
  
  console.log(`\n${colors.blue}----------------------------------------${colors.reset}`);
  console.log(`总计: ${colors.green}${totalPassed} passed${colors.reset}, ${colors.red}${totalFailed} failed${colors.reset}`);
  console.log(`并行时间: ${totalTime}s`);
  console.log(`${colors.blue}----------------------------------------${colors.reset}`);
  
  if (failedGroups.length > 0) {
    console.log(`\n${colors.red}失败的测试组:${colors.reset}`);
    return false;
  }
  
  console.log(`\n${colors.green}所有快速测试通过! ✓${colors.reset}`);
  return true;
}

async function main() {
  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}  Desktop 快速测试并行运行器          ${colors.reset}`);
  console.log(`${colors.blue}  (Stores/Hooks/Utils/Services)        ${colors.reset}`);
  console.log(`${colors.blue}  并发数: ${MAX_PARALLEL}               ${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);
  
  await setup();
  
  const startTime = Date.now();
  const results = await runInBatches(TEST_GROUPS, MAX_PARALLEL);
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  
  const success = await printSummary(results, totalTime);
  
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
  process.exit(1);
});
