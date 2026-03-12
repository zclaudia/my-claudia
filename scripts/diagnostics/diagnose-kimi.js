#!/usr/bin/env node

/**
 * Kimi Provider 诊断工具
 * 用于自动检测和诊断 Kimi provider 运行问题
 */

import { spawn, execSync } from 'child_process';
import { createInterface } from 'readline';
import { platform } from 'os';
import { writeFileSync } from 'fs';

// ANSI 颜色代码
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
};

// 诊断结果存储
const results = {
  phase1: { passed: [], failed: [], warnings: [], details: {} },
  phase2: { passed: [], failed: [], warnings: [], details: {} },
  phase3: { passed: [], failed: [], warnings: [], details: {} },
};

// 找到的 kimi CLI 路径 (可能是替代路径)
let kimiPath = 'kimi';

// 工具函数
const log = {
  success: (msg) => console.log(`  ${COLORS.green}✓${COLORS.reset} ${msg}`),
  fail: (msg) => console.log(`  ${COLORS.red}✗${COLORS.reset} ${msg}`),
  warn: (msg) => console.log(`  ${COLORS.yellow}!${COLORS.reset} ${msg}`),
  info: (msg) => console.log(`  ${COLORS.gray}→${COLORS.reset} ${msg}`),
  section: (msg) => console.log(`\n${COLORS.cyan}${COLORS.bold}[${msg}]${COLORS.reset}\n`),
};

// ============================================
// Phase 1: Environment Check
// ============================================

