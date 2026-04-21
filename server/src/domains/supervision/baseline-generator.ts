/**
 * Baseline document generator — scans project structure and optionally
 * uses AI to produce project.md + architecture.md baseline documents.
 */
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { runCliJob } from '../../infrastructure/providers/cli-jobs/runner.js';
import type { CliProviderAdapter } from '../../infrastructure/providers/cli-jobs/types.js';
import { claudeReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/claude.js';
import { codexReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/codex.js';
import { cursorReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/cursor.js';
import { kimiReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/kimi.js';
import { opencodeReviewAdapter } from '../../infrastructure/providers/cli-jobs/adapters/opencode.js';
import { extractJSONObjects } from '../../infrastructure/providers/cli-jobs/json-extract.js';

export type BaselineGenerationMode = 'template' | 'scan' | 'ai_scan';
export type BaselineLanguage = 'zh-CN' | 'en';

export interface BaselineInitOptions {
  mode?: BaselineGenerationMode;
  providerId?: string;
  language?: BaselineLanguage;
  force?: boolean;
}

export interface BaselineInitResult {
  initialized: boolean;
  mode: BaselineGenerationMode;
  language: BaselineLanguage;
  usedAi: boolean;
  regenerated: boolean;
}

const BASELINE_PROVIDER_ADAPTERS: Record<string, CliProviderAdapter> = {
  claude: claudeReviewAdapter,
  codex: codexReviewAdapter,
  cursor: cursorReviewAdapter,
  kimi: kimiReviewAdapter,
  opencode: opencodeReviewAdapter,
};

export { BASELINE_PROVIDER_ADAPTERS };

// ============================================
// Project Scanning
// ============================================

export function scanProjectForBaseline(
  rootPath: string,
  projectName: string,
  language: BaselineLanguage,
): { projectMd: string; architectureMd: string } {
  const packageJson = readJsonFile(path.join(rootPath, 'package.json'));
  const workspaceFiles = [
    'pnpm-workspace.yaml',
    'turbo.json',
    'nx.json',
    'lerna.json',
    'docker-compose.yml',
    'docker-compose.yaml',
    'README.md',
  ].filter((name) => fs.existsSync(path.join(rootPath, name)));
  const topLevelEntries = safeReadTopLevelEntries(rootPath);
  const appDirs = topLevelEntries.filter((name) => ['apps', 'packages', 'server', 'gateway', 'shared', 'src'].includes(name));
  const scripts = packageJson?.scripts ? Object.keys(packageJson.scripts).slice(0, 8) : [];
  const deps = collectInterestingDependencies(packageJson);

  if (language === 'en') {
    return {
      projectMd: [
        '# Project Overview',
        '',
        '## Background',
        `- Project: ${projectName}`,
        `- Root path: \`${rootPath}\``,
        workspaceFiles.length > 0 ? `- Workspace signals: ${workspaceFiles.map((file) => `\`${file}\``).join(', ')}` : '- Workspace signals: not detected',
        '',
        '## Current Goals',
        '- Fill in the actual product and delivery goals for this project.',
        '',
        '## Key Constraints',
        deps.length > 0 ? `- Main stack signals: ${deps.join(', ')}` : '- Main stack signals: pending scan confirmation',
        scripts.length > 0 ? `- Useful scripts: ${scripts.map((script) => `\`${script}\``).join(', ')}` : '- Useful scripts: none detected in package.json',
        '',
        '## Known Risks',
        '- This draft was generated from repository structure and may contain inference errors.',
        '',
        '## Inferred Existing Functionality',
        ...(appDirs.length > 0
          ? appDirs.map((dir) => `- Candidate module area: \`${dir}\``)
          : ['- No obvious app/module directories were detected at the repo root.']),
        '',
        '## Needs User Confirmation',
        '- Confirm the real business purpose of the project.',
        '- Confirm which modules are core vs. legacy/supporting.',
        '- Confirm whether the inferred stack and scripts are still current.',
      ].join('\n'),
      architectureMd: [
        '# Architecture Overview',
        '',
        '## Key Modules',
        ...(topLevelEntries.length > 0
          ? topLevelEntries.slice(0, 12).map((entry) => `- \`${entry}\``)
          : ['- No top-level directories were detected.']),
        '',
        '## Data / Request Flow',
        '- Fill in the main runtime flow after reviewing the actual code paths.',
        '',
        '## External Dependencies',
        ...(deps.length > 0 ? deps.map((dep) => `- ${dep}`) : ['- No key dependencies detected from package.json.']),
        '',
        '## Inferred Notes',
        '- This baseline was generated from lightweight project scanning.',
        '- Review actual entrypoints, runtime boundaries, and persistence paths before using this as design truth.',
      ].join('\n'),
    };
  }

  return {
    projectMd: [
      '# 项目概览',
      '',
      '## 背景',
      `- 项目名称：${projectName}`,
      `- 根目录：\`${rootPath}\``,
      workspaceFiles.length > 0 ? `- 工作区信号：${workspaceFiles.map((file) => `\`${file}\``).join('、')}` : '- 工作区信号：未检测到明显配置文件',
      '',
      '## 当前目标',
      '- 这里需要补充项目真实的产品目标和当前交付目标。',
      '',
      '## 关键约束',
      deps.length > 0 ? `- 主要技术栈信号：${deps.join('、')}` : '- 主要技术栈信号：待进一步确认',
      scripts.length > 0 ? `- 可用脚本：${scripts.map((script) => `\`${script}\``).join('、')}` : '- 可用脚本：未在 package.json 中检测到',
      '',
      '## 已知风险',
      '- 当前内容基于仓库结构推断，可能与真实业务含义不完全一致。',
      '',
      '## 推断出的现有能力',
      ...(appDirs.length > 0
        ? appDirs.map((dir) => `- 候选模块区域：\`${dir}\``)
        : ['- 根目录下没有明显的应用/模块目录。']),
      '',
      '## 待用户确认',
      '- 请确认项目的真实业务目标。',
      '- 请确认哪些模块是核心模块，哪些是历史/辅助模块。',
      '- 请确认当前推断出的技术栈和脚本是否仍然有效。',
    ].join('\n'),
    architectureMd: [
      '# 架构概览',
      '',
      '## 关键模块',
      ...(topLevelEntries.length > 0
        ? topLevelEntries.slice(0, 12).map((entry) => `- \`${entry}\``)
        : ['- 未检测到顶层目录。']),
      '',
      '## 数据流',
      '- 需要结合实际入口代码进一步补充主要请求流和状态流。',
      '',
      '## 外部依赖',
      ...(deps.length > 0 ? deps.map((dep) => `- ${dep}`) : ['- 未从 package.json 检测到关键依赖。']),
      '',
      '## 推断说明',
      '- 该 baseline 由轻量项目扫描生成。',
      '- 在将其作为设计依据前，请先复核真实入口、运行边界和持久化路径。',
    ].join('\n'),
  };
}

