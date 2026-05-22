import { createPortal } from 'react-dom';
import { isDesktopTauri } from '../../utils/platform';
import { SessionItem } from './SessionItem';
import { WorktreeGroupItem } from './WorktreeGroupItem';
import { ProjectWorkspaceItem } from './ProjectWorkspaceItem';
import { groupSessionsByWorktree } from './worktreeGrouping';
import { SortableList, SortableItem } from '../../components/SortableList';
import { Select } from '../../components/ui/Select';
import type { Session } from '@my-claudia/shared';
import type { ProjectListItemProps } from './types';

function splitProjectSessions(
  sessionList: Session[],
  hasSupervisor: boolean,
  supervisorMainSessionId?: string,
) {
  if (!hasSupervisor) {
    return { mainSession: null, taskSessions: [], regularSessions: sessionList };
  }

  const mainSession = (
    supervisorMainSessionId
      ? sessionList.find((session) => session.id === supervisorMainSessionId)
      : undefined
  ) ?? sessionList.find((session) => session.projectRole === 'main') ?? null;
  const taskParentSessionId = supervisorMainSessionId ?? mainSession?.id;
  const taskSessions: Session[] = [];
  const regularSessions: Session[] = [];

  for (const session of sessionList) {
    if (mainSession && session.id === mainSession.id) continue;
    if (taskParentSessionId && session.projectRole === 'task' && session.parentSessionId === taskParentSessionId) {
      taskSessions.push(session);
      continue;
    }
    regularSessions.push(session);
  }

  return { mainSession, taskSessions, regularSessions };
}