async function checkEnvironment() {
  log.section('Phase 1: 环境检查');

  // 1.1 检查 kimi 是否在 PATH 中
  console.log('1.1 检查 kimi CLI 路径...');
  try {
    const whichCmd = platform() === 'win32' ? 'where kimi' : 'which kimi';
    const kimiPath = execSync(whichCmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

    if (kimiPath) {
      const paths = kimiPath.split('\n');
      const primaryPath = paths[0];
      log.success(`kimi CLI 路径: ${primaryPath}`);
      results.phase1.passed.push('kimi-path');
      results.phase1.details.kimiPath = primaryPath;

      if (paths.length > 1) {
        log.warn(`发现多个 kimi 安装 (${paths.length} 个)`);
        paths.slice(1).forEach(p => log.info(`  - ${p}`));
      }
    }
  } catch (err) {
    log.fail('kimi CLI 未找到，请确保已安装并添加到 PATH');
    results.phase1.failed.push('kimi-path');
    results.phase1.details.kimiNotFound = true;

    // 检查常见安装位置
    console.log('\n  检查常见安装位置...');
    const commonPaths = [
      '/usr/local/bin/kimi',
      '/usr/bin/kimi',
      `${process.env.HOME}/.local/bin/kimi`,
      `${process.env.HOME}/.cargo/bin/kimi`,
      `${process.env.HOME}/go/bin/kimi`,
    ];

    let foundAlt = false;
    for (const p of commonPaths) {
      try {
        execSync(`test -f "${p}"`, { stdio: 'pipe' });
        log.info(`发现: ${p}`);
        foundAlt = true;
      } catch {
        // 不存在
      }
    }

    if (!foundAlt) {
      log.warn('未在任何常见位置找到 kimi CLI');
    } else {
      // 使用找到的第一个替代路径
      for (const p of commonPaths) {
        try {
          execSync(`test -f "${p}"`, { stdio: 'pipe' });
          kimiPath = p;
          log.info(`将使用: ${p} 进行后续测试`);
          break;
        } catch {
          // 继续尝试
        }
      }
    }
    results.phase1.details.foundAlternative = foundAlt;
    results.phase1.details.kimiPath = kimiPath;
  }

  // 1.2 检查版本
  console.log('\n1.2 检查 kimi 版本...');
  try {
    const version = execSync(`${kimiPath} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    log.success(`版本: ${version}`);
    results.phase1.passed.push('kimi-version');
    results.phase1.details.version = version;
  } catch (err) {
    const stderr = err.stderr?.toString().trim() || '';
    if (stderr) {
      log.warn(`无法获取版本信息: ${stderr}`);
    } else {
      log.warn('无法获取版本信息 (命令可能不支持 --version)');
    }
    results.phase1.warnings.push('kimi-version');
  }

  // 1.3 检查帮助信息
  console.log('\n1.3 检查 kimi 帮助信息...');
  try {
    const help = execSync(`${kimiPath} --help`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

    // 检查关键参数支持
    const args = ['--print', '--output-format', '--prompt', '--yolo', '--model', '--session', '--work-dir'];
    console.log('  参数支持检查:');

    args.forEach(arg => {
      if (help.includes(arg)) {
        log.success(`${arg} - 支持`);
        results.phase1.passed.push(`arg-${arg}`);
      } else {
        log.fail(`${arg} - 不支持`);
        results.phase1.failed.push(`arg-${arg}`);
      }
    });

    results.phase1.details.helpOutput = help;
  } catch (err) {
    log.fail('无法获取帮助信息');
    results.phase1.failed.push('kimi-help');
  }

  // 1.4 检查认证状态
  console.log('\n1.4 检查认证状态...');
  try {
    // 尝试几种可能的认证检查命令
    const authCommands = ['kimi auth status', 'kimi whoami', 'kimi config list'];

    for (const cmd of authCommands) {
      try {
        const output = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000 });
        if (output) {
          log.success(`认证检查 (${cmd}): 成功`);
          results.phase1.passed.push('kimi-auth');
          results.phase1.details.authOutput = output;
          break;
        }
      } catch {
        // 继续尝试下一个命令
      }
    }

    if (!results.phase1.passed.includes('kimi-auth')) {
      log.warn('无法验证认证状态 (可能需要手动检查)');
      results.phase1.warnings.push('kimi-auth');
    }
  } catch (err) {
    log.warn('认证检查失败');
    results.phase1.warnings.push('kimi-auth');
  }
}

// ============================================
// Phase 2: CLI Functionality Test
// ============================================

async function testCliFunctionality() {
  log.section('Phase 2: CLI 功能测试');

  // 如果 Phase 1 检查失败且没有找到替代路径，跳过此阶段
  if (results.phase1.failed.includes('kimi-path') && !results.phase1.details.foundAlternative) {
    log.warn('跳过 CLI 功能测试 (kimi CLI 未安装)');
    results.phase2.warnings.push('skipped-no-cli');
    return;
  }

  if (results.phase1.details.foundAlternative) {
    log.info(`使用替代路径: ${kimiPath}`);
  }

  // 2.1 基本调用测试
  console.log('2.1 基本调用测试...');
  try {
    const result = await runKimiCommand(['--print', '--prompt', 'Say "test"', '--yolo'], 30000);

    if (result.stdout || result.output.length > 0) {
      log.success('基本调用成功');
      results.phase2.passed.push('basic-invocation');
      results.phase2.details.basicOutput = result.output.slice(0, 500); // 只保存前 500 字符
    } else {
      log.fail('基本调用失败: 无输出');
      results.phase2.failed.push('basic-invocation');
    }
  } catch (err) {
    log.fail(`基本调用失败: ${err.message}`);
    results.phase2.failed.push('basic-invocation');
    results.phase2.details.basicError = err.message;
  }

  // 2.2 JSON 输出格式测试
  console.log('\n2.2 JSON 输出格式测试 (--output-format stream-json)...');
  try {
    const result = await runKimiCommand([
      '--print',
      '--output-format', 'stream-json',
      '--prompt', 'Say "json test"',
      '--yolo'
    ], 30000);

    if (result.parseErrors === 0 && result.jsonEvents.length > 0) {
      log.success(`JSON 输出格式正确，解析了 ${result.jsonEvents.length} 个事件`);
      results.phase2.passed.push('json-format');

      // 显示事件类型统计
      const eventTypes = {};
      result.jsonEvents.forEach(e => {
        const type = e.type || 'unknown';
        eventTypes[type] = (eventTypes[type] || 0) + 1;
      });

      console.log('  事件类型统计:');
      Object.entries(eventTypes).forEach(([type, count]) => {
        log.info(`${type}: ${count} 个`);
      });

      results.phase2.details.eventTypes = eventTypes;
      results.phase2.details.sampleEvents = result.jsonEvents.slice(0, 3);
    } else if (result.parseErrors > 0) {
      log.warn(`JSON 解析有错误 (${result.parseErrors} 个)，部分输出不是有效 JSON`);
      results.phase2.warnings.push('json-format');

      // 显示解析错误示例
      if (result.rawLines.length > 0) {
        console.log('  非JSON 输出示例:');
        result.rawLines.slice(0, 3).forEach(line => {
          log.info(line.substring(0, 100));
        });
      }

      results.phase2.details.jsonParseErrors = result.parseErrors;
      results.phase2.details.rawOutput = result.rawLines.slice(0, 5);
    } else {
      log.fail('JSON 输出格式测试失败: 无事件输出');
      results.phase2.failed.push('json-format');
    }
  } catch (err) {
    log.fail(`JSON 格式测试失败: ${err.message}`);
    results.phase2.failed.push('json-format');
    results.phase2.details.jsonError = err.message;
  }

  // 2.3 工作目录测试
  console.log('\n2.3 工作目录参数测试...');
  try {
    const result = await runKimiCommand([
      '--print',
      '--prompt', 'pwd',
      '--yolo',
      '--work-dir', process.cwd()
    ], 30000);

    if (result.stdout || result.output.length > 0) {
      log.success('工作目录参数正常');
      results.phase2.passed.push('work-dir');
    } else {
      log.fail('工作目录参数测试失败');
      results.phase2.failed.push('work-dir');
    }
  } catch (err) {
    log.fail(`工作目录参数测试失败: ${err.message}`);
    results.phase2.failed.push('work-dir');
  }
}

// 辅助函数：运行 kimi 命令并收集输出
function runKimiCommand(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(kimiPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeout,
    });

    let stdout = '';
    let stderr = '';
    const output = [];
    const jsonEvents = [];
    const rawLines = [];
    let parseErrors = 0;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

    rl.on('line', (line) => {
      if (!line.trim()) return;

      output.push(line);
      rawLines.push(line);

      try {
        const event = JSON.parse(line);
        jsonEvents.push(event);
      } catch {
        parseErrors++;
      }
    });

    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeout);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      rl.close();

      resolve({
        code,
        stdout,
        stderr,
        output: output.join('\n'),
        jsonEvents,
        rawLines,
        parseErrors,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      rl.close();
      reject(err);
    });
  });
}

// ============================================
// Phase 3: SDK Integration Test
// ============================================

async function testSdkIntegration() {
  log.section('Phase 3: SDK 集成测试');

  // 如果 Phase 2 失败，跳过此阶段
  if (results.phase2.failed.includes('basic-invocation')) {
    log.warn('跳过 SDK 集成测试 (基本调用失败)');
    results.phase3.warnings.push('skipped-basic-failed');
    return;
  }

  // 3.1 测试事件类型映射
  console.log('3.1 测试事件类型映射...');
  const supportedEvents = [
    'init', 'system', 'message', 'assistant', 'assistant_delta',
    'content', 'content_delta', 'delta', 'thinking', 'reasoning',
    'tool_use', 'tool_call', 'tool_result', 'error', 'complete',
    'done', 'completed', 'message_stop'
  ];

  if (results.phase2.details.eventTypes) {
    const foundTypes = Object.keys(results.phase2.details.eventTypes);
    const unknownTypes = foundTypes.filter(t => !supportedEvents.includes(t));

    if (unknownTypes.length === 0) {
      log.success('所有事件类型都在支持列表中');
      results.phase3.passed.push('event-types');
    } else {
      log.warn(`发现未知事件类型: ${unknownTypes.join(', ')}`);
      results.phase3.warnings.push('event-types');
      results.phase3.details.unknownEventTypes = unknownTypes;
    }
  } else {
    log.warn('无法验证事件类型 (无 JSON 输出)');
    results.phase3.warnings.push('event-types-no-data');
  }

  // 3.2 测试会话恢复
  console.log('\n3.2 测试会话恢复...');
  try {
    // 创建一个会话并获取 session_id
    const result1 = await runKimiCommand([
      '--print',
      '--output-format', 'stream-json',
      '--prompt', 'Say "session test"',
      '--yolo'
    ], 30000);

    const initEvent = result1.jsonEvents.find(e =>
      e.type === 'init' ||
      (e.type === 'system' && e.subtype === 'init') ||
      e.session_id ||
      e.sessionId
    );

    if (initEvent) {
      const sessionId = initEvent.session_id || initEvent.sessionId;
      log.success(`会话创建成功: ${sessionId}`);
      results.phase3.passed.push('session-create');
      results.phase3.details.sessionId = sessionId;

      // 尝试恢复会话
      if (results.phase1.passed.includes('arg---session')) {
        console.log('\n  尝试恢复会话...');
        const result2 = await runKimiCommand([
          '--print',
          '--output-format', 'stream-json',
          '--prompt', 'What did I just say?',
          '--yolo',
          '--session', sessionId
        ], 30000);

        if (result2.jsonEvents.length > 0) {
          log.success('会话恢复成功');
          results.phase3.passed.push('session-resume');
        } else {
          log.fail('会话恢复失败: 无输出');
          results.phase3.failed.push('session-resume');
        }
      } else {
        log.warn('跳过会话恢复测试 (--session 参数不支持)');
        results.phase3.warnings.push('session-resume-skipped');
      }
    } else {
      log.warn('无法获取 session_id');
      results.phase3.warnings.push('session-no-id');
    }
  } catch (err) {
    log.fail(`会话测试失败: ${err.message}`);
    results.phase3.failed.push('session-test');
  }

  // 3.3 测试模型选择
  console.log('\n3.3 测试模型选择...');
  if (results.phase1.passed.includes('arg---model')) {
    try {
      // 获取可用模型列表
      const modelsResult = execSync(`${kimiPath} --help`, { encoding: 'utf-8' });
      const modelMatch = modelsResult.match(/--model[^\n]*\n[^\n]*/);

      if (modelMatch) {
        log.info(`模型参数说明: ${modelMatch[0].trim()}`);
      }

      const result = await runKimiCommand([
        '--print',
        '--output-format', 'stream-json',
        '--prompt', 'Say "model test"',
        '--yolo',
        '--model', 'default'
      ], 30000);

      if (result.jsonEvents.length > 0) {
        log.success('模型选择参数正常');
        results.phase3.passed.push('model-selection');
      } else {
        log.fail('模型选择参数测试失败');
        results.phase3.failed.push('model-selection');
      }
    } catch (err) {
      log.fail(`模型选择测试失败: ${err.message}`);
      results.phase3.failed.push('model-selection');
    }
  } else {
    log.warn('跳过模型选择测试 (--model 参数不支持)');
    results.phase3.warnings.push('model-selection-skipped');
  }
}

// ============================================
// Phase 4: Report Generation
// ============================================

async function generateReport() {
  log.section('Phase 4: 诊断报告');

  // 统计
  const totalPassed = results.phase1.passed.length + results.phase2.passed.length + results.phase3.passed.length;
  const totalFailed = results.phase1.failed.length + results.phase2.failed.length + results.phase3.failed.length;
  const totalWarnings = results.phase1.warnings.length + results.phase2.warnings.length + results.phase3.warnings.length;

  console.log('统计:');
  console.log(`  通过: ${COLORS.green}${totalPassed}${COLORS.reset}`);
  console.log(`  失败: ${COLORS.red}${totalFailed}${COLORS.reset}`);
  console.log(`  警告: ${COLORS.yellow}${totalWarnings}${COLORS.reset}`);

  // 问题定位
  console.log('\n' + COLORS.bold + '问题定位:' + COLORS.reset);

  const issues = [];

  if (results.phase1.failed.includes('kimi-path') && !results.phase1.details.foundAlternative) {
    issues.push({
      severity: 'critical',
      message: 'kimi CLI 未安装',
      suggestion: '请安装 kimi CLI: 参考 https://github.com/moonshotai/kimi-cli'
    });
  } else if (results.phase1.failed.includes('kimi-path') && results.phase1.details.foundAlternative) {
    issues.push({
      severity: 'high',
      message: 'kimi CLI 不在 PATH 中',
      suggestion: `将 ${kimiPath} 添加到 PATH，或在 Provider 设置中指定 CLI 路径`
    });
  }

  if (results.phase1.failed.some(k => k.startsWith('arg-'))) {
    const missingArgs = results.phase1.failed.filter(k => k.startsWith('arg-')).map(k => k.replace('arg-', ''));
    issues.push({
      severity: 'high',
      message: `CLI 参数不支持: ${missingArgs.join(', ')}`,
      suggestion: `检查 kimi CLI 版本，或修改 server/src/providers/kimi-sdk.ts 中的参数`
    });
  }

  if (results.phase2.failed.includes('json-format')) {
    issues.push({
      severity: 'high',
      message: 'JSON 输出格式不正确',
      suggestion: 'kimi CLI 可能不支持 --output-format stream-json，检查输出格式并更新 mapKimiEvent 函数'
    });
  }

  if (results.phase2.warnings.includes('json-format')) {
    issues.push({
      severity: 'medium',
      message: 'JSON 解析部分失败',
      suggestion: 'kimi CLI 输出可能包含非 JSON 内容，需要更新解析逻辑处理混合格式'
    });
  }

  if (results.phase3.warnings.includes('event-types') || results.phase3.details.unknownEventTypes) {
    issues.push({
      severity: 'medium',
      message: `发现未知事件类型: ${results.phase3.details.unknownEventTypes?.join(', ')}`,
      suggestion: '在 server/src/providers/kimi-sdk.ts 的 mapKimiEvent 函数中添加对新事件类型的支持'
    });
  }

  if (issues.length === 0) {
    console.log(`  ${COLORS.green}✓ 未发现明显问题${COLORS.reset}`);
    console.log('\n  如果 Kimi provider 仍然无法正常工作，请检查:');
    console.log('  1. 服务器日志: 查看 server 控制台输出');
    console.log('  2. 网络连接: 确保 API 端点可访问');
    console.log('  3. 权限设置: 确保有正确的文件和目录权限');
  } else {
    issues.forEach((issue, i) => {
      const severityColor = issue.severity === 'critical' ? COLORS.red :
                           issue.severity === 'high' ? COLORS.yellow : COLORS.gray;
      console.log(`\n  ${severityColor}[${issue.severity.toUpperCase()}]${COLORS.reset} ${i + 1}. ${issue.message}`);
      console.log(`     ${COLORS.gray}建议: ${issue.suggestion}${COLORS.reset}`);
    });
  }

  // 修复建议
  console.log('\n' + COLORS.bold + '修复建议:' + COLORS.reset);

  if (results.phase1.failed.includes('kimi-path') && !results.phase1.details.foundAlternative) {
    console.log('\n  1. 安装 kimi CLI:');
    console.log('     npm install -g @anthropic/kimi-cli');
    console.log('     或参考官方文档获取安装指南');
  } else if (results.phase1.failed.includes('kimi-path') && results.phase1.details.foundAlternative) {
    console.log('\n  1. 配置 PATH 环境变量:');
    console.log(`     将以下内容添加到 ~/.zshrc 或 ~/.bashrc:`);
    console.log(`     export PATH="$PATH:${kimiPath.replace('/kimi', '')}"`);
    console.log('\n     或者在 MyClaudia 的 Provider 设置中指定 CLI 路径:');
    console.log(`     CLI Path: ${kimiPath}`);
  }

  if (results.phase1.failed.some(k => k.startsWith('arg-'))) {
    console.log('\n  2. 更新 SDK 参数:');
    console.log('     编辑: server/src/providers/kimi-sdk.ts');
    console.log('     位置: runKimi 函数中的 args 数组 (约第 437 行)');
    console.log('     移除或替换不支持的参数');
  }

  if (results.phase2.failed.includes('json-format') || results.phase2.warnings.includes('json-format')) {
    console.log('\n  3. 更新事件解析逻辑:');
    console.log('     编辑: server/src/providers/kimi-sdk.ts');
    console.log('     位置: mapKimiEvent 函数 (约第 204 行)');
    console.log('     根据实际 CLI 输出格式更新解析逻辑');

    if (results.phase2.details.rawOutput) {
      console.log('\n  实际输出示例:');
      results.phase2.details.rawOutput.slice(0, 3).forEach(line => {
        console.log(`    ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
      });
    }
  }

  // 详细信息
  if (process.argv.includes('--verbose') || process.argv.includes('-v')) {
    console.log('\n' + COLORS.bold + '详细信息:' + COLORS.reset);
    console.log('\n  Phase 1 详情:');
    console.log(`    通过: ${results.phase1.passed.join(', ') || '无'}`);
    console.log(`    失败: ${results.phase1.failed.join(', ') || '无'}`);
    console.log(`    警告: ${results.phase1.warnings.join(', ') || '无'}`);

    console.log('\n  Phase 2 详情:');
    console.log(`    通过: ${results.phase2.passed.join(', ') || '无'}`);
    console.log(`    失败: ${results.phase2.failed.join(', ') || '无'}`);
    console.log(`    警告: ${results.phase2.warnings.join(', ') || '无'}`);

    console.log('\n  Phase 3 详情:');
    console.log(`    通过: ${results.phase3.passed.join(', ') || '无'}`);
    console.log(`    失败: ${results.phase3.failed.join(', ') || '无'}`);
    console.log(`    警告: ${results.phase3.warnings.join(', ') || '无'}`);
  }

  // 保存报告到文件
  const reportPath = `${process.env.HOME}/.kimi-diagnostic-report.json`;
  const report = {
    timestamp: new Date().toISOString(),
    results,
    summary: {
      totalPassed,
      totalFailed,
      totalWarnings,
      issues,
    }
  };

  try {
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n${COLORS.gray}报告已保存到: ${reportPath}${COLORS.reset}`);
  } catch {
    // 忽略保存错误
  }
}

// ============================================
// Main
// ============================================

async function main() {
  console.log(`${COLORS.bold}=== Kimi Provider 诊断工具 ===${COLORS.reset}\n`);
  console.log(`运行时间: ${new Date().toLocaleString()}`);
  console.log(`平台: ${platform()}`);
  console.log(`Node: ${process.version}\n`);

  try {
    await checkEnvironment();
    await testCliFunctionality();
    await testSdkIntegration();
    generateReport();
  } catch (err) {
    console.error(`\n${COLORS.red}诊断过程出错:${COLORS.reset}`, err.message);
    console.error(err.stack);
    process.exit(1);
  }

  console.log(`\n${COLORS.bold}=== 诊断完成 ===${COLORS.reset}\n`);
}

main().catch(console.error);
