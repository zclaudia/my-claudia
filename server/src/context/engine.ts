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

export function createContextEngine(): ContextEngine {
  return {
    assemble(template, input) {
      switch (template) {
        case 'agent':
          return assembleAgentTemplate(input);
        case 'coding':
        default:
          return assembleCodingTemplate(input);
      }
    },
  };
}