export function ProjectListItem({
  project,
  isExpanded,
  onToggle,
  sessions,
  selectedSessionId,
  onSelectSession,
  onOpenDashboard,
  hasPendingForSession,
  activeRunSessionIds,
  getProviderName,
  getWorktreeBranch,
  supervisorAgent,
  worktrees,
  expandedWorktrees,
  onToggleWorktree,
  regularSessionsCollapsed,
  onToggleRegularSessions,
  onReorderSessions,
  isMobile,
  contextMenuProject,
  contextMenuPos,
  onOpenContextMenu,
  onCloseContextMenu,
  onSettingsProject,
  onDeleteProject,
  isCreatingSession,
  newSessionName,
  onNewSessionNameChange,
  newSessionProviderId,
  onNewSessionProviderIdChange,
  onStartCreatingSession,
  onCreateSession,
  onCancelCreateSession,
  isConnected,
  providers,
  onPopOutSession,
}: ProjectListItemProps) {
  const menuWidthClass = isMobile ? 'w-44' : 'w-36';
  const menuButtonClass = isMobile
    ? 'w-8 h-8 rounded-md hover:bg-secondary active:bg-secondary flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100'
    : 'w-6 h-6 rounded-md opacity-0 group-hover:opacity-100 hover:bg-secondary flex-shrink-0 flex items-center justify-center';
  const projectButtonClass = isMobile
    ? 'flex-1 min-w-0 min-h-[36px] text-left px-1 text-sm flex items-center gap-1.5 text-foreground'
    : 'flex-1 min-w-0 h-7 text-left px-1 text-sm flex items-center gap-1.5';
  const menuItemClass = isMobile
    ? 'w-full text-left px-3 py-3 text-sm hover:bg-secondary active:bg-secondary flex items-center gap-2'
    : 'w-full text-left px-3 py-1.5 text-sm hover:bg-secondary flex items-center gap-2';
  const menuContainerClass = `fixed ${menuWidthClass} bg-popover border border-border rounded-xl shadow-lg z-50`;
  const inputClass = isMobile
    ? 'w-full px-3 py-2.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
    : 'w-full px-2 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
  const buttonRowClass = isMobile ? 'flex gap-2 mt-2' : 'flex gap-1 mt-1.5';
  const createBtnClass = isMobile
    ? 'flex-1 px-3 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded-lg text-sm'
    : 'flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-xs';
  const cancelBtnClass = isMobile
    ? 'flex-1 px-3 py-2.5 bg-muted/60 hover:bg-muted active:bg-muted/80 rounded-lg text-sm'
    : 'flex-1 px-2 py-1 bg-muted/60 hover:bg-muted rounded-lg text-xs';
  const sessionFormWrapperClass = isMobile ? '' : 'mt-1';

  const renderSession = (session: Session) => (
    <SessionItem
      key={session.id}
      session={session}
      isSelected={selectedSessionId === session.id}
      onSelect={onSelectSession}
      hasPending={hasPendingForSession(session.id)}
      isActive={activeRunSessionIds.has(session.id)}
      providerName={getProviderName(session)}
      worktreeBranch={getWorktreeBranch(session, project)}
      isMobile={isMobile}
      onPopOut={
        !isMobile && isDesktopTauri() && onPopOutSession
          ? () => onPopOutSession(session.id, session.projectId)
          : undefined
      }
    />
  );

  const renderSortableSessions = (sessionList: Session[], className = 'space-y-0.5') => (
    <SortableList
      items={sessionList.map((s) => s.id)}
      onReorder={(ordered) => onReorderSessions(project.id, ordered)}
      className={className}
    >
      {sessionList.map((session) => (
        <SortableItem key={session.id} id={session.id} dragHandleClassName="w-3 h-3 -ml-0.5 mr-0.5">
          {renderSession(session)}
        </SortableItem>
      ))}
    </SortableList>
  );

  const hasSupervisor = Boolean(supervisorAgent && supervisorAgent.phase !== 'archived');
  const { mainSession, taskSessions, regularSessions } = splitProjectSessions(
    sessions,
    hasSupervisor,
    supervisorAgent?.mainSessionId,
  );
  const supervisorSessionId = hasSupervisor ? (supervisorAgent?.mainSessionId ?? mainSession?.id) : undefined;
  const regularSessionIds = new Set(regularSessions.map((session) => session.id));
  const groups = groupSessionsByWorktree(sessions, project.rootPath, worktrees)
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => regularSessionIds.has(session.id)),
    }))
    .filter((group) => group.sessions.length > 0);

  const renderRegularSessions = () => {
    if (regularSessions.length === 0) return null;
    if (groups.length === 0) {
      return renderSortableSessions(regularSessions);
    }
    return groups.map(group => (
      <WorktreeGroupItem
        key={group.key}
        group={group}
        isExpanded={expandedWorktrees.has(`${project.id}:${group.key}`)}
        onToggle={() => onToggleWorktree(`${project.id}:${group.key}`)}
        isMobile={isMobile}
      >
        {renderSortableSessions(group.sessions)}
      </WorktreeGroupItem>
    ));
  };

  return (
    <>
      <div className="flex items-center group relative">
        <button
          onClick={onToggle}
          className={projectButtonClass}
        >
          <svg
            className={`w-3 h-3 flex-shrink-0 transition-transform text-muted-foreground/60 ${
              isExpanded ? 'rotate-90' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="truncate text-sm font-bold uppercase tracking-wider text-foreground/80">{project.name}</span>
        </button>
        {/* Project menu button */}
        <button
          onClick={(e) => onOpenContextMenu(e, 'project', project.id)}
          className={menuButtonClass}
        >
          <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>

        {/* Project context menu */}
        {contextMenuProject === project.id && contextMenuPos && (
          createPortal(
            <>
              <div className="fixed inset-0 z-40" onClick={onCloseContextMenu} />
              <div className={menuContainerClass} style={{ top: contextMenuPos.top, left: contextMenuPos.left }}>
                <button
                  onClick={() => {
                    onSettingsProject(project.id);
                    onCloseContextMenu();
                  }}
                  className={menuItemClass}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Settings
                </button>
                <button
                  onClick={() => {
                    onStartCreatingSession();
                    onCloseContextMenu();
                  }}
                  disabled={!isConnected}
                  className={`${menuItemClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Session
                </button>
                <button
                  onClick={() => onDeleteProject(project.id)}
                  className={`${menuItemClass} text-destructive`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete
                </button>
              </div>
            </>,
            document.body
          )
        )}
      </div>

      {/* Sessions */}
      {isExpanded && (
        <div className="ml-1 mt-0.5" data-testid="session-list">
          {hasSupervisor && (
            <ProjectWorkspaceItem
              key={supervisorSessionId ?? `${project.id}:supervisor`}
              onSelect={() => {
                if (onOpenDashboard) onOpenDashboard(project.id);
              }}
              isSelected={!!supervisorSessionId && selectedSessionId === supervisorSessionId}
              isActive={!!supervisorSessionId && activeRunSessionIds.has(supervisorSessionId)}
              phase={supervisorAgent?.phase}
              taskCount={taskSessions.length}
              taskChildren={taskSessions.length > 0 ? renderSortableSessions(taskSessions) : null}
            />
          )}
          {regularSessions.length > 0 && hasSupervisor && (
            <div className="mt-1">
              <button
                onClick={onToggleRegularSessions}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Sessions
                </span>
                <span className="text-[10px] text-muted-foreground/50">
                  {regularSessions.length}
                </span>
                <svg
                  className={`ml-auto w-2.5 h-2.5 opacity-40 transition-transform duration-200 ${!regularSessionsCollapsed ? 'rotate-90' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {!regularSessionsCollapsed && (
                <div className="mt-0.5">
                  {renderRegularSessions()}
                </div>
              )}
            </div>
          )}
          {!hasSupervisor && renderRegularSessions()}

          {/* New session form */}
          {isCreatingSession && (
            <div className={sessionFormWrapperClass}>
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => onNewSessionNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateSession();
                  if (e.key === 'Escape') onCancelCreateSession();
                }}
                placeholder="Session name (optional)"
                className={inputClass}
                autoFocus
              />
              {providers.length > 0 && (
                <Select
                  value={newSessionProviderId}
                  onChange={onNewSessionProviderIdChange}
                  block
                  size={isMobile ? 'lg' : 'md'}
                  className={isMobile ? 'mt-2' : 'mt-1'}
                  options={[
                    { value: '', label: 'Default (from project)' },
                    ...providers.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.type})${p.isDefault ? ' *' : ''}`,
                    })),
                  ]}
                />
              )}
              <div className={buttonRowClass}>
                <button
                  onClick={onCreateSession}
                  className={createBtnClass}
                >
                  Create
                </button>
                <button
                  onClick={onCancelCreateSession}
                  className={cancelBtnClass}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
