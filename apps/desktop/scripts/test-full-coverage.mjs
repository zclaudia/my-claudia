#!/usr/bin/env node
/**
 * 完整单元测试覆盖率统计
 * 并行运行所有测试并合并覆盖率报告
 */

import { spawn } from 'child_process';
import { mkdir, writeFile, rm, readdir } from 'fs/promises';
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

// 所有测试分组
const TEST_GROUPS = [
  { name: 'stores', dir: 'src/stores', timeout: 60 },
  { name: 'hooks-base', dir: 'src/hooks/__tests__', pattern: 'use*.test.ts', timeout: 60 },
  { name: 'hooks-transport', dir: 'src/hooks/transport/__tests__', timeout: 60 },
  { name: 'services', dir: 'src/services/__tests__', timeout: 120 },
  { name: 'utils', dirs: ['src/utils/__tests__', 'src/contexts/__tests__', 'src/plugins/__tests__', 'src/config/__tests__'], timeout: 60 },
  { name: 'components-base', dirs: ['src/components/__tests__', 'src/components/ui/__tests__'], timeout: 120 },
  { name: 'components-chat', dirs: ['src/components/chat/__tests__', 'src/components/chat'], timeout: 120 },
  { name: 'components-dashboard', dir: 'src/components/dashboard/__tests__', timeout: 60 },
  { name: 'components-fileviewer', dir: 'src/components/fileviewer/__tests__', timeout: 60 },
  { name: 'components-local-prs', dir: 'src/components/local-prs/__tests__', timeout: 60 },
  { name: 'components-permission', dir: 'src/components/permission/__tests__', timeout: 60 },
  { name: 'components-sidebar', dir: 'src/components/sidebar/__tests__', timeout: 60 },
  { name: 'components-supervision', dir: 'src/components/supervision/__tests__', timeout: 60 },
  { name: 'components-terminal', dir: 'src/components/terminal/__tests__', timeout: 60 },
  { name: 'components-workflows', dirs: ['src/components/workflows/__tests__', 'src/components/workflows/edges/__tests__', 'src/components/workflows/nodes/__tests__'], timeout: 120 },
  { name: 'components-agent', dir: 'src/components/agent/__tests__', timeout: 60 },
  { name: 'components-scheduled-tasks', dir: 'src/components/scheduled-tasks/__tests__', timeout: 60 },
];

// 并发限制 - 减少并发避免资源争抢
const MAX_PARALLEL = 2;

// 结果目录
const RESULTS_DIR = 'test-results-full';
const COVERAGE_DIR = 'coverage-full';

async function setup() {
  if (!existsSync(RESULTS_DIR)) await mkdir(RESULTS_DIR, { recursive: true });
  if (!existsSync(COVERAGE_DIR)) await mkdir(COVERAGE_DIR, { recursive: true });
  
  // 清理旧结果
  try {
    const files = await readdir(RESULTS_DIR);
    for (const file of files) {
      await rm(path.join(RESULTS_DIR, file), { force: true });
    }
  } catch {}
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
    
    console.log(`${colors.blue}▶ [${new Date().toLocaleTimeString()}] Starting: ${group.name}${colors.reset}`);
    
    const coverageDir = path.join(COVERAGE_DIR, group.name);
    
    // 构建命令
    const args = [
      'vitest', 'run',
      ...testPaths,
      '--reporter=json',
      '--coverage',
      '--coverage.reporter=json',
      `--coverage.dir=${coverageDir}`,
    ];
    
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
    
    // 超时处理 - 增加到 5 分钟
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      console.log(`${colors.yellow}⚠ ${group.name} 超时，已终止${colors.reset}`);
    }, (group.timeout || 300) * 1000);
    
    child.on('close', async (code) => {
      clearTimeout(timeout);
      const duration = Math.round((Date.now() - startTime) / 1000);
      
      // 解析结果
      let passed = 0;
      let failed = 0;
      
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*"numPassedTests":[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          passed = result.numPassedTests || 0;
          failed = result.numFailedTests || 0;
        }
      } catch (e) {
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
        coverageDir,
      };
      
      await writeFile(
        path.join(RESULTS_DIR, `${group.name}.json`),
        JSON.stringify(result, null, 2),
        'utf-8'
      );
      
      if (code === 0) {
        console.log(`${colors.green}✓ [${new Date().toLocaleTimeString()}] ${group.name}: ${passed} passed (${duration}s)${colors.reset}`);
      } else {
        console.log(`${colors.red}✗ [${new Date().toLocaleTimeString()}] ${group.name}: ${failed} failed, ${passed} passed (${duration}s)${colors.reset}`);
      }
      
      resolve(result);
    });
  });
}

async function runInBatches(groups, batchSize) {
  const results = [];
  
  for (let i = 0; i < groups.length; i += batchSize) {
    const batch = groups.slice(i, i + batchSize);
    console.log(`${colors.cyan}\n========== 批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(groups.length / batchSize)} (${batch.length} 个组) ==========${colors.reset}\n`);
    
    const batchResults = await Promise.all(batch.map(runTestGroup));
    results.push(...batchResults);
  }
  
  return results;
}

