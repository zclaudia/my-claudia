/**
 * Internal Interaction Tools
 *
 * Registers my-claudia's own interaction tools in the tool registry.
 * These tools are injected into providers via the MCP bridge and allow
 * the AI to produce structured interaction events.
 *
 * - update_todo_list: fire-and-forget, emits interaction_todo_update
 * - ask_user_form: blocks until user responds, emits interaction_ask_user_form
 */

import { v4 as uuidv4 } from 'uuid';
import { toolRegistry } from '../plugins/tool-registry.js';
import { interactionDispatcher } from './interaction-dispatcher.js';
import { normalizeTodoItems } from './todo-normalizer.js';
import type { TodoUpdateInteractionMessage, AskUserFormInteractionMessage, ApprovalInteractionMessage } from '@my-claudia/shared';

export function registerInteractionTools(): void {
  // ============================================
  // update_todo_list — fire-and-forget
  // ============================================
  toolRegistry.register({
    id: 'update_todo_list',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'update_todo_list',
        description: 'Update the visible task list for the user. Call this to show progress on multi-step tasks. Each call replaces the previous list.',
        parameters: {
          type: 'object',
          properties: {
            todos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string', description: 'Task description' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Task status' },
                },
                required: ['content', 'status'],
              },
              description: 'The full task list (replaces previous)',
            },
          },
          required: ['todos'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const interactionId = uuidv4();
      const todos = normalizeTodoItems(args.todos);

      const event: TodoUpdateInteractionMessage = {
        type: 'interaction_todo_update',
        interactionId,
        sessionId,
        source: 'tool_call',
        createdAt: Date.now(),
        todos,
      };

      interactionDispatcher.dispatchFireAndForget(sessionId, event);
      return JSON.stringify({ success: true, interactionId });
    },
  });

  // ============================================
  // ask_user_form — blocks until user responds
  // ============================================
  toolRegistry.register({
    id: 'ask_user_form',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'ask_user_form',
        description: 'Present a structured form to the user and wait for their response. Use this when you need specific structured input — multiple fields, choices, or confirmations.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Form title' },
            description: { type: 'string', description: 'Optional description or instructions' },
            fields: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Unique field ID (used as key in response)' },
                  label: { type: 'string', description: 'Display label' },
                  type: { type: 'string', enum: ['text', 'select', 'multiselect', 'textarea', 'confirm'], description: 'Field type' },
                  options: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        value: { type: 'string' },
                        label: { type: 'string' },
                      },
                      required: ['value', 'label'],
                    },
                    description: 'Options for select/multiselect fields',
                  },
                  required: { type: 'boolean', description: 'Whether field is required' },
                  defaultValue: { type: 'string', description: 'Default value' },
                  placeholder: { type: 'string', description: 'Placeholder text' },
                },
                required: ['id', 'label', 'type'],
              },
              description: 'Form fields',
            },
          },
          required: ['title', 'fields'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const interactionId = uuidv4();

      const event: AskUserFormInteractionMessage = {
        type: 'interaction_ask_user_form',
        interactionId,
        sessionId,
        source: 'tool_call',
        createdAt: Date.now(),
        title: (args.title as string) || 'Form',
        description: args.description as string | undefined,
        fields: (args.fields as AskUserFormInteractionMessage['fields']) || [],
      };

      const response = await interactionDispatcher.dispatchAndWait(interactionId, sessionId, event);
      return JSON.stringify(response);
    },
  });

  // ============================================
  // request_approval — blocks until user approves/rejects
  // ============================================
  toolRegistry.register({
    id: 'request_approval',
    source: 'interaction',
    definition: {
      type: 'function',
      function: {
        name: 'request_approval',
        description: 'Request user approval before proceeding with an action. Blocks until the user approves or rejects. Use this for destructive, irreversible, or high-impact operations.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the approval request' },
            message: { type: 'string', description: 'Detailed description of what will happen if approved' },
            approveLabel: { type: 'string', description: 'Custom label for the approve button (default: "Approve")' },
            rejectLabel: { type: 'string', description: 'Custom label for the reject button (default: "Reject")' },
          },
          required: ['title', 'message'],
        },
      },
    },
    handler: async (args, context) => {
      const sessionId = (context?.sessionId as string) || '';
      const interactionId = uuidv4();

      const event: ApprovalInteractionMessage = {
        type: 'interaction_approval',
        interactionId,
        sessionId,
        source: 'tool_call',
        createdAt: Date.now(),
        title: (args.title as string) || 'Approval Required',
        message: (args.message as string) || '',
        approveLabel: args.approveLabel as string | undefined,
        rejectLabel: args.rejectLabel as string | undefined,
      };

      const response = await interactionDispatcher.dispatchAndWait(interactionId, sessionId, event);
      return JSON.stringify(response);
    },
  });

  console.log('[InteractionTools] Registered 3 interaction tools: update_todo_list, ask_user_form, request_approval');
}
