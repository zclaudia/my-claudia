import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import matter from 'gray-matter';

export interface ContextDocument {
  id: string;              // relative path, e.g. "specs/requirements.md"
  category: string;        // from YAML frontmatter
  source: string;          // 'user' | 'agent'
  version: number;
  updated: string;         // ISO date
  content: string;         // markdown body (without frontmatter)
}

export interface WorkflowAction {
  type: string;
  command?: string;
  description?: string;
  scope?: string;
  prompt?: string;
}

export interface WorkflowConfig {
  onTaskComplete: WorkflowAction[];
  onCheckpoint: WorkflowAction[];
  checkpointTrigger: CheckpointTrigger;
}

export type CheckpointTrigger =
  | { type: 'on_task_complete' }
  | { type: 'on_idle' }
  | { type: 'interval'; minutes: number }
  | { type: 'combined'; triggers: CheckpointTrigger[] };

const SUPERVISION_DIR = '.supervision';
const WORKFLOW_FILE = 'workflow.yaml';
const PROJECT_SUMMARY_FILE = 'project-summary.md';
const GOAL_FILE = 'goal.md';
const RESULTS_DIR = 'results';

const DEFAULT_WORKFLOW: WorkflowConfig = {
  onTaskComplete: [],
  onCheckpoint: [],
  checkpointTrigger: { type: 'on_task_complete' },
};

function makeFrontmatter(meta: {
  category: string;
  source: string;
  version: number;
  updated: string;
}): string {
  return [
    '---',
    `category: ${meta.category}`,
    `source: ${meta.source}`,
    `version: ${meta.version}`,
    `updated: ${meta.updated}`,
    '---',
    '',
  ].join('\n');
}

export class ContextManager {
  private rootPath: string;
  private supervisionPath: string;

  constructor(projectRootPath: string) {
    this.rootPath = projectRootPath;
    this.supervisionPath = path.join(projectRootPath, SUPERVISION_DIR);
  }

  /**
   * Returns true if the .supervision/ directory exists.
   */
  isInitialized(): boolean {
    return fs.existsSync(this.supervisionPath);
  }

  /**
   * Create the entire .supervision/ directory structure with default files.
   */
  scaffold(projectName: string): void {
    const now = new Date().toISOString();

    // Create subdirectories
    const dirs = ['specs', 'guidelines', 'knowledge', RESULTS_DIR];
    for (const dir of dirs) {
      fs.mkdirSync(path.join(this.supervisionPath, dir), { recursive: true });
    }

    // goal.md
    const goalMeta = makeFrontmatter({
      category: 'goal',
      source: 'user',
      version: 1,
      updated: now,
    });
    fs.writeFileSync(
      path.join(this.supervisionPath, GOAL_FILE),
      goalMeta + `# Project Goal\n\n${projectName}\n`,
      'utf-8',
    );

    // project-summary.md
    const summaryMeta = makeFrontmatter({
      category: 'summary',
      source: 'agent',
      version: 1,
      updated: now,
    });
    fs.writeFileSync(
      path.join(this.supervisionPath, PROJECT_SUMMARY_FILE),
      summaryMeta,
      'utf-8',
    );

    // workflow.yaml
    fs.writeFileSync(
      path.join(this.supervisionPath, WORKFLOW_FILE),
      yaml.dump(DEFAULT_WORKFLOW, { lineWidth: -1 }),
      'utf-8',
    );
  }

  /**
   * Recursively scan .supervision/ for .md files, parse them, and return
   * all documents plus the workflow config.
   */
  loadAll(): { documents: ContextDocument[]; workflow: WorkflowConfig } {
    const documents: ContextDocument[] = [];
    const mdFiles = this.scanMarkdownFiles(this.supervisionPath);

    for (const filePath of mdFiles) {
      const relPath = path.relative(this.supervisionPath, filePath);

      // Skip results/ directory
      if (relPath.startsWith(RESULTS_DIR + path.sep) || relPath.startsWith(RESULTS_DIR + '/')) {
        continue;
      }

      const doc = this.parseDocument(filePath, relPath);
      documents.push(doc);
    }

    const workflow = this.getWorkflow();

    return { documents, workflow };
  }

  /**
   * Read a single document by its relative path (e.g., "specs/requirements.md").
   */
  getDocument(docId: string): ContextDocument | undefined {
    const filePath = path.join(this.supervisionPath, docId);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return this.parseDocument(filePath, docId);
  }

