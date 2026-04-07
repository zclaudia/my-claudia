/**
 * WorkspaceService - Agent Workspace 管理
 *
 * 负责加载和管理 Agent 的配置文件（SOUL.md、AGENTS.md、TOOLS.md、Skills）
 * 提供统一的 system prompt 组装能力，让所有 Provider 共享相同的人格配置
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { systemTaskRegistry } from './system-task-registry.js';

const WORKSPACE_DIR = process.env.MY_CLAUDIA_DATA_DIR
  ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR, 'workspace')
  : path.join(os.homedir(), '.my-claudia', 'workspace');
const CACHE_TTL = 60000; // 1 分钟缓存
const MAX_FILE_SIZE = 100 * 1024; // 100KB 限制

export interface WorkspaceOptions {
  projectId?: string;
  projectPath?: string;
  skills?: string[];
}

export interface PromptSection {
  title: string;
  content: string;
  priority: number;
  source: string;
}

export interface WorkspaceConfig {
  soul: string | null;
  agents: string | null;
  tools: string | null;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

/**
 * WorkspaceService - 管理 Agent Workspace 配置
 */
export class WorkspaceService {
  private cache: Map<string, { content: string; mtime: number }> = new Map();
  private initialized = false;

  /**
   * 加载单个 prompt 文件（带缓存和文件大小检查）
   */
  private async loadFile(basePath: string, filename: string): Promise<string | null> {
    const filePath = path.join(basePath, filename);

    try {
      const stat = await fs.stat(filePath);

      // 检查文件大小
      if (stat.size > MAX_FILE_SIZE) {
        console.warn(`[Workspace] File too large: ${filePath} (${stat.size} bytes)`);
        return null;
      }

      // 检查缓存
      const cached = this.cache.get(filePath);
      if (cached && cached.mtime >= stat.mtime.getTime()) {
        return cached.content;
      }

      // 读取文件
      const content = await fs.readFile(filePath, 'utf-8');
      this.cache.set(filePath, {
        content,
        mtime: stat.mtime.getTime(),
      });

      return content;
    } catch (error) {
      // 文件不存在或其他错误
      return null;
    }
  }

