/**
 * Workflow Generator Service
 *
 * Converts natural language descriptions into WorkflowDefinitionV2
 * using AI providers via the existing virtual client pattern.
 */

import type { Database } from 'better-sqlite3';
import type {
  WorkflowDefinitionV2,
  WorkflowNodeDef,
  WorkflowEdgeDef,
  ServerMessage,
  Session,
} from '@my-claudia/shared';
import { SessionRepository } from '../repositories/session.js';
import { createVirtualClient, handleRunStart } from '../server.js';
import { isValidCron } from '../utils/cron.js';
import { autoLayoutGraph } from '../utils/workflow-layout.js';
import { workflowStepRegistry } from '../plugins/workflow-step-registry.js';
import { BUILTIN_WORKFLOW_TEMPLATES } from '../workflow-templates.js';
import { v4 as uuidv4 } from 'uuid';

// ── Types ────────────────────────────────────────────────────

export interface GenerateResult {
  generationId: string;
  definition: WorkflowDefinitionV2;
  name: string;
  description: string;
  warnings?: string[];
}

interface GenerationSession {
  id: string;
  projectId: string;
  providerId: string;
  currentDefinition: WorkflowDefinitionV2;
  name: string;
  description: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: number;
  timer: NodeJS.Timeout;
}

// ── Constants ────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const GENERATE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

const BUILTIN_STEP_TYPES = [
  { type: 'shell', description: 'Execute a shell command', configFields: 'command (string, required), cwd (string, optional), timeoutMs (number, optional)' },
  { type: 'webhook', description: 'Send an HTTP request', configFields: 'url (string, required), method (string, default GET), headers (object, optional), body (string, optional)' },
  { type: 'notify', description: 'Send a notification', configFields: 'type ("system"), message (string, required), title (string, optional), priority (string, optional), tags (string[], optional)' },
  { type: 'condition', description: 'Evaluate a condition to branch the workflow. Uses node.condition.expression field, not config.', configFields: 'none (use node.condition.expression instead, e.g. "${stepId.output.field} == value")' },
  { type: 'wait', description: 'Wait for timeout or manual approval', configFields: 'type ("timeout" | "approval"), durationMs (number, for timeout type)' },
  { type: 'ai_prompt', description: 'Send a prompt to AI agent for execution (can read/write files, run commands)', configFields: 'prompt (string, required), sessionName (string, optional), workingDirectory (string, optional), providerId (string, optional)' },
  { type: 'ai_review', description: 'AI code review that checks git diff and outputs reviewPassed/reviewNotes', configFields: 'worktreePath (string, optional), passMarker (string, optional), failMarker (string, optional), providerId (string, optional)' },
  { type: 'git_commit', description: 'Auto-commit changes with AI-generated message', configFields: 'cwd (string, optional)' },
  { type: 'git_merge', description: 'Merge a branch into base branch', configFields: 'branch (string, optional), baseBranch (string, required), worktreePath (string, optional)' },
  { type: 'create_worktree', description: 'Create a git worktree with a new branch', configFields: 'branchName (string, required), baseBranch (string, optional)' },
  { type: 'create_pr', description: 'Create a local PR info (title, description, diff)', configFields: 'worktreePath (string, optional), title (string, optional), baseBranch (string, optional)' },
];

// ── Service ──────────────────────────────────────────────────

export class WorkflowGeneratorService {
  private sessions = new Map<string, GenerationSession>();
  private sessionRepo: SessionRepository;

  constructor(private db: Database) {
    this.sessionRepo = new SessionRepository(db);
  }

  /**
   * Generate a workflow from a natural language description.
   */
  async generate(projectId: string, description: string, providerId: string): Promise<GenerateResult> {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = description;

    const aiResponse = await this.callAI(projectId, providerId, systemPrompt, userPrompt);
    const parsed = this.parseResponse(aiResponse);

    // Validate and possibly retry once
    const validated = await this.validateOrRetry(parsed, projectId, providerId, systemPrompt, userPrompt, aiResponse);

    // Auto-layout
    validated.definition.nodes = autoLayoutGraph(
      validated.definition.nodes,
      validated.definition.edges,
      validated.definition.entryNodeId,
    );

    // Create session for future refinements
    const session = this.createSession(projectId, providerId, validated, description, aiResponse);

    return {
      generationId: session.id,
      definition: validated.definition,
      name: validated.name,
      description: validated.description,
      warnings: validated.warnings,
    };
  }