// ============================================
// AI-Enhanced Baseline Generation
// ============================================

export async function generateBaselineWithAi(
  db: Database,
  rootPath: string,
  scanned: { projectMd: string; architectureMd: string },
  options: { providerId?: string; language: BaselineLanguage },
): Promise<{ projectMd: string; architectureMd: string }> {
  const provider = resolveBaselineProvider(db, options.providerId);
  if (!provider) {
    throw new Error('No supported AI provider found for baseline generation');
  }
  const adapter = BASELINE_PROVIDER_ADAPTERS[provider.type];
  if (!adapter) {
    throw new Error(`Provider ${provider.id} does not support baseline generation`);
  }

  const prompt = buildBaselineGenerationPrompt(scanned, options.language);
  const systemPrompt = options.language === 'en'
    ? 'You are generating project baseline markdown documents for a long-running engineering workspace. Be concrete, concise, and preserve uncertainty explicitly.'
    : '你正在为一个长期工程工作区生成项目 baseline 文档。请尽量具体、简洁，并显式标注不确定内容。';

  const assistantText = await runCliJob(
    adapter,
    {
      prompt,
      cwd: rootPath,
      cliPath: provider.cliPath ?? undefined,
      env: provider.env ?? undefined,
      systemPrompt,
      timeoutMs: 120000,
    },
    (text) => text,
  );

  return parseBaselineGenerationResult(assistantText, scanned);
}