  /**
   * 组装完整的 workspace system prompt
   * 按优先级排序各个部分
   */
  async assembleSystemPrompt(options: WorkspaceOptions = {}): Promise<string> {
    const { projectId, projectPath, skills = [] } = options;
    const sections: PromptSection[] = [];

    // 1. 全局 SOUL.md (人格定义) - 最高优先级
    const soul = await this.loadFile(WORKSPACE_DIR, 'SOUL.md');
    if (soul) {
      sections.push({
        title: '## 你的身份',
        content: soul.trim(),
        priority: 100,
        source: 'workspace:SOUL.md',
      });
    }

    // 2. 全局 AGENTS.md (行为规范)
    const agents = await this.loadFile(WORKSPACE_DIR, 'AGENTS.md');
    if (agents) {
      sections.push({
        title: '## 行为规范',
        content: agents.trim(),
        priority: 90,
        source: 'workspace:AGENTS.md',
      });
    }

    // 3. 项目级配置 (覆盖全局 AGENTS)
    if (projectId) {
      const projectDir = path.join(WORKSPACE_DIR, 'projects', projectId);
      const projectAgents = await this.loadFile(projectDir, 'AGENTS.md');
      if (projectAgents) {
        sections.push({
          title: '## 项目特定规范',
          content: projectAgents.trim(),
          priority: 95,
          source: `workspace:projects/${projectId}/AGENTS.md`,
        });
      }
    }

    // 4. 全局 TOOLS.md (工具指南)
    const tools = await this.loadFile(WORKSPACE_DIR, 'TOOLS.md');
    if (tools) {
      sections.push({
        title: '## 工具使用指南',
        content: tools.trim(),
        priority: 80,
        source: 'workspace:TOOLS.md',
      });
    }

    // 5. 项目根目录 CLAUDE.md (类似 Claude Code 的项目上下文)
    if (projectPath) {
      const claudeMd = await this.loadFile(projectPath, 'CLAUDE.md');
      if (claudeMd) {
        sections.push({
          title: '## 项目上下文',
          content: claudeMd.trim(),
          priority: 70,
          source: 'project:CLAUDE.md',
        });
      }
    }

    // 6. 加载启用的 skills
    for (const skillId of skills) {
      const skillContent = await this.loadSkill(skillId);
      if (skillContent) {
        sections.push({
          title: `## 技能: ${skillId}`,
          content: skillContent.trim(),
          priority: 50,
          source: `workspace:skills/${skillId}/SKILL.md`,
        });
      }
    }

    // 按 priority 降序排序并组装
    sections.sort((a, b) => b.priority - a.priority);

    if (sections.length === 0) {
      return '';
    }

    return sections
      .map((s) => `${s.title}\n\n${s.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * 加载单个 skill 的内容
   */
  async loadSkill(skillId: string): Promise<string | null> {
    // 安全检查：防止路径遍历
    const normalizedId = path.basename(skillId);
    if (normalizedId !== skillId || skillId.includes('..')) {
      console.warn(`[Workspace] Invalid skill ID: ${skillId}`);
      return null;
    }

    const skillPath = path.join(WORKSPACE_DIR, 'skills', normalizedId);
    return this.loadFile(skillPath, 'SKILL.md');
  }

  /**
   * 列出所有可用的 skills
   */
  async listSkills(): Promise<SkillInfo[]> {
    const skillsDir = path.join(WORKSPACE_DIR, 'skills');

    try {
      const entries = await fs.readdir(skillsDir, { withFileTypes: true });
      const skills: SkillInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillId = entry.name;
        const skillPath = path.join(skillsDir, skillId, 'SKILL.md');

        try {
          const content = await this.loadFile(path.join(skillsDir, skillId), 'SKILL.md');
          if (content) {
            // 从内容中提取 name 和 description（第一行和第二行）
            const lines = content.split('\n').filter((l) => l.trim());
            const name = lines[0]?.replace(/^#\s*/, '') || skillId;
            const description = lines[1]?.replace(/^>\s*/, '') || '';

            skills.push({
              id: skillId,
              name,
              description,
              path: skillPath,
            });
          }
        } catch {
          // 忽略无效的 skill
        }
      }

      return skills;
    } catch {
      return [];
    }
  }

  /**
   * 获取当前 workspace 配置
   */
  async getConfig(): Promise<WorkspaceConfig> {
    const [soul, agents, tools] = await Promise.all([
      this.loadFile(WORKSPACE_DIR, 'SOUL.md'),
      this.loadFile(WORKSPACE_DIR, 'AGENTS.md'),
      this.loadFile(WORKSPACE_DIR, 'TOOLS.md'),
    ]);

    return { soul, agents, tools };
  }

  /**
   * 更新 workspace 配置文件
   */
  async updateConfig(config: Partial<WorkspaceConfig>): Promise<void> {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });

    const updates: Promise<void>[] = [];

    if (config.soul !== undefined && config.soul !== null) {
      const filePath = path.join(WORKSPACE_DIR, 'SOUL.md');
      updates.push(fs.writeFile(filePath, config.soul, 'utf-8'));
      this.cache.delete(filePath);
    }

    if (config.agents !== undefined && config.agents !== null) {
      const filePath = path.join(WORKSPACE_DIR, 'AGENTS.md');
      updates.push(fs.writeFile(filePath, config.agents, 'utf-8'));
      this.cache.delete(filePath);
    }

    if (config.tools !== undefined && config.tools !== null) {
      const filePath = path.join(WORKSPACE_DIR, 'TOOLS.md');
      updates.push(fs.writeFile(filePath, config.tools, 'utf-8'));
      this.cache.delete(filePath);
    }

    await Promise.all(updates);
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 初始化 workspace 目录和默认文件
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const dirs = [
      WORKSPACE_DIR,
      path.join(WORKSPACE_DIR, 'skills'),
      path.join(WORKSPACE_DIR, 'projects'),
    ];

    // 创建目录结构
    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch {
        // 目录已存在
      }
    }

    // 创建默认配置文件（如果不存在）
    const defaults: Record<string, string> = {
      'SOUL.md': this.getDefaultSoul(),
      'AGENTS.md': this.getDefaultAgents(),
      'TOOLS.md': this.getDefaultTools(),
    };

    for (const [filename, content] of Object.entries(defaults)) {
      const filePath = path.join(WORKSPACE_DIR, filename);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, content, 'utf-8');
        console.log(`[Workspace] Created default ${filename}`);
      }
    }

    this.initialized = true;
    console.log(`[Workspace] Initialized at ${WORKSPACE_DIR}`);
  }

  /**
   * 获取 workspace 目录路径
   */
  getWorkspaceDir(): string {
    return WORKSPACE_DIR;
  }

  private getDefaultSoul(): string {
    return `# Claudia 的灵魂

## 我是谁
我是 Claudia，一个专业的编程助手，专注于帮助用户完成软件开发任务。

## 我的性格
- 简洁高效，不啰嗦
- 专业严谨，注重代码质量
- 友好耐心，善于沟通

## 我的价值观
- 代码质量优先
- 用户隐私至上
- 安全意识时刻在线
- 持续学习和改进

## 我如何沟通
- 用代码说话
- 提供具体建议而非泛泛而谈
- 主动发现潜在问题
`;
  }

  private getDefaultAgents(): string {
    return `# Agent 行为规范

## 响应风格
- 用中文回复
- 代码优先，解释在后
- 一次只做一件事
- 简洁明了，避免冗余

## 工作流程
1. 理解用户意图
2. 制定执行计划
3. 逐步执行并反馈
4. 确认完成

## 安全约束
- 不执行 rm -rf 等危险命令
- 修改文件前先确认
- 敏感操作需用户确认
- 不泄露敏感信息

## 代码规范
- 遵循项目现有代码风格
- 添加必要的注释
- 保持代码可读性
`;
  }

  private getDefaultTools(): string {
    return `# 工具使用指南

## 文件操作
- 读取文件：使用 Read 工具
- 编辑文件：优先使用 Edit，避免重写整个文件
- 创建文件：先确认目录存在后再 Write

## 代码搜索
- 精确搜索：使用 Grep
- 文件查找：使用 Glob
- 复杂探索：使用 Agent 子进程

## 命令执行
- 优先使用专用工具而非 Bash
- 注意超时设置（默认 2 分钟）
- 后台任务使用 run_in_background

## Git 操作
- 优先使用 Git 专用工具
- 提交前检查变更
- 遵循提交消息规范
`;
  }
}

// 单例导出
export const workspaceService = new WorkspaceService();

// 在服务器启动时初始化
export async function initWorkspace(): Promise<void> {
  await workspaceService.initialize();
}

// 注册系统任务：定期清理缓存
systemTaskRegistry.register({
  id: 'system:workspace_cache_cleanup',
  name: 'Workspace Cache Cleanup',
  description: 'Periodically clears workspace file cache',
  category: 'maintenance',
  intervalMs: 5 * 60 * 1000, // 5 分钟
});

setInterval(() => {
  systemTaskRegistry.markRunStart('system:workspace_cache_cleanup');
  const start = Date.now();
  try {
    workspaceService.clearCache();
    systemTaskRegistry.markRunComplete('system:workspace_cache_cleanup', Date.now() - start);
  } catch (err) {
    systemTaskRegistry.markRunComplete('system:workspace_cache_cleanup', Date.now() - start, String(err));
  }
}, 5 * 60 * 1000).unref();
