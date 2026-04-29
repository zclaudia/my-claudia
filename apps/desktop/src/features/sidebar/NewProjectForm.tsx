import type { NewProjectFormProps } from './types';

export function NewProjectForm({
  showForm,
  onShowForm,
  newProjectName,
  onProjectNameChange,
  newProjectRootPath,
  onProjectRootPathChange,
  onCreateProject,
  creatingProject,
  isConnected,
  isMobile,
}: NewProjectFormProps) {
  const inputClass = isMobile
    ? 'w-full px-3 py-2.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
    : 'w-full px-2 py-1.5 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
  const rootInputClass = isMobile
    ? 'w-full px-3 py-2.5 mt-1 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50'
    : 'w-full px-2 py-1.5 mt-1 bg-muted/60 border-0 rounded-lg text-sm shadow-apple-sm focus:outline-none focus:ring-1 focus:ring-primary/50';
  const buttonRowClass = isMobile ? 'flex gap-2 mt-2' : 'flex gap-1 mt-1.5';
  const createBtnClass = isMobile
    ? 'flex-1 px-3 py-2.5 bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 rounded-lg text-sm disabled:opacity-50'
    : 'flex-1 px-2 py-1 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-xs disabled:opacity-50';
  const cancelBtnClass = isMobile
    ? 'flex-1 px-3 py-2.5 bg-muted/60 hover:bg-muted active:bg-muted/80 rounded-lg text-sm'
    : 'flex-1 px-2 py-1 bg-muted/60 hover:bg-muted rounded-lg text-xs';
  const newProjectBtnClass = isMobile
    ? 'w-full mt-1 min-h-[36px] text-left px-1 text-sm flex items-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground active:text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed'
    : 'w-full mt-1 h-7 text-left px-1 text-sm flex items-center gap-1.5 text-muted-foreground/50 hover:text-muted-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

  const handleCancel = () => {
    onShowForm(false);
    onProjectNameChange('');
    onProjectRootPathChange('');
  };

  if (showForm) {
    return (
      <div className="mt-1 px-1">
        <input
          type="text"
          value={newProjectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCancel();
          }}
          placeholder="Project name"
          className={inputClass}
          autoFocus
        />
        <input
          type="text"
          value={newProjectRootPath}
          onChange={(e) => onProjectRootPathChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCreateProject();
            if (e.key === 'Escape') handleCancel();
          }}
          placeholder="Working directory (e.g. /path/to/project)"
          className={rootInputClass}
        />
        <div className={buttonRowClass}>
          <button
            onClick={onCreateProject}
            disabled={!newProjectName.trim() || creatingProject}
            className={createBtnClass}
          >
            {creatingProject ? 'Creating...' : 'Create'}
          </button>
          <button
            onClick={handleCancel}
            className={cancelBtnClass}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => onShowForm(true)}
      disabled={!isConnected}
      className={newProjectBtnClass}
    >
      <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
      <span className="text-[11px] tracking-wide">New Project</span>
    </button>
  );
}