  /**
   * Update or create a document with incremented version and updated frontmatter.
   */
  updateDocument(
    docId: string,
    content: string,
    meta?: Partial<{ category: string; source: string }>,
  ): void {
    const filePath = path.join(this.supervisionPath, docId);
    const now = new Date().toISOString();

    let version = 1;
    let category = meta?.category ?? 'general';
    let source = meta?.source ?? 'user';

    // Read existing file to get current version and defaults
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = matter(raw);
        if (typeof parsed.data.version === 'number') {
          version = parsed.data.version + 1;
        }
        if (!meta?.category && parsed.data.category) {
          category = parsed.data.category;
        }
        if (!meta?.source && parsed.data.source) {
          source = parsed.data.source;
        }
      } catch {
        // If parsing fails, start fresh with version 1
      }
    }

    // Create parent directories if needed
    const parentDir = path.dirname(filePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const frontmatter = makeFrontmatter({ category, source, version, updated: now });
    fs.writeFileSync(filePath, frontmatter + content, 'utf-8');
  }

  /**
   * Read project-summary.md and return its content (without frontmatter).
   */
  getProjectSummary(): string | undefined {
    const filePath = path.join(this.supervisionPath, PROJECT_SUMMARY_FILE);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(raw);
      return parsed.content;
    } catch {
      return undefined;
    }
  }

  /**
   * Write project-summary.md with proper frontmatter.
   */
  updateProjectSummary(content: string): void {
    this.updateDocument(PROJECT_SUMMARY_FILE, content, {
      category: 'summary',
      source: 'agent',
    });
  }

  /**
   * Build a context string for injection into task prompts.
   *
   * 1. Always start with project-summary content (if exists)
   * 2. If relevantDocIds provided and non-empty: only include those documents
   * 3. If no relevantDocIds: include all non-results documents
   * 4. Format each document as a markdown section
   */
  getContextForTask(relevantDocIds?: string[]): string {
    const sections: string[] = [];

    // 1. Always include project summary
    const summary = this.getProjectSummary();
    if (summary && summary.trim()) {
      sections.push(`## Project Summary\n\n${summary.trim()}`);
    }

    // 2/3. Gather documents
    let documents: ContextDocument[];

    if (relevantDocIds && relevantDocIds.length > 0) {
      documents = [];
      for (const docId of relevantDocIds) {
        // Skip project-summary since we already included it
        if (docId === PROJECT_SUMMARY_FILE) continue;
        const doc = this.getDocument(docId);
        if (doc) {
          documents.push(doc);
        }
      }
    } else {
      // Load all non-results documents
      const { documents: allDocs } = this.loadAll();
      documents = allDocs.filter(d => d.id !== PROJECT_SUMMARY_FILE);
    }

    // 4. Format each document as a markdown section
    for (const doc of documents) {
      const header = `## ${doc.id} (${doc.category})`;
      sections.push(`${header}\n\n${doc.content.trim()}`);
    }

    return sections.join('\n\n---\n\n');
  }

  /**
   * Parse and return workflow.yaml. If file doesn't exist, return default config.
   */
  getWorkflow(): WorkflowConfig {
    const filePath = path.join(this.supervisionPath, WORKFLOW_FILE);
    if (!fs.existsSync(filePath)) {
      return { ...DEFAULT_WORKFLOW };
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = yaml.load(raw) as Record<string, unknown>;

      return {
        onTaskComplete: (parsed.onTaskComplete as WorkflowAction[]) ?? [],
        onCheckpoint: (parsed.onCheckpoint as WorkflowAction[]) ?? [],
        checkpointTrigger: (parsed.checkpointTrigger as CheckpointTrigger) ?? {
          type: 'on_task_complete',
        },
      };
    } catch (err) {
      throw new Error(
        `Failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Write a task execution result to .supervision/results/task-{taskId}.md.
   */
  writeTaskResult(taskId: string, content: string): void {
    const resultsDir = path.join(this.supervisionPath, RESULTS_DIR);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, `task-${taskId}.md`),
      content,
      'utf-8',
    );
  }

  /**
   * Write a review result to .supervision/results/task-{taskId}.review.md.
   */
  writeReviewResult(taskId: string, content: string): void {
    const resultsDir = path.join(this.supervisionPath, RESULTS_DIR);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resultsDir, `task-${taskId}.review.md`),
      content,
      'utf-8',
    );
  }

  /**
   * Read a task result from .supervision/results/task-{taskId}.md.
   */
  getTaskResult(taskId: string): string | undefined {
    const filePath = path.join(this.supervisionPath, RESULTS_DIR, `task-${taskId}.md`);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  // ========================================
  // Private helpers
  // ========================================

  /**
   * Recursively scan a directory for .md files.
   */
  private scanMarkdownFiles(dirPath: string): string[] {
    const results: string[] = [];

    if (!fs.existsSync(dirPath)) {
      return results;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.scanMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * Parse a single .md file into a ContextDocument.
   * Throws on parse errors with file path context.
   */
  private parseDocument(filePath: string, relPath: string): ContextDocument {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = matter(raw);

      return {
        id: relPath,
        category: (parsed.data.category as string) ?? 'general',
        source: (parsed.data.source as string) ?? 'user',
        version: (parsed.data.version as number) ?? 1,
        updated: (parsed.data.updated as string) ?? '',
        content: parsed.content,
      };
    } catch (err) {
      throw new Error(
        `Failed to parse context document ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