async function mergeCoverage() {
  console.log(`\n${colors.blue}正在合并覆盖率报告...${colors.reset}`);
  
  const coverageFiles = [];
  for (const group of TEST_GROUPS) {
    const coverageFile = path.join(COVERAGE_DIR, group.name, 'coverage-final.json');
    if (existsSync(coverageFile)) {
      coverageFiles.push(coverageFile);
    }
  }
  
  if (coverageFiles.length === 0) {
    console.log(`${colors.yellow}没有找到覆盖率文件${colors.reset}`);
    return null;
  }
  
  console.log(`${colors.blue}找到 ${coverageFiles.length} 个覆盖率文件${colors.reset}`);
  
  // 合并覆盖率数据
  const merged = {
    total: { lines: { total: 0, covered: 0 }, statements: { total: 0, covered: 0 }, functions: { total: 0, covered: 0 }, branches: { total: 0, covered: 0 } },
    files: {},
  };
  
  for (const file of coverageFiles) {
    try {
      const data = JSON.parse(await readFile(file, 'utf-8'));
      
      // 合并文件数据
      for (const [filename, fileData] of Object.entries(data)) {
        if (filename === 'total') continue;
        
        if (!merged.files[filename]) {
          merged.files[filename] = { ...fileData };
        } else {
          // 合并同一文件的覆盖率（取并集）
          merged.files[filename].lines.total += fileData.lines.total;
          merged.files[filename].lines.covered += fileData.lines.covered;
          merged.files[filename].statements.total += fileData.statements.total;
          merged.files[filename].statements.covered += fileData.statements.covered;
          merged.files[filename].functions.total += fileData.functions.total;
          merged.files[filename].functions.covered += fileData.functions.covered;
          merged.files[filename].branches.total += fileData.branches.total;
          merged.files[filename].branches.covered += fileData.branches.covered;
        }
      }
    } catch (e) {
      console.log(`${colors.yellow}警告: 无法解析 ${file}${colors.reset}`);
    }
  }
  
  // 计算总计
  for (const fileData of Object.values(merged.files)) {
    merged.total.lines.total += fileData.lines.total;
    merged.total.lines.covered += fileData.lines.covered;
    merged.total.statements.total += fileData.statements.total;
    merged.total.statements.covered += fileData.statements.covered;
    merged.total.functions.total += fileData.functions.total;
    merged.total.functions.covered += fileData.functions.covered;
    merged.total.branches.total += fileData.branches.total;
    merged.total.branches.covered += fileData.branches.covered;
  }
  
  // 计算百分比
  const calculatePct = (covered, total) => total === 0 ? 100 : Math.round((covered / total) * 100 * 100) / 100;
  
  const summary = {
    lines: { pct: calculatePct(merged.total.lines.covered, merged.total.lines.total), ...merged.total.lines },
    statements: { pct: calculatePct(merged.total.statements.covered, merged.total.statements.total), ...merged.total.statements },
    functions: { pct: calculatePct(merged.total.functions.covered, merged.total.functions.total), ...merged.total.functions },
    branches: { pct: calculatePct(merged.total.branches.covered, merged.total.branches.total), ...merged.total.branches },
    files: Object.keys(merged.files).length,
  };
  
  // 保存合并后的覆盖率
  await writeFile(
    path.join(COVERAGE_DIR, 'coverage-merged.json'),
    JSON.stringify({ ...merged, summary }, null, 2),
    'utf-8'
  );
  
  return summary;
}

async function printSummary(results, coverage, totalTime) {
  console.log(`\n${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}  完整测试结果汇总                    ${colors.reset}`);
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
  console.log(`测试总计: ${colors.green}${totalPassed} passed${colors.reset}, ${colors.red}${totalFailed} failed${colors.reset}`);
  console.log(`并行时间: ${totalTime}s`);
  console.log(`${colors.blue}----------------------------------------${colors.reset}`);
  
  if (coverage) {
    console.log(`\n${colors.blue}========================================${colors.reset}`);
    console.log(`${colors.blue}  覆盖率统计                          ${colors.reset}`);
    console.log(`${colors.blue}========================================${colors.reset}\n`);
    
    console.log(`${colors.cyan}指标          覆盖率      已覆盖 / 总计${colors.reset}`);
    console.log(`-------------------------------------------`);
    console.log(`Statements    ${coverage.statements.pct.toFixed(2)}%      ${coverage.statements.covered} / ${coverage.statements.total}`);
    console.log(`Branches      ${coverage.branches.pct.toFixed(2)}%      ${coverage.branches.covered} / ${coverage.branches.total}`);
    console.log(`Functions     ${coverage.functions.pct.toFixed(2)}%      ${coverage.functions.covered} / ${coverage.functions.total}`);
    console.log(`Lines         ${coverage.lines.pct.toFixed(2)}%      ${coverage.lines.covered} / ${coverage.lines.total}`);
    console.log(`-------------------------------------------`);
    console.log(`Files: ${coverage.files}`);
    console.log(`\n${colors.blue}合并后的覆盖率报告: ${COVERAGE_DIR}/coverage-merged.json${colors.reset}`);
  }
  
  if (failedGroups.length > 0) {
    console.log(`\n${colors.red}失败的测试组:${colors.reset}`);
    return false;
  }
  
  console.log(`\n${colors.green}所有测试通过! ✓${colors.reset}`);
  return true;
}

async function main() {
  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}  Desktop 完整单元测试覆盖率统计      ${colors.reset}`);
  console.log(`${colors.blue}  并发数: ${MAX_PARALLEL}               ${colors.reset}`);
  console.log(`${colors.blue}  分组数: ${TEST_GROUPS.length}          ${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);
  
  await setup();
  
  const startTime = Date.now();
  const results = await runInBatches(TEST_GROUPS, MAX_PARALLEL);
  
  // 合并覆盖率
  const coverage = await mergeCoverage();
  
  const totalTime = Math.round((Date.now() - startTime) / 1000);
  
  // 汇总结果
  const success = await printSummary(results, coverage, totalTime);
  
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error(`${colors.red}错误: ${err.message}${colors.reset}`);
  process.exit(1);
});
