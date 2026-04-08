import { createVirtualClient } from '../conversation/transport/types.js';
import { bumpProjectsVersion } from '../conversation/transport/broadcast.js';
import { getGatewayClient } from '../../infrastructure/gateway/gateway-instance.js';
import type { ProjectChangeEvent } from '../../domains/projects/index.js';
import type { SessionEventPublisherPort } from '../../domains/sessions/index.js';
import type { LocalPRAiSessionPort } from '../../domains/local-pr/index.js';
import type { SupervisionAiRunPort } from '../../domains/supervision/index.js';
import type { WorkflowAiRunPort } from '../../domains/workflows/index.js';

interface CreateDomainPortsDeps {
  db: unknown;
  handleRunStart: (...args: any[]) => Promise<void>;
  broadcastHeartbeat: () => void;
}

export interface DomainPorts {
  handleProjectChanged: (event?: ProjectChangeEvent) => void;
  sessionEvents: SessionEventPublisherPort;
  supervisionAiRunPort: SupervisionAiRunPort;
  localPrAiSessionPort: LocalPRAiSessionPort;
  workflowAiRunPort: WorkflowAiRunPort;
}

export function createDomainPorts(deps: CreateDomainPortsDeps): DomainPorts {
  const { db, handleRunStart, broadcastHeartbeat } = deps;

  const handleProjectChanged = (event?: ProjectChangeEvent) => {
    bumpProjectsVersion();
    broadcastHeartbeat();

    if (!event) return;
    const gatewayClient = getGatewayClient();
    if (!gatewayClient) return;

    if (event.type === 'project_upsert') {
      gatewayClient.commands.backendData.broadcastProjectEvent('updated', event.project);
    } else {
      gatewayClient.commands.backendData.broadcastProjectEvent('deleted', { id: event.projectId });
    }
  };

  const sessionEvents: SessionEventPublisherPort = {
    publishSessionEvent: (type, session) => {
      const gatewayClient = getGatewayClient();
      gatewayClient?.commands.backendData.broadcastSessionEvent(type, session);
    },
  };

  const supervisionAiRunPort: SupervisionAiRunPort = {
    startVirtualRun: async ({ clientId, sessionId, input, workingDirectory, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: `${clientId}_${Date.now()}`,
        sessionId,
        input,
        workingDirectory,
      }, db);
    },
  };

  const localPrAiSessionPort: LocalPRAiSessionPort = {
    startAISession: async ({ clientId, sessionId, input, workingDirectory, providerId, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: `${clientId}_${Date.now()}`,
        sessionId,
        input,
        workingDirectory,
        providerId,
      }, db);
    },
  };

  const workflowAiRunPort: WorkflowAiRunPort = {
    startVirtualRun: async ({ clientId, sessionId, input, workingDirectory, providerId, systemContext, onMessage }) => {
      const virtualClient = createVirtualClient(clientId, { send: onMessage });
      await handleRunStart(virtualClient, {
        type: 'run_start',
        clientRequestId: clientId,
        sessionId,
        input,
        workingDirectory,
        providerId,
        systemContext,
      }, db);
    },
  };

  return {
    handleProjectChanged,
    sessionEvents,
    supervisionAiRunPort,
    localPrAiSessionPort,
    workflowAiRunPort,
  };
}
