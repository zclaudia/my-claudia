import { describe, it, expect } from 'vitest';
import { getAgentSystemPrompt, getApiEndpointDocs } from '../agent-prompt';

describe('getAgentSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const prompt = getAgentSystemPrompt();
    expect(prompt).toBeTruthy();
    expect(typeof prompt).toBe('string');
  });

  it('describes the agent role', () => {
    const prompt = getAgentSystemPrompt();
    expect(prompt).toContain('Agent Assistant');
    expect(prompt).toContain('MyClaudia');
  });

  it('includes API endpoint documentation', () => {
    const prompt = getAgentSystemPrompt();
    // Key endpoints should be documented
    expect(prompt).toContain('GET /api/projects');
    expect(prompt).toContain('GET /api/sessions');
    expect(prompt).toContain('GET /api/providers');
    expect(prompt).toContain('POST /api/supervisions');
    expect(prompt).toContain('GET /api/files/list');
    expect(prompt).toContain('GET /api/agent/config');
    expect(prompt).toContain('PUT /api/agent/config');
  });

  it('uses relative API paths (no hardcoded host)', () => {
    const prompt = getAgentSystemPrompt();
    // Should NOT contain hardcoded localhost URLs
    expect(prompt).not.toContain('localhost:3100');
    expect(prompt).not.toContain('http://localhost');
  });

  it('mentions dynamic context from systemContext', () => {
    const prompt = getAgentSystemPrompt();
    expect(prompt).toContain('dynamic context');
  });

  it('includes multi-backend awareness guidelines', () => {
    const prompt = getAgentSystemPrompt();
    expect(prompt).toContain('backend');
  });

  it('includes guidelines section', () => {
    const prompt = getAgentSystemPrompt();
    expect(prompt).toContain('Guidelines');
    expect(prompt).toContain('concise');
    expect(prompt).toContain('destructive');
  });

  it('mentions curl as the tool for API calls', () => {
    const prompt = getAgentSystemPrompt();
    expect(prompt).toContain('curl');
  });

  it('no longer takes serverPort parameter', () => {
    // Function signature should work without arguments
    expect(getAgentSystemPrompt.length).toBe(0);
  });
});

describe('getApiEndpointDocs', () => {
  it('returns docs with the given base URL', () => {
    const docs = getApiEndpointDocs('http://localhost:3100');
    expect(docs).toContain('http://localhost:3100');
    expect(docs).toContain('API Base URL');
  });

  it('includes example curl command', () => {
    const docs = getApiEndpointDocs('https://example.com');
    expect(docs).toContain('curl -s https://example.com/api/projects');
  });
});
