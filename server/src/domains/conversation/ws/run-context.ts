import type Database from 'better-sqlite3';
import type { ContextTemplate } from '../context/types.js';
import type { RunOptions } from '../../../providers/types.js';
import { getDiscoveredSkills, loadSkillContent, buildSkillDirectoryHint } from '../../../plugins/skill-tools.js';
import { selectSkills } from '../../../plugins/skill-selector.js';
import {
  providerSupportsNativePlanMode,
  buildNonNativePlanPrompt,
  buildPlanDocumentPrompt,
  buildFilePushContext,
  buildInteractionToolPrompt,
} from '../../../helpers/server-utils.js';
import { createContextEngine } from '../context/engine.js';
import { workspaceService } from '../../../services/workspace.js';
import { toolRegistry as pluginToolRegistry } from '../../../plugins/tool-registry.js';
import { mapPermissionMode } from '../../../providers/pcp-permission.js';

interface SessionContext {
  id: string;
  project_id: string;
  name: string | null;
  root_path: string | null;
  task_id: string | null;
  system_prompt: string | null;
}

interface ProviderConfigContext {
  cliPath?: string;
  env?: Record<string, string>;
}

interface AdapterContext {
  manifest?: {
    nativeInteractionTools?: string[];
  };
}

export interface BuildRunContextInput {
  adapter: AdapterContext;
  cwd: string;
  db: Database.Database;
  forcedPlanBySession: boolean;
  message: {
    input: string;
    model?: string;
    sessionId: string;
    systemContext?: string;
    mode?: string;
    permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';
  } & Record<string, unknown>;
  modeValue: string;
  providerConfig?: ProviderConfigContext;
  providerType: string;
  sdkSessionId?: string;
  serverPort: number | null;
  session: SessionContext;
  sessionType: 'regular' | 'background' | 'agent';
}

export async function buildRunContext(input: BuildRunContextInput): Promise<{
  nativeMode: string;
  runOptions: RunOptions;
}> {
  const {
    adapter,
    cwd,
    db,
    forcedPlanBySession,
    message,
    modeValue,
    providerConfig,
    providerType,
    sdkSessionId,
    serverPort,
    session,
    sessionType,
  } = input;

  const nativeToolSet = new Set(adapter?.manifest?.nativeInteractionTools ?? []);
  const allInteractionTools = pluginToolRegistry.getAll().filter((tool) => tool.source === 'interaction');
  const injectableInteractionTools = allInteractionTools.filter((tool) => !nativeToolSet.has(tool.id));
  const hasInteractionTools = injectableInteractionTools.length > 0;

  const filePushEnv: Record<string, string> = {};
  let filePushContext: string | undefined;
  if (serverPort) {
    const apiUrl = `http://127.0.0.1:${serverPort}`;
    filePushEnv.MY_CLAUDIA_API_URL = apiUrl;
    filePushEnv.MY_CLAUDIA_SESSION_ID = message.sessionId;
    const hasPushFileTool = injectableInteractionTools.some((tool) => tool.id === 'push_file');
    if (!hasPushFileTool) {
      filePushContext = buildFilePushContext(apiUrl, message.sessionId);
    }
  }

  const nonNativePlanPrompt = modeValue === 'plan' && !providerSupportsNativePlanMode(providerType)
    ? buildNonNativePlanPrompt(providerType)
    : undefined;
  const planDocumentPrompt = forcedPlanBySession && session.task_id
    ? buildPlanDocumentPrompt(session.task_id)
    : undefined;
  const interactionToolPrompt = hasInteractionTools
    ? buildInteractionToolPrompt(injectableInteractionTools.map((tool) => tool.id))
    : undefined;

  const workspacePrompt = await workspaceService.assembleSystemPrompt({
    projectId: session.project_id || undefined,
    projectPath: session.root_path || undefined,
    skills: [],
  });
  const skillDirectoryHint = buildSkillDirectoryHint();

  const nativeMode = adapter.manifest
    ? mapPermissionMode(adapter.manifest as never, modeValue)
    : modeValue;

  let activeSkillsContent: string | undefined;
  if (sessionType === 'agent') {
    try {
      const allSkills = getDiscoveredSkills();
      const matched = selectSkills(allSkills, { userInput: message.input, os: process.platform });
      if (matched.length > 0) {
        activeSkillsContent = matched
          .map((skill) => loadSkillContent(skill.dirPath))
          .filter(Boolean)
          .join('\n\n---\n\n');
      }
    } catch {
      // Skill selection is best-effort and should not block run startup.
    }
  }

  const template = ((message as Record<string, unknown>)._contextTemplate || (sessionType === 'agent' ? 'agent' : 'coding')) as ContextTemplate;
  const systemPrompt = createContextEngine().assemble(template, {
    sessionId: message.sessionId,
    projectId: session.project_id,
    cwd,
    workspacePrompt,
    skillDirectoryHint,
    systemContext: message.systemContext,
    activeSkillsContent,
    nonNativePlanPrompt,
    planDocumentPrompt,
    filePushContext,
    interactionToolPrompt,
    sessionSystemPrompt: session.system_prompt || undefined,
  }) || undefined;

  return {
    nativeMode,
    runOptions: {
      cwd,
      sessionId: sdkSessionId,
      cliPath: providerConfig?.cliPath,
      env: { ...(providerConfig?.env || {}), ...filePushEnv },
      mode: nativeMode,
      model: message.model,
      systemPrompt,
      sessionTitle: session.name || undefined,
      serverPort: serverPort || undefined,
      claudiaSessionId: message.sessionId,
      db,
    },
  };
}
