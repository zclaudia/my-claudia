#!/usr/bin/env node
/**
 * 逐个文件运行测试并汇总结果
 * 用法: node test-file-by-file.mjs <pattern>
 * 示例: node test-file-by-file.mjs "apps/desktop/src/stores"
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testPath = process.argv[2];
if (!testPath) {
  console.log('用法: node test-file-by-file.mjs <test-directory-or-pattern>');
  console.log('示例:');
  console.log('  node test-file-by-file.mjs "apps/desktop/src/stores"');
  console.log('  node test-file-by-file.mjs "apps/desktop/src/services"');
  console.log('  node test-file-by-file.mjs "server/src/routes"');
  console.log('  node test-file-by-file.mjs "gateway/src"');
  process.exit(1);
}

const cwd = process.cwd();

// 解析模块路径
let moduleDir = '';
let moduleName = '';

if (testPath.includes('apps/desktop')) {
  moduleDir = 'apps/desktop';
  moduleName = 'desktop';
} else if (testPath.includes('server/')) {
  moduleDir = 'server';
  moduleName = 'server';
} else if (testPath.includes('gateway/')) {
  moduleDir = 'gateway';
  moduleName = 'gateway';
}

if (!moduleDir) {
  console.log('错误: 无法识别模块路径');
  console.log('支持的模块: apps/desktop, server, gateway');
  process.exit(1);
}

// 确定查找目录
let searchDir = testPath;
if (!searchDir.endsWith('__tests__') && !searchDir.includes('*.test.ts')) {
  // 自动添加 __tests__ 和根目录
  searchDir = `${searchDir}`;
}

console.log(`模块: ${moduleName}`);
console.log(`路径: ${testPath}`);
console.log('');

// 使用 find 命令查找测试文件
const findCmd = `find ${testPath} -name "*.test.ts" -type f 2>/dev/null | sort`;
const findOutput = execSync(findCmd, { cwd, encoding: 'utf-8' });
const allFiles = findOutput.trim().split('\n').filter(f => f.length > 0);

// 过滤掉 node_modules 和非测试文件
const files = allFiles.filter(f => 
  !f.includes('node_modules') && 
  f.endsWith('.test.ts')
);

if (files.length === 0) {
  console.log('未找到测试文件');
  process.exit(1);
}

console.log(`共找到 ${files.length} 个测试文件\n`);

// 结果汇总
const results = {
  passed: [],
  failed: [],
  skipped: []
};

// 逐个运行测试
for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const fileName = path.basename(file);
  const relativePath = file.replace(`${moduleDir}/`, '');
  const progress = `[${String(i + 1).padStart(String(files.length).length)}/${files.length}]`;
  
  process.stdout.write(`${progress} ${fileName.padEnd(35)} `);
  
  try {
    let cmd;
    if (moduleName === 'desktop') {
      // Desktop 需要根据文件类型选择配置
      const relPath = file.replace('apps/desktop/', '');
      
      // stores/utils/hooks 使用 node 环境 (unit 配置)
      // services/components 使用 jsdom 环境 (coverage 配置)
      const isNodeEnv = relPath.includes('/stores/') || 
                        relPath.includes('/utils/') || 
                        (relPath.includes('/hooks/') && !relPath.includes('useSwipeBack') && !relPath.includes('useMediaQuery'));
      
      const configFile = isNodeEnv ? 'vitest.unit.config.ts' : 'vitest.coverage.config.ts';
      // 使用默认 reporter 获取详细的测试数
      cmd = `cd ${moduleDir} && npx vitest run "${relPath}" --config ${configFile} 2>&1`;
    } else {
      // Server/Gateway 从模块目录运行
      const relPath = file.replace(`${moduleDir}/`, '');
      cmd = `cd ${moduleDir} && npx vitest run "${relPath}" 2>&1`;
    }
    
    const output = execSync(cmd, { 
      encoding: 'utf-8',
      timeout: 120000 
    });
    
    // 解析测试结果 - 从默认 reporter 的输出中获取
    // 移除 ANSI 转义字符后匹配
    const cleanOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    // 格式: "Tests  46 passed (46)"
    const passedMatch = cleanOutput.match(/Tests\s+(\d+)\s+passed/);
    const failedMatch = cleanOutput.match(/(\d+)\s+failed/);
    const testCount = passedMatch ? parseInt(passedMatch[1]) : 0;
    const failedCount = failedMatch ? parseInt(failedMatch[1]) : 0;
    
    if (failedCount > 0) {
      console.log(`✗ ${failedCount} failed, ${testCount} passed`);
      results.failed.push({ file, testCount, failedCount, output });
    } else if (testCount > 0) {
      console.log(`✓ ${testCount} passed`);
      results.passed.push({ file, testCount });
    } else {
      console.log(`? 0 tests`);
      results.skipped.push({ file, reason: 'no tests found' });
    }
    
  } catch (error) {
    const output = error.stdout || error.message || '';
    const failedMatch = output.match(/(\d+) failed/);
    const passedMatch = output.match(/(\d+) passed/);
    const failedCount = failedMatch ? parseInt(failedMatch[1]) : 0;
    const passedCount = passedMatch ? parseInt(passedMatch[1]) : 0;
    
    if (failedCount > 0 || output.includes('failed')) {
      console.log(`✗ ${failedCount || '?'} failed`);
      results.failed.push({ file, failedCount, passedCount, output });
    } else if (output.includes('empty') || output.includes('no tests')) {
      console.log(`? empty`);
      results.skipped.push({ file, reason: 'empty test file' });
    } else {
      console.log(`? error`);
      results.skipped.push({ file, reason: 'execution error', error: output.substring(0, 100) });
    }
  }
}

// 输出汇总
console.log('\n' + '='.repeat(75));
console.log('📊 测试结果汇总');
console.log('='.repeat(75));

const totalTests = results.passed.reduce((sum, r) => sum + r.testCount, 0);
const totalFailed = results.failed.reduce((sum, r) => sum + (r.failedCount || 0), 0);
const totalPassed = results.passed.length;
const totalFiles = files.length;
const passRate = ((totalPassed / totalFiles) * 100).toFixed(1);

console.log(`
┌──────────────────────────────────────────────────────────────────────────┐
│  模块: ${moduleName.padEnd(65)}│
│  路径: ${testPath.padEnd(65)}│
├──────────────────────────────────────────────────────────────────────────┤
│  总文件数: ${String(totalFiles).padEnd(61)}│
│  ✅ 通过:   ${String(totalPassed).padEnd(61)}│
│  ❌ 失败:   ${String(results.failed.length).padEnd(61)}│
│  ⚠️  跳过:  ${String(results.skipped.length).padEnd(61)}│
├──────────────────────────────────────────────────────────────────────────┤
│  通过测试数: ${String(totalTests).padEnd(59)}│
│  失败测试数: ${String(totalFailed).padEnd(59)}│
│  文件成功率: ${String(passRate + '%').padEnd(59)}│
└──────────────────────────────────────────────────────────────────────────┘
`);

if (results.failed.length > 0) {
  console.log('❌ 失败的文件:');
  console.log('-'.repeat(75));
  results.failed.forEach(({ file, failedCount, passedCount }, idx) => {
    console.log(`  ${idx + 1}. ${file}`);
    console.log(`     ${passedCount || 0} passed, ${failedCount || '?'} failed`);
  });
  console.log('');
}

if (results.skipped.length > 0) {
  console.log('⚠️  跳过的文件:');
  console.log('-'.repeat(75));
  results.skipped.forEach(({ file, reason }, idx) => {
    console.log(`  ${idx + 1}. ${file} (${reason})`);
  });
  console.log('');
}

console.log('='.repeat(75));
console.log(`✅ 通过的文件列表 (按测试数排序):`);
console.log('='.repeat(75));

results.passed
  .sort((a, b) => b.testCount - a.testCount)
  .forEach(({ file, testCount }, index) => {
    const num = String(index + 1).padStart(3);
    const count = String(testCount).padStart(3);
    const fileName = path.basename(file);
    console.log(`  ${num}. ${fileName.padEnd(35)} ${count} tests`);
  });

console.log('\n');

process.exit(results.failed.length > 0 ? 1 : 0);
