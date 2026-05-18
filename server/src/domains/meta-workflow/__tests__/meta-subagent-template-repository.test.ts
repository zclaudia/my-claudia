// server/src/domains/meta-workflow/__tests__/meta-subagent-template-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migration as m069 } from '../../../infrastructure/storage/migrations/069_meta_workflow.js';
import { MetaSubagentTemplateRepository } from '../repositories/meta-subagent-template-repository.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY);`);
  db.exec(m069.sql);
  return db;
}

describe('MetaSubagentTemplateRepository', () => {
  let db: Database.Database;
  let repo: MetaSubagentTemplateRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new MetaSubagentTemplateRepository(db);
  });

  it('creates a template with allowedTools array', () => {
    const now = Date.now();
    const tmpl = repo.create({
      name: 'investigation-default',
      systemPrompt: 'You investigate.',
      allowedTools: ['Read', 'Grep', 'Bash'],
      maxTurns: 30,
      terminationCondition: { kind: 'output-file', target: 'report.md' },
      sourceType: 'auto',
      createdAt: now,
      updatedAt: now,
    });
    expect(tmpl.id).toBeTruthy();
    expect(tmpl.allowedTools).toEqual(['Read', 'Grep', 'Bash']);
    expect(tmpl.terminationCondition.kind).toBe('output-file');
  });

  it('round-trips terminationCondition with output-keyword variant', () => {
    const now = Date.now();
    const tmpl = repo.create({
      systemPrompt: 'p',
      allowedTools: ['Read'],
      maxTurns: 10,
      terminationCondition: { kind: 'output-keyword', target: '[DONE]' },
      sourceType: 'auto',
      createdAt: now,
      updatedAt: now,
    });
    const fetched = repo.findById(tmpl.id);
    expect(fetched?.terminationCondition).toEqual({ kind: 'output-keyword', target: '[DONE]' });
  });

  it('updates allowedTools', () => {
    const now = Date.now();
    const tmpl = repo.create({
      systemPrompt: 'p', allowedTools: ['Read'],
      maxTurns: 10,
      terminationCondition: { kind: 'output-keyword', target: '[X]' },
      sourceType: 'auto', createdAt: now, updatedAt: now,
    });
    const updated = repo.update(tmpl.id, { allowedTools: ['Read', 'Grep', 'Glob'], updatedAt: now + 1 });
    expect(updated.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
  });
});
