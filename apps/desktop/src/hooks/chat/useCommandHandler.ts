import { useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useSupervisionStore } from '../../stores/supervisionStore';
import * as api from '../../services/api';
import type { CommandExecuteResponse, SlashCommand, Session, Project, MessageRole } from '@my-claudia/shared';

interface UseCommandHandlerParams {
  sessionId: string;
  commands: SlashCommand[];
  currentSession: Session | undefined;
  currentProject: Project | null | undefined;
  isForcedPlanSession: boolean;
  mode: string | null;
  modelOverride: string | null;
  addMessage: (sessionId: string, message: { id: string; clientMessageId?: string; sessionId: string; role: MessageRole; content: string; createdAt: number }) => void;
  clearMessages: (sessionId: string) => void;
  scrollToBottom: () => void;
  startRun: (msg: {
    type: 'run_start';
    clientRequestId: string;
    sessionId: string;
    input: string;
    resend?: boolean;
    mode?: string;
    model?: string;
    workingDirectory?: string;
  }) => Promise<void>;
  providerId: string | undefined;
  commandsCacheKey: string;
  setDrawerOpen: (projectId: string, open: boolean) => void;
  setBottomPanelTab: (tab: string) => void;
}

export function useCommandHandler({
  sessionId,
  commands,
  currentSession,
  currentProject,
  isForcedPlanSession,
  mode,
  modelOverride,
  addMessage,
  clearMessages,
  scrollToBottom,
  startRun,
  providerId,
  commandsCacheKey,
  setDrawerOpen,
  setBottomPanelTab,
}: UseCommandHandlerParams) {
  // Handle built-in command response
  const handleBuiltInCommand = useCallback((result: CommandExecuteResponse) => {
    const { action, data, command: cmdName } = result;

    switch (action) {
      case 'clear':
        clearMessages(sessionId);
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || 'Chat history cleared.',
          createdAt: Date.now(),
        });
        break;

      case 'help':
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.content as string) || 'No help available.',
          createdAt: Date.now(),
        });
        break;

      case 'status': {
        let statusText = '**System Status:**\n\n';
        if (data?.version) statusText += `- **Version:** ${data.version}\n`;
        if (data?.uptime) statusText += `- **Server Uptime:** ${data.uptime}\n`;
        if (data?.model) statusText += `- **Model:** ${data.model}\n`;
        if (data?.provider) statusText += `- **Provider:** ${data.provider}\n`;
        if (data?.nodeVersion) statusText += `- **Node.js:** ${data.nodeVersion}\n`;
        if (data?.platform) statusText += `- **Platform:** ${data.platform}\n`;
        if (data?.projectPath) statusText += `- **Project:** ${data.projectPath}\n`;

        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: statusText,
          createdAt: Date.now(),
        });
        break;
      }

      case 'cost': {
        const usage = data?.tokenUsage as { used: number; total: number; percentage: string } | undefined;
        let costText = '**Token Usage:**\n\n';
        if (usage) {
          costText += `- **Used:** ${usage.used.toLocaleString()} tokens\n`;
          costText += `- **Total:** ${usage.total.toLocaleString()} tokens\n`;
          costText += `- **Usage:** ${usage.percentage}%\n`;
        }
        if (data?.model) {
          costText += `- **Model:** ${data.model}\n`;
        }

        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: costText,
          createdAt: Date.now(),
        });
        break;
      }

      case 'memory': {
        const memoryData = data as { path?: string; exists?: boolean; message?: string; error?: boolean } | undefined;
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: memoryData?.message || 'CLAUDE.md information not available.',
          createdAt: Date.now(),
        });
        break;
      }

      case 'model': {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || `Model: ${data?.model || 'unknown'}\nProvider: ${data?.provider || 'unknown'}`,
          createdAt: Date.now(),
        });
        break;
      }

      case 'config':
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || 'Opening settings...',
          createdAt: Date.now(),
        });
        break;

      case 'new-session':
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: (data?.message as string) || 'Creating new session...',
          createdAt: Date.now(),
        });
        break;

      case 'reload':
        // Re-fetch commands from server (cache already cleared server-side)
        (providerId
          ? api.getProviderCommands(providerId, currentProject?.rootPath || undefined)
          : api.getProviderTypeCommands('claude', currentProject?.rootPath || undefined)
        )
          .then(cmds => {
            useProjectStore.getState().setProviderCommands(commandsCacheKey, cmds);
            addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              role: 'system',
              content: `Commands reloaded (${cmds.length} commands)`,
              createdAt: Date.now(),
            });
            setTimeout(() => scrollToBottom(), 100);
          })
          .catch(err => {
            addMessage(sessionId, {
              id: crypto.randomUUID(),
              sessionId,
              role: 'system',
              content: `Failed to reload commands: ${err.message}`,
              createdAt: Date.now(),
            });
          });
        return; // Skip the scrollToBottom below since we handle it in the .then

      case 'show_panel': {
        // Plugin command: open the panel in the bottom drawer
        const panelId = data?.panelId as string | undefined;
        if (panelId && currentProject?.id) {
          setDrawerOpen(currentProject.id, true);
          setBottomPanelTab(panelId);
        }
        break;
      }

      default:
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Command ${cmdName} executed.`,
          createdAt: Date.now(),
        });
    }

    // Scroll to bottom after command output
    setTimeout(() => scrollToBottom(), 100);
  }, [sessionId, clearMessages, addMessage, scrollToBottom, providerId, currentProject?.rootPath, commandsCacheKey, currentProject?.id, setDrawerOpen, setBottomPanelTab]);

  const handleWorktreeChange = useCallback(async (worktreePath: string) => {
    if (isForcedPlanSession) {
      throw new Error('Worktree switching is locked during Supervisor planning mode.');
    }
    // 乐观更新 projectStore（立即反映在 UI）
    useProjectStore.getState().updateSession(sessionId, {
      workingDirectory: worktreePath || undefined,
    });
    // 持久化到 DB
    try {
      await api.updateSessionWorkingDirectory(sessionId, worktreePath);
    } catch (err) {
      console.error('[Worktree] Failed to persist working directory:', err);
    }
  }, [isForcedPlanSession, sessionId]);

  const handleResetProviderSession = useCallback(async () => {
    try {
      await api.resetSessionSdkSession(sessionId);
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: 'Underlying CLI session reset. The next message will start a new provider-side session.',
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    } catch (err) {
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to reset CLI session: ${(err as Error).message}`,
        createdAt: Date.now(),
      });
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [addMessage, scrollToBottom, sessionId]);

  const handleCommand = useCallback(async (command: string, args: string) => {
    // Find the command definition to check its source
    const commandDef = commands.find(c => c.command === command);

    // Handle /help locally with dynamic command list
    if (command === '/help') {
      const grouped: Record<string, typeof commands> = {};
      for (const cmd of commands) {
        const label = cmd.source === 'local' ? 'Built-in Commands'
          : cmd.source === 'provider' ? 'Provider Commands'
          : cmd.source === 'custom' ? 'Custom Commands'
          : cmd.source === 'plugin' ? 'Plugin Commands'
          : 'Other Commands';
        (grouped[label] ||= []).push(cmd);
      }
      const sections = Object.entries(grouped)
        .map(([label, cmds]) =>
          `**${label}:**\n\n${cmds.map(c => `- \`${c.command}\` — ${c.description}`).join('\n')}`
        )
        .join('\n\n');
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: sections,
        createdAt: Date.now(),
      });
      return;
    }

    // Handle /worktree locally — view or switch
    if (command === '/worktree') {
      if (isForcedPlanSession) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Worktree is locked during Supervisor planning mode.',
          createdAt: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
      const trimmedArgs = args.trim();
      if (!trimmedArgs) {
        const current = currentSession?.workingDirectory || currentProject?.rootPath || '(unknown)';
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Current worktree: \`${current}\`\n\n**Usage:**\n- \`/worktree <path>\` — switch to an existing worktree path\n- \`/worktree reset\` — reset to project root\n- \`/create-worktree [branch] [path]\` — create a new worktree`,
          createdAt: Date.now(),
        });
      } else if (trimmedArgs === 'reset') {
        await handleWorktreeChange('');
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Worktree reset to project root.',
          createdAt: Date.now(),
        });
      } else {
        try {
          await handleWorktreeChange(trimmedArgs);
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: `Worktree set to: \`${trimmedArgs}\``,
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(),
            sessionId,
            role: 'system',
            content: `Failed to set worktree: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
      }
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // Handle /new-cli-session (alias /reset-cli-session) locally.
    if (command === '/new-cli-session' || command === '/reset-cli-session') {
      try {
        await api.resetSessionSdkSession(sessionId);
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Underlying CLI session reset. The next message will start a new provider-side session.',
          createdAt: Date.now(),
        });
      } catch (err) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Failed to reset CLI session: ${(err as Error).message}`,
          createdAt: Date.now(),
        });
      }
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // ── Supervisor commands (only in main supervisor session) ──
    if (currentSession?.projectRole === 'main' && currentProject?.id) {
      if (command === '/create-task') {
        const title = args.trim();
        if (!title) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: 'Usage: `/create-task <title>` — create a new supervision task',
            createdAt: Date.now(),
          });
          setTimeout(() => scrollToBottom(), 100);
          return;
        }
        try {
          const task = await api.createSupervisionTask(currentProject.id, {
            title,
            description: '',
          });
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Task created: **${task.title}** (${task.status})`,
            createdAt: Date.now(),
          });
          // Refresh task list in the card strip (no session created yet)
          useSupervisionStore.getState().upsertTask(currentProject.id, task);
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to create task: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }

      if (command === '/status') {
        try {
          const tasks = await api.getSupervisionTasks(currentProject.id);
          const agentData = await api.getSupervisionAgent(currentProject.id);
          const lines: string[] = [];
          lines.push(`**Agent**: ${agentData?.phase ?? 'unknown'} | Trust: ${agentData?.config.trustLevel ?? '?'} | Concurrent: ${agentData?.config.maxConcurrentTasks ?? '?'}`);
          if (tasks.length === 0) {
            lines.push('\nNo tasks yet. Use `/create-task <title>` to add one.');
          } else {
            const grouped: Record<string, typeof tasks> = {};
            for (const t of tasks) {
              (grouped[t.status] ??= []).push(t);
            }
            for (const [status, items] of Object.entries(grouped)) {
              lines.push(`\n**${status}** (${items.length})`);
              for (const t of items) {
                lines.push(`- ${t.title}${t.priority > 0 ? ` [P${t.priority}]` : ''}`);
              }
            }
          }
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: lines.join('\n'),
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to get status: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }

      if (command === '/pause') {
        try {
          await api.updateSupervisionAgentAction(currentProject.id, 'pause');
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: 'Supervision agent paused.',
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to pause: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }

      if (command === '/resume') {
        try {
          await api.updateSupervisionAgentAction(currentProject.id, 'resume');
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: 'Supervision agent resumed.',
            createdAt: Date.now(),
          });
        } catch (err) {
          addMessage(sessionId, {
            id: crypto.randomUUID(), sessionId, role: 'system',
            content: `Failed to resume: ${(err as Error).message}`,
            createdAt: Date.now(),
          });
        }
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
    }

    // Handle /create-worktree locally — create a new worktree and switch to it
    if (command === '/create-worktree') {
      if (isForcedPlanSession) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'Worktree is locked during Supervisor planning mode.',
          createdAt: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
      if (!currentProject?.id) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: 'No project associated with this session.',
          createdAt: Date.now(),
        });
        setTimeout(() => scrollToBottom(), 100);
        return;
      }
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const branch = parts[0]; // optional — auto-generated if omitted
      const wtPath = parts[1]; // optional
      try {
        const wt = await api.createProjectWorktree(currentProject.id, branch || '', wtPath);
        await handleWorktreeChange(wt.path);
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Worktree created and activated:\n- **Branch:** \`${wt.branch}\`\n- **Path:** \`${wt.path}\``,
          createdAt: Date.now(),
        });
      } catch (err) {
        addMessage(sessionId, {
          id: crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Failed to create worktree: ${(err as Error).message}`,
          createdAt: Date.now(),
        });
      }
      setTimeout(() => scrollToBottom(), 100);
      return;
    }

    // Provider commands should be passed directly to Claude SDK (they are Claude CLI built-ins).
    // Also treat all unrecognized commands (no matching commandDef) as pass-through to Claude,
    // since the input may not be an actual command (e.g. a path like /some/file/path).
    // Plugin commands (source === 'plugin') fall through to api.executeCommand() instead.
    if (commandDef?.source === 'provider' || !commandDef) {
      const commandText = args ? `${command} ${args}` : command;
      const clientMessageId = crypto.randomUUID();
      addMessage(sessionId, {
        id: clientMessageId,
        clientMessageId,
        sessionId,
        role: 'user',
        content: commandText,
        createdAt: Date.now(),
      });

      await startRun({
        type: 'run_start',
        clientRequestId: clientMessageId,
        sessionId,
        input: commandText,
        mode: mode || undefined,
        model: modelOverride || undefined,
        workingDirectory: currentSession?.workingDirectory || undefined,
      });
      return;
    }

    // Parse args into array
    const argsArray = args.trim() ? args.trim().split(/\s+/) : [];

    // Build context for command execution
    const context = {
      projectPath: currentProject?.rootPath,
      projectName: currentProject?.name,
      sessionId,
      provider: currentSession?.providerId || currentProject?.providerId || 'claude',
      model: modelOverride || 'default'
    };

    try {
      // First, try to execute via the commands API
      const result = await api.executeCommand({
        commandName: command,
        commandPath: commandDef?.filePath,
        args: argsArray,
        context,
      });

      if (result.type === 'builtin') {
        // Handle built-in command locally
        handleBuiltInCommand(result);
      } else if (result.type === 'custom' && result.content) {
        // Custom command - send processed content to Claude
        const clientMessageId = crypto.randomUUID();
        addMessage(sessionId, {
          id: clientMessageId,
          clientMessageId,
          sessionId,
          role: 'user',
          content: `${command} ${args}`.trim(),
          createdAt: Date.now(),
        });

        await startRun({
          type: 'run_start',
          clientRequestId: clientMessageId,
          sessionId,
          input: result.content,
          mode: mode || undefined,
          model: modelOverride || undefined,
          workingDirectory: currentSession?.workingDirectory || undefined,
        });
      }
    } catch (error) {
      console.error('Command execution error:', error);

      // Unknown command error
      addMessage(sessionId, {
        id: crypto.randomUUID(),
        sessionId,
        role: 'system',
        content: `Failed to execute command: ${error instanceof Error ? error.message : 'Unknown error'}`,
        createdAt: Date.now(),
      });
    }
  }, [sessionId, addMessage, commands, currentSession, currentProject, handleBuiltInCommand, handleWorktreeChange, scrollToBottom, mode, modelOverride, isForcedPlanSession, startRun]);

  return {
    handleCommand,
    handleBuiltInCommand,
    handleResetProviderSession,
    handleWorktreeChange,
  };
}
