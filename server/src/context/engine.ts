/**
 * Context Engine — system prompt content manager.
 *
 * Phase 1: two fixed templates (coding / agent).
 * Phase 2+: registerTemplate(), setSlot(), dynamic assembly.
 */

import type { AssemblyInput, ContextEngine } from './types.js';

const AGENT_SYSTEM_PROMPT = `You are the Agent Assistant for MyClaudia. You help users manage projects, execute tasks, and automate workflows.

You can:
- Execute shell commands in the project directory
- Read and write files
- Make HTTP requests to external APIs
- Store and retrieve persistent memories across sessions
- Manage projects and sessions

Guidelines:
- Keep responses concise — focus on actions and results.
- For destructive operations (delete, overwrite), confirm with the user first.
- Use the memory tool to remember important information for future sessions.
- When errors occur, explain what went wrong and suggest alternatives.`;

function assembleCodingTemplate(input: AssemblyInput): string {
  return [
    input.workspacePrompt,
    input.skillDirectoryHint,
    input.systemContext,
    input.nonNativePlanPrompt,
    input.planDocumentPrompt,
    input.filePushContext,
    input.interactionToolPrompt,
    input.sessionSystemPrompt,
  ].filter(Boolean).join('\n\n');
}

function assembleAgentTemplate(input: AssemblyInput): string {
  return [
    AGENT_SYSTEM_PROMPT,
    input.workspacePrompt,
    input.skillDirectoryHint,
    input.memoryContext,
    input.filePushContext,
    input.interactionToolPrompt,
    input.sessionSystemPrompt,
  ].filter(Boolean).join('\n\n');
}

const SUPERVISION_SYSTEM_PROMPT = `You are a Supervisor Agent for MyClaudia. You manage code tasks within a project: planning, executing, reviewing, and merging changes.

You can:
- Plan implementation approaches for code changes
- Execute tasks in isolated git worktrees
- Review code changes for correctness and quality
- Manage task dependencies and priorities
- Track project progress and report status

Guidelines:
- Always plan before executing — understand the scope and impact.
- Use git worktrees for isolation when making changes.
- Review all changes before merging to the main branch.
- Report progress clearly and flag any blockers.`;

function assembleSupervisionTemplate(input: AssemblyInput): string {
  return [
    SUPERVISION_SYSTEM_PROMPT,
    input.workspacePrompt,
    input.memoryContext,
    input.sessionSystemPrompt,
  ].filter(Boolean).join('\n\n');
}

export function createContextEngine(): ContextEngine {
  return {
    assemble(template, input) {
      switch (template) {
        case 'agent':
          return assembleAgentTemplate(input);
        case 'supervision':
          return assembleSupervisionTemplate(input);
        case 'coding':
        default:
          return assembleCodingTemplate(input);
      }
    },
  };
}