  /**
   * Refine an existing generated workflow with a new instruction.
   */
  async refine(projectId: string, generationId: string, instruction: string): Promise<GenerateResult> {
    const session = this.sessions.get(generationId);
    if (!session) {
      throw new Error('Generation session not found or expired');
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = `Here is the current workflow definition:\n\`\`\`json\n${JSON.stringify({ name: session.name, description: session.description, definition: session.currentDefinition }, null, 2)}\n\`\`\`\n\nPlease modify it according to this instruction: ${instruction}`;

    const aiResponse = await this.callAI(projectId, session.providerId, systemPrompt, userPrompt);
    const parsed = this.parseResponse(aiResponse);

    const validated = await this.validateOrRetry(parsed, projectId, session.providerId, systemPrompt, userPrompt, aiResponse);

    // Auto-layout
    validated.definition.nodes = autoLayoutGraph(
      validated.definition.nodes,
      validated.definition.edges,
      validated.definition.entryNodeId,
    );

    // Update session
    session.currentDefinition = validated.definition;
    session.name = validated.name;
    session.description = validated.description;
    session.history.push(
      { role: 'user', content: instruction },
      { role: 'assistant', content: JSON.stringify(validated.definition) },
    );
    this.resetSessionTimer(session);

    return {
      generationId: session.id,
      definition: validated.definition,
      name: validated.name,
      description: validated.description,
      warnings: validated.warnings,
    };
  }

  // ── Prompt Construction ────────────────────────────────────

  private buildSystemPrompt(): string {
    // Get plugin step types
    const pluginSteps = workflowStepRegistry.getAllMeta();
    const pluginStepDocs = pluginSteps.map(s =>
      `  { type: '${s.type}', description: '${s.description}', category: '${s.category}' }`
    ).join('\n');

    // Pick two template examples
    const exampleTemplates = BUILTIN_WORKFLOW_TEMPLATES
      .filter(t => t.id === 'local-pr-review-merge' || t.id === 'nightly-test-and-fix');
    const examples = exampleTemplates.map(t => JSON.stringify({
      name: t.name,
      description: t.description,
      definition: t.definition,
    }, null, 2)).join('\n\n---\n\n');

    return `You are a workflow generator. Given a natural language description, you generate a valid workflow definition in JSON format.

## Output Format

You MUST output a single JSON block wrapped in \`\`\`json ... \`\`\` with exactly these fields:
{
  "name": "Short workflow name",
  "description": "One-line description",
  "definition": {
    "version": 2,
    "nodes": [...],
    "edges": [...],
    "entryNodeId": "first_node_id",
    "triggers": [...]
  }
}

## Type Definitions

### WorkflowNodeDef
{
  id: string;          // unique snake_case identifier
  name: string;        // human-readable label
  type: string;        // one of the available step types below
  config: object;      // step-type-specific configuration
  position: { x: 0, y: 0 };  // ALWAYS set to {x:0, y:0} — layout is computed automatically
  onError?: 'abort' | 'skip' | 'retry' | 'route';  // default: 'abort'
  retryCount?: number; // only used when onError is 'retry'
  timeoutMs?: number;  // step timeout in milliseconds
  condition?: { expression: string };  // ONLY for 'condition' type nodes
}

### WorkflowEdgeDef
{
  id: string;          // unique edge id like "e1", "e2", ...
  source: string;      // source node id
  target: string;      // target node id
  type: 'success' | 'error' | 'condition_true' | 'condition_false' | 'loop' | 'loop_exhausted';
  label?: string;
  maxIterations?: number;  // only for 'loop' edges, default 3
}

### WorkflowTrigger
One of:
- { type: 'manual' }
- { type: 'cron', cron: '<cron expression>' }  // e.g. '0 9 * * *' for daily 9 AM
- { type: 'interval', intervalMinutes: <number> }
- { type: 'event', event: '<event name>' }  // e.g. 'run.completed'

## Available Step Types

### Built-in:
${BUILTIN_STEP_TYPES.map(s => `- \`${s.type}\`: ${s.description}\n  Config: ${s.configFields}`).join('\n')}

${pluginStepDocs ? `### Plugin Steps:\n${pluginStepDocs}` : ''}

## Variable Interpolation

Reference outputs from previous steps using: \${stepId.output.fieldName}
Reference step status: \${stepId.status}
Built-in variables: \${date} (YYYY-MM-DD), \${timestamp} (Unix ms)

Common output fields:
- shell: stdout, stderr, exitCode
- ai_review: reviewPassed (boolean), reviewNotes (string), sessionId
- create_worktree: worktreePath, branchName
- create_pr: branchName, title, description
- git_merge: merged (boolean)

## Edge Type Rules

- \`success\`: connects a node to its normal next step
- \`error\`: connects a node (with onError='route') to an error-handling node
- \`condition_true\` / \`condition_false\`: connect a 'condition' node to its two branches
- \`loop\`: creates a loop back to an earlier node (with maxIterations)
- \`loop_exhausted\`: exit path when loop iterations are exceeded

## Important Rules

1. Every node MUST be reachable from the entryNodeId via edges (except through loops)
2. No self-loops (edge source === target)
3. condition nodes MUST have both condition_true and condition_false edges
4. Nodes with onError='route' MUST have an error edge
5. Set position to {x:0, y:0} for ALL nodes
6. Use descriptive snake_case node IDs
7. Edge IDs should be sequential: e1, e2, e3...
8. Choose appropriate triggers based on the user's description

## Examples

${examples}

## Your Task

Generate a workflow definition based on the user's natural language description. Output ONLY the JSON block, no other text.`;
  }

  // ── AI Invocation ──────────────────────────────────────────

  private async callAI(
    projectId: string,
    providerId: string,
    systemPrompt: string,
    userPrompt: string,
  ): Promise<string> {
    const session = this.sessionRepo.create({
      projectId,
      name: 'Workflow Generator',
      type: 'background',
      projectRole: 'workflow',
      workingDirectory: undefined,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Workflow generation timed out after ${GENERATE_TIMEOUT_MS}ms`));
      }, GENERATE_TIMEOUT_MS);

      const clientId = `wf_gen_${session.id}_${Date.now()}`;
      createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          if (msg.type === 'run_completed') {
            clearTimeout(timeout);
            // Read assistant messages from DB
            const messages = this.db.prepare(
              "SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 10"
            ).all(session.id) as { content: string }[];
            const allContent = messages.map(m => m.content).join('\n');
            resolve(allContent);
          } else if (msg.type === 'run_failed') {
            clearTimeout(timeout);
            reject(new Error((msg as any).error ?? 'AI generation failed'));
          }
        },
      });

      handleRunStart(
        { id: clientId, authenticated: true, ws: { send: () => {} } } as any,
        {
          type: 'run_start',
          clientRequestId: clientId,
          sessionId: session.id,
          input: userPrompt,
          workingDirectory: undefined,
          providerId,
          systemContext: systemPrompt,
        },
        this.db as any,
      );
    });
  }

  // ── Response Parsing ───────────────────────────────────────

  private parseResponse(response: string): {
    name: string;
    description: string;
    definition: WorkflowDefinitionV2;
    warnings?: string[];
  } {
    // Extract JSON from ```json ... ``` block
    const jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : response.trim();

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      throw new Error(`Failed to parse AI response as JSON. Raw response:\n${response.slice(0, 500)}`);
    }

    // Validate shape
    if (!parsed.definition || !parsed.name) {
      throw new Error('AI response missing required fields: name, definition');
    }

    const def = parsed.definition;
    if (def.version !== 2 || !Array.isArray(def.nodes) || !Array.isArray(def.edges) || !def.entryNodeId) {
      throw new Error('Invalid definition: must have version=2, nodes, edges, entryNodeId');
    }

    if (!Array.isArray(def.triggers) || def.triggers.length === 0) {
      def.triggers = [{ type: 'manual' }];
    }

    return {
      name: parsed.name,
      description: parsed.description ?? '',
      definition: def as WorkflowDefinitionV2,
      warnings: parsed.warnings,
    };
  }

  // ── Validation ─────────────────────────────────────────────

  private validateDefinition(def: WorkflowDefinitionV2): string[] {
    const errors: string[] = [];

    // Check entryNodeId exists
    const nodeIds = new Set(def.nodes.map(n => n.id));
    if (!nodeIds.has(def.entryNodeId)) {
      errors.push(`entryNodeId "${def.entryNodeId}" does not reference an existing node`);
    }

    // Check edges reference valid nodes and no self-loops
    for (const edge of def.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge "${edge.id}" references unknown source "${edge.source}"`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge "${edge.id}" references unknown target "${edge.target}"`);
      }
      if (edge.source === edge.target) {
        errors.push(`Edge "${edge.id}" is a self-loop`);
      }
    }

    // Check step types are valid
    const validTypes = new Set([
      'shell', 'webhook', 'notify', 'condition', 'wait',
      'ai_prompt', 'ai_review', 'git_commit', 'git_merge',
      'create_worktree', 'create_pr',
    ]);
    for (const meta of workflowStepRegistry.getAllMeta()) {
      validTypes.add(meta.type);
    }
    for (const node of def.nodes) {
      if (!validTypes.has(node.type)) {
        errors.push(`Node "${node.id}" has unknown step type "${node.type}"`);
      }
    }

    // Validate cron expressions
    for (const trigger of def.triggers) {
      if (trigger.type === 'cron' && trigger.cron && !isValidCron(trigger.cron)) {
        errors.push(`Invalid cron expression: "${trigger.cron}"`);
      }
    }

    // Condition nodes should have condition_true and condition_false edges
    for (const node of def.nodes) {
      if (node.type === 'condition') {
        const outEdges = def.edges.filter(e => e.source === node.id);
        const hasTrue = outEdges.some(e => e.type === 'condition_true');
        const hasFalse = outEdges.some(e => e.type === 'condition_false');
        if (!hasTrue || !hasFalse) {
          errors.push(`Condition node "${node.id}" must have both condition_true and condition_false edges`);
        }
      }
    }

    return errors;
  }

  private async validateOrRetry(
    parsed: { name: string; description: string; definition: WorkflowDefinitionV2; warnings?: string[] },
    projectId: string,
    providerId: string,
    systemPrompt: string,
    originalUserPrompt: string,
    originalResponse: string,
  ): Promise<{ name: string; description: string; definition: WorkflowDefinitionV2; warnings?: string[] }> {
    const errors = this.validateDefinition(parsed.definition);
    if (errors.length === 0) return parsed;

    // Retry once with error feedback
    const retryPrompt = `${originalUserPrompt}\n\nIMPORTANT: Your previous output had validation errors:\n${errors.map(e => `- ${e}`).join('\n')}\n\nPlease fix these errors and output a corrected JSON.`;

    try {
      const retryResponse = await this.callAI(projectId, providerId, systemPrompt, retryPrompt);
      const retryParsed = this.parseResponse(retryResponse);
      const retryErrors = this.validateDefinition(retryParsed.definition);

      if (retryErrors.length > 0) {
        // Still has errors — return with warnings
        retryParsed.warnings = [
          ...(retryParsed.warnings ?? []),
          ...retryErrors.map(e => `Validation warning: ${e}`),
        ];
      }
      return retryParsed;
    } catch {
      // Retry failed — return original with warnings
      parsed.warnings = [
        ...(parsed.warnings ?? []),
        ...errors.map(e => `Validation warning: ${e}`),
      ];
      return parsed;
    }
  }

  // ── Session Management ─────────────────────────────────────

  private createSession(
    projectId: string,
    providerId: string,
    result: { name: string; description: string; definition: WorkflowDefinitionV2 },
    userDescription: string,
    aiResponse: string,
  ): GenerationSession {
    const id = uuidv4();
    const session: GenerationSession = {
      id,
      projectId,
      providerId,
      currentDefinition: result.definition,
      name: result.name,
      description: result.description,
      history: [
        { role: 'user', content: userDescription },
        { role: 'assistant', content: aiResponse },
      ],
      createdAt: Date.now(),
      timer: setTimeout(() => this.sessions.delete(id), SESSION_TTL_MS),
    };
    this.sessions.set(id, session);
    return session;
  }

  private resetSessionTimer(session: GenerationSession): void {
    clearTimeout(session.timer);
    session.timer = setTimeout(() => this.sessions.delete(session.id), SESSION_TTL_MS);
  }
}