export function buildBaselineGenerationPrompt(
  scanned: { projectMd: string; architectureMd: string },
  language: BaselineLanguage,
): string {
  if (language === 'en') {
    return [
      'Analyze the repository context below and generate two markdown documents.',
      'Return strict JSON only with keys "projectMd" and "architectureMd".',
      'Both markdown documents must be written in English.',
      'If information is inferred, mark it clearly with phrases like "Inferred:" or "Needs confirmation:".',
      '',
      '[Scanned Project Draft]',
      scanned.projectMd,
      '',
      '[Scanned Architecture Draft]',
      scanned.architectureMd,
    ].join('\n');
  }
  return [
    '请基于下面的仓库扫描结果，生成两份 markdown 文档。',
    '只返回严格 JSON，包含 "projectMd" 和 "architectureMd" 两个字段。',
    '两份 markdown 文档都必须使用中文。',
    '凡是推断内容，请明确标注"推断："或"待确认："。',
    '',
    '[项目扫描草稿]',
    scanned.projectMd,
    '',
    '[架构扫描草稿]',
    scanned.architectureMd,
  ].join('\n');
}

export function parseBaselineGenerationResult(
  assistantText: string,
  fallback: { projectMd: string; architectureMd: string },
): { projectMd: string; architectureMd: string } {
  const candidates = extractJSONObjects(assistantText);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]) as Record<string, unknown>;
      const projectMd = typeof parsed.projectMd === 'string' ? parsed.projectMd.trim() : '';
      const architectureMd = typeof parsed.architectureMd === 'string' ? parsed.architectureMd.trim() : '';
      if (projectMd && architectureMd) {
        return { projectMd, architectureMd };
      }
    } catch {
      // Ignore malformed candidates.
    }
  }
  return fallback;
}

export function resolveBaselineProvider(
  db: Database,
  providerId?: string,
): {
  id: string;
  type: string;
  cliPath: string | null;
  env: Record<string, string> | null;
} | null {
  if (providerId) {
    const selected = db.prepare(`
      SELECT id, type, cli_path as cliPath, env
      FROM providers
      WHERE id = ?
      LIMIT 1
    `).get(providerId) as { id: string; type: string; cliPath: string | null; env: string | null } | undefined;
    if (!selected) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    return {
      id: selected.id,
      type: selected.type,
      cliPath: selected.cliPath,
      env: parseProviderEnv(selected.env),
    };
  }

  const row = db.prepare(`
    SELECT id, type, cli_path as cliPath, env
    FROM providers
    WHERE type IN ('claude', 'codex', 'cursor', 'kimi', 'opencode')
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  `).get() as { id: string; type: string; cliPath: string | null; env: string | null } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    cliPath: row.cliPath,
    env: parseProviderEnv(row.env),
  };
}

// ============================================
// File Utilities
// ============================================

export function readJsonFile(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, any>;
  } catch {
    return null;
  }
}

export function safeReadTopLevelEntries(rootPath: string): string[] {
  try {
    return fs.readdirSync(rootPath, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') || entry.name === '.github')
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 20);
  } catch {
    return [];
  }
}

export function collectInterestingDependencies(packageJson: Record<string, any> | null): string[] {
  const deps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  } as Record<string, string>;
  const interesting = [
    'react',
    'vite',
    'tauri',
    'express',
    'zustand',
    'typescript',
    'vitest',
    'better-sqlite3',
    'ws',
    'electron',
  ];
  const found = interesting.filter((name) => deps[name]);
  return found.map((name) => `${name}@${deps[name]}`);
}

function parseProviderEnv(raw: string | null): Record<string, string> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return null;
  }
}
