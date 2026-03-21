/**
 * Context Engine types — system prompt content management.
 *
 * Context Engine decides "what to inject" into system prompt.
 * Run-handler decides "how to inject" (via RunOptions.systemPrompt).
 */

export interface AssemblyInput {
  // Project / session context
  projectId?: string;
  sessionId: string;
  cwd?: string;

  // Memory context (from Layer 2, for agent mode)
  memoryContext?: string;

  // Active skills content (from Skill Selector, for agent mode)
  activeSkillsContent?: string;

  // Prompt fragments from run-handler (coding mode)
  workspacePrompt?: string;
  skillDirectoryHint?: string;
  systemContext?: string;
  nonNativePlanPrompt?: string;
  planDocumentPrompt?: string;
  filePushContext?: string;
  interactionToolPrompt?: string;
  sessionSystemPrompt?: string;
}

export type ContextTemplate = 'coding' | 'agent' | 'supervision' | 'review' | 'debug';

export const CONTEXT_TEMPLATES: ContextTemplate[] = ['coding', 'agent', 'supervision', 'review', 'debug'];

export interface ContextEngine {
  assemble(template: ContextTemplate, input: AssemblyInput): string;
}
