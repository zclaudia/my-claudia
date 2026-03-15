#!/usr/bin/env node
/**
 * 并行测试运行器
 * 将测试拆分成多个组并行执行，汇总结果
 */

import { spawn } from 'child_process';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 颜色
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// 测试分组定义 - 使用目录路径
const TEST_GROUPS = [
  { name: 'stores', dir: 'src/stores', concurrent: true },
  { name: 'hooks-base', dir: 'src/hooks/__tests__', pattern: 'use*.test.ts', concurrent: true },
  { name: 'hooks-transport', dir: 'src/hooks/transport/__tests__', concurrent: true },
  { name: 'components-base', dirs: ['src/components/__tests__', 'src/components/ui/__tests__'], concurrent: true },
  { name: 'components-chat', dirs: ['src/components/chat/__tests__', 'src/components/chat'], pattern: '*.test.tsx', concurrent: true },
  { name: 'components-dashboard', dir: 'src/components/dashboard/__tests__', concurrent: true },
  { name: 'components-fileviewer', dir: 'src/components/fileviewer/__tests__', concurrent: true },
  { name: 'components-local-prs', dir: 'src/components/local-prs/__tests__', concurrent: true },
  { name: 'components-permission', dir: 'src/components/permission/__tests__', concurrent: true },
  { name: 'components-sidebar', dir: 'src/components/sidebar/__tests__', concurrent: true },
  { name: 'components-supervision', dir: 'src/components/supervision/__tests__', concurrent: true },
  { name: 'components-terminal', dir: 'src/components/terminal/__tests__', concurrent: true },
  { name: 'components-workflows', dirs: ['src/components/workflows/__tests__', 'src/components/workflows/edges/__tests__', 'src/components/workflows/nodes/__tests__'], concurrent: true },
  { name: 'components-agent', dir: 'src/components/agent/__tests__', concurrent: true },
  { name: 'components-scheduled-tasks', dir: 'src/components/scheduled-tasks/__tests__', concurrent: true },
  { name: 'services', dir: 'src/services/__tests__', concurrent: true },
  { name: 'utils', dirs: ['src/utils/__tests__', 'src/contexts/__tests__', 'src/plugins/__tests__', 'src/config/__tests__'], concurrent: true },
];

// 并发限制
const MAX_PARALLEL = 4;

// 结果目录
const RESULTS_DIR = 'test-results';
const COVERAGE_DIR = 'coverage-parallel';

async function setup() {
  if (!existsSync(RESULTS_DIR)) await mkdir(RESULTS_DIR, { recursive: true });
  if (!existsSync(COVERAGE_DIR)) await mkdir(COVERAGE_DIR, { recursive: true });
  
  // 清理旧结果
  const files = await readdirSafe(RESULTS_DIR);
  for (const file of files) {
    await rm(path.join(RESULTS_DIR, file), { force: true });
  }
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
    const coverageDir = path.join(COVERAGE_DIR, group.name);
    
    // 构建测试路径
    let testPaths = [];
    if (group.dir) {
      testPaths.push(group.dir);
    } else if (group.dirs) {
      testPaths.push(...group.dirs);
    }
    
    console.log(`${colors.blue}▶ Starting group: ${group.name}${colors.reset}`);
    
    // 构建命令
    const args = [
      'vitest', 'run',
      ...testPaths,
      '--reporter=verbose',
    ];
    
    // 只在需要时添加覆盖率
    if (process.argv.includes('--coverage')) {
      args.push('--coverage');
      args.push('--coverage.reporter=text');
      args.push(`--coverage.dir=${coverageDir}`);
    }
    
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
    
    child.on('close', async (code) => {
      const duration = Math.round((Date.now() - startTime) / 1000);
      
      // 解析结果
      const passed = (stdout.match(/✓/g) || []).length;
      const failed = (stdout.match(/✗/g) || []).length;
      
      // 保存日志
      await writeFile(
        path.join(RESULTS_DIR, `${group.name}.log`),
        `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
        'utf-8'
      );
      
      // 保存结果
      const result = {
        name: group.name,
        status: code === 0 ? 'PASSED' : 'FAILED',
        exitCode: code,
        duration,
        passed,
        failed,
        coverageDir,
      };
      
      await writeFile(
        path.join(RESULTS_DIR, `${group.name}.json`),
        JSON.stringify(result, null, 2),
        'utf-8'
      );
      
      if (code === 0) {
        console.log(`${colors.green}✓ ${group.name}: ${passed} passed (${duration}s)${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ ${group.name}: ${failed} failed, ${passed} passed (${duration}s)${colors.reset}`);
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
    totalPassed += result.passed;
    totalFailed += result.failed;
    
    if (result.status === 'FAILED') {
      failedGroups.push(result);
      console.log(`${colors.red}✗ ${result.name}: ${result.failed} failed${colors.reset} (${result.duration}s)`);
    } else {
      console.log(`${colors.green}✓ ${result.name}: ${result.passed} passed${colors.reset} (${result.duration}s)`);
    }
  }
  
  console.log(`\n${colors.blue}----------------------------------------${colors.reset}`);
  console.log(`总计: ${colors.green}${totalPassed} passed${colors.reset}, ${colors.red}${totalFailed} failed${colors.reset}`);
  console.log(`时间: ${totalTime}s (串行预估: ~${totalTime * MAX_PARALLEL}s)`);
  console.log(`${colors.blue}----------------------------------------${colors.reset}`);
  
  // 显示失败详情
  if (failedGroups.length > 0) {
    console.log(`\n${colors.red}失败的测试组详情:${colors.reset}\n`);
    for (const group of failedGroups) {
      console.log(`${colors.yellow}${group.name}:${colors.reset}`);
      try {
        const log = await readFile(path.join(RESULTS_DIR, `${group.name}.log`), 'utf-8');
        // 只显示错误相关的行
        const errorLines = log
          .split('\n')
          .filter(line => line.includes('FAIL') || line.includes('Error') || line.includes('expected'))
          .slice(0, 10);
        console.log(errorLines.join('\n'));
      } catch {
        console.log('(无法读取日志)');
      }
      console.log('');
    }
    return false;
  }
  
  console.log(`\n${colors.green}所有测试通过! ✓${colors.reset}`);
  return true;
}

async function main() {
  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}  Desktop 并行测试运行器              ${colors.reset}`);
  console.log(`${colors.blue}  并发数: ${MAX_PARALLEL}               ${colors.reset}`);
  console.log(`${colors.blue}  分组数: ${TEST_GROUPS.length}          ${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);
  
  await setup();
  
  const startTime = Date.now();
  
  // 按批次并行运行
  const results = await runInBatches(TEST_GROUPS, MAX_PARALLEL);
  
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  
  // 汇总结果
  const success = await printSummary(results, totalTime);
  
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
  process.exit(1);
});
