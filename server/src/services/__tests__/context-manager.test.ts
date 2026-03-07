import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ContextManager } from '../context-manager.js';

describe('ContextManager', () => {
  let tmpRoot: string;
  let cm: ContextManager;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-manager-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Each test gets a fresh subdirectory
    const testDir = fs.mkdtempSync(path.join(tmpRoot, 'proj-'));
    cm = new ContextManager(testDir);
  });

  describe('isInitialized()', () => {
    it('returns false for an empty directory', () => {
      expect(cm.isInitialized()).toBe(false);
    });

    it('returns true after scaffold', () => {
      cm.scaffold('TestProject');
      expect(cm.isInitialized()).toBe(true);
    });
  });

  describe('scaffold()', () => {
    it('creates correct directory structure', () => {
      cm.scaffold('MyProject');

      const supervisionPath = path.join((cm as any).rootPath, '.supervision');
      expect(fs.existsSync(supervisionPath)).toBe(true);
      expect(fs.existsSync(path.join(supervisionPath, 'specs'))).toBe(true);
      expect(fs.existsSync(path.join(supervisionPath, 'guidelines'))).toBe(true);
      expect(fs.existsSync(path.join(supervisionPath, 'knowledge'))).toBe(true);
      expect(fs.existsSync(path.join(supervisionPath, 'results'))).toBe(true);
    });

    it('creates goal.md with proper frontmatter', () => {
      cm.scaffold('MyProject');

      const goalPath = path.join((cm as any).rootPath, '.supervision', 'goal.md');
      const content = fs.readFileSync(goalPath, 'utf-8');

      expect(content).toContain('---');
      expect(content).toContain('category: goal');
      expect(content).toContain('source: user');
      expect(content).toContain('version: 1');
      expect(content).toContain('updated:');
      expect(content).toContain('# Project Goal');
      expect(content).toContain('MyProject');
    });

    it('creates project-summary.md with frontmatter', () => {
      cm.scaffold('MyProject');

      const summaryPath = path.join((cm as any).rootPath, '.supervision', 'project-summary.md');
      const content = fs.readFileSync(summaryPath, 'utf-8');

      expect(content).toContain('category: summary');
      expect(content).toContain('source: agent');
      expect(content).toContain('version: 1');
    });

    it('creates default workflow.yaml', () => {
      cm.scaffold('MyProject');

      const workflowPath = path.join((cm as any).rootPath, '.supervision', 'workflow.yaml');
      expect(fs.existsSync(workflowPath)).toBe(true);

      const content = fs.readFileSync(workflowPath, 'utf-8');
      expect(content).toContain('onTaskComplete');
      expect(content).toContain('onCheckpoint');
      expect(content).toContain('checkpointTrigger');
    });
  });

  describe('loadAll()', () => {
    it('returns documents and workflow config', () => {
      cm.scaffold('TestProj');

      const result = cm.loadAll();

      expect(result.documents).toBeDefined();
      expect(Array.isArray(result.documents)).toBe(true);
      expect(result.workflow).toBeDefined();
      expect(result.workflow.onTaskComplete).toBeDefined();
      expect(result.workflow.onCheckpoint).toBeDefined();
      expect(result.workflow.checkpointTrigger).toBeDefined();
    });

    it('includes goal.md and project-summary.md as documents', () => {
      cm.scaffold('TestProj');

      const { documents } = cm.loadAll();
      const ids = documents.map((d) => d.id);

      expect(ids).toContain('goal.md');
      expect(ids).toContain('project-summary.md');
    });

    it('excludes files in results/ directory', () => {
      cm.scaffold('TestProj');

      // Write a result file
      cm.writeTaskResult('task-1', '# Result\nSome result');

      const { documents } = cm.loadAll();
      const ids = documents.map((d) => d.id);

      // results/task-task-1.md should not be in documents
      expect(ids.every((id) => !id.startsWith('results/'))).toBe(true);
    });
  });

  describe('getDocument()', () => {
    it('returns a single document by relative path', () => {
      cm.scaffold('TestProj');

      const doc = cm.getDocument('goal.md');

      expect(doc).toBeDefined();
      expect(doc!.id).toBe('goal.md');
      expect(doc!.category).toBe('goal');
      expect(doc!.source).toBe('user');
      expect(doc!.version).toBe(1);
      expect(doc!.content).toContain('# Project Goal');
    });

    it('returns undefined for non-existent document', () => {
      cm.scaffold('TestProj');
      const doc = cm.getDocument('nonexistent.md');
      expect(doc).toBeUndefined();
    });
  });

  describe('updateDocument()', () => {
    it('increments version when updating existing document', () => {
      cm.scaffold('TestProj');

      // goal.md starts at version 1
      const before = cm.getDocument('goal.md');
      expect(before!.version).toBe(1);

      cm.updateDocument('goal.md', '# Updated Goal\n\nNew content');

      const after = cm.getDocument('goal.md');
      expect(after!.version).toBe(2);
      expect(after!.content).toContain('# Updated Goal');
    });

    it('preserves existing category and source when not provided', () => {
      cm.scaffold('TestProj');

      cm.updateDocument('goal.md', '# Updated content');

      const doc = cm.getDocument('goal.md');
      expect(doc!.category).toBe('goal');
      expect(doc!.source).toBe('user');
    });

    it('creates a new document with provided meta', () => {
      cm.scaffold('TestProj');

      cm.updateDocument('specs/api.md', '# API Spec\n\nREST endpoints', {
        category: 'spec',
        source: 'user',
      });

      const doc = cm.getDocument('specs/api.md');
      expect(doc).toBeDefined();
      expect(doc!.category).toBe('spec');
      expect(doc!.version).toBe(1);
      expect(doc!.content).toContain('# API Spec');
    });
  });

  describe('getProjectSummary() / updateProjectSummary()', () => {
    it('returns empty content after scaffold', () => {
      cm.scaffold('TestProj');

      const summary = cm.getProjectSummary();
      // After scaffold, project-summary.md has frontmatter but no body
      expect(summary).toBeDefined();
      expect(summary!.trim()).toBe('');
    });

    it('returns updated content after updateProjectSummary', () => {
      cm.scaffold('TestProj');

      cm.updateProjectSummary('This is a summary of the project.\nIt has multiple lines.');

      const summary = cm.getProjectSummary();
      expect(summary).toContain('This is a summary of the project.');
    });

    it('updateProjectSummary sets category=summary and source=agent', () => {
      cm.scaffold('TestProj');

      cm.updateProjectSummary('Summary text');

      const doc = cm.getDocument('project-summary.md');
      expect(doc!.category).toBe('summary');
      expect(doc!.source).toBe('agent');
    });

    it('returns undefined if .supervision/ does not exist', () => {
      // cm is pointing to an empty dir without scaffold
      const summary = cm.getProjectSummary();
      expect(summary).toBeUndefined();
    });
  });

  describe('getContextForTask()', () => {
    it('includes project summary when available', () => {
      cm.scaffold('TestProj');
      cm.updateProjectSummary('Project overview text');

      const context = cm.getContextForTask();

      expect(context).toContain('## Project Summary');
      expect(context).toContain('Project overview text');
    });

    it('includes all non-results documents when no relevantDocIds provided', () => {
      cm.scaffold('TestProj');

      const context = cm.getContextForTask();

      // Should contain goal.md (not project-summary since it's filtered separately)
      expect(context).toContain('goal.md');
    });

    it('only includes specified documents when relevantDocIds provided', () => {
      cm.scaffold('TestProj');

      // Create an additional document
      cm.updateDocument('specs/api.md', '# API docs', { category: 'spec', source: 'user' });

      const context = cm.getContextForTask(['specs/api.md']);

      expect(context).toContain('specs/api.md');
      // goal.md should NOT be included since it's not in the relevantDocIds list
      expect(context).not.toContain('goal.md (goal)');
    });

    it('always includes project summary even when relevantDocIds specified', () => {
      cm.scaffold('TestProj');
      cm.updateProjectSummary('Always included summary');

      const context = cm.getContextForTask(['specs/nonexistent.md']);

      expect(context).toContain('## Project Summary');
      expect(context).toContain('Always included summary');
    });
  });

  describe('getWorkflow()', () => {
    it('returns parsed workflow from file', () => {
      cm.scaffold('TestProj');

      const workflow = cm.getWorkflow();

      expect(workflow).toBeDefined();
      expect(Array.isArray(workflow.onTaskComplete)).toBe(true);
      expect(Array.isArray(workflow.onCheckpoint)).toBe(true);
      expect(workflow.checkpointTrigger).toEqual({ type: 'on_task_complete' });
    });

    it('returns default config when file does not exist', () => {
      // No scaffold — workflow.yaml does not exist
      const workflow = cm.getWorkflow();

      expect(workflow.onTaskComplete).toEqual([]);
      expect(workflow.onCheckpoint).toEqual([]);
      expect(workflow.checkpointTrigger).toEqual({ type: 'on_task_complete' });
    });
  });

  describe('writeTaskResult() / getTaskResult()', () => {
    it('writes and reads a task result', () => {
      cm.scaffold('TestProj');

      const content = '# Task Result\n\n## Summary\nDid some work\n';
      cm.writeTaskResult('abc-123', content);

      const result = cm.getTaskResult('abc-123');
      expect(result).toBe(content);
    });

    it('returns undefined for non-existent result', () => {
      cm.scaffold('TestProj');

      const result = cm.getTaskResult('nonexistent');
      expect(result).toBeUndefined();
    });

    it('creates results directory if it does not exist', () => {
      // After scaffold, results dir exists, but let's test without scaffold
      // We need to manually create the .supervision dir first
      const supervisionPath = (cm as any).supervisionPath;
      fs.mkdirSync(supervisionPath, { recursive: true });

      cm.writeTaskResult('new-task', 'Result content');

      const resultsDir = path.join(supervisionPath, 'results');
      expect(fs.existsSync(resultsDir)).toBe(true);

      const result = cm.getTaskResult('new-task');
      expect(result).toBe('Result content');
    });
  });

  describe('writeReviewResult()', () => {
    it('creates a .review.md file', () => {
      cm.scaffold('TestProj');

      const content = '# Review\n\nLooks good, minor issues.';
      cm.writeReviewResult('task-42', content);

      const reviewPath = path.join(
        (cm as any).supervisionPath,
        'results',
        'task-task-42.review.md',
      );
      expect(fs.existsSync(reviewPath)).toBe(true);

      const readContent = fs.readFileSync(reviewPath, 'utf-8');
      expect(readContent).toBe(content);
    });
  });
});
