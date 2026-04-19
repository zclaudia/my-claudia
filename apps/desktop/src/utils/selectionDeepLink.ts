export interface SelectionDeepLinkTarget {
  backendId: string | null;
  projectId: string | null;
  sessionId: string | null;
}

interface AndroidNotificationBridge {
  consumeSelectionTarget?: () => string;
}

const TARGET_PARAM_KEYS = ['backendId', 'projectId', 'sessionId'] as const;
export const SELECTION_DEEP_LINK_EVENT = 'myclaudia:selection-target';

function parseSelectionDeepLinkParams(params: URLSearchParams): SelectionDeepLinkTarget {
  return {
    backendId: params.get('backendId'),
    projectId: params.get('projectId'),
    sessionId: params.get('sessionId'),
  };
}

export function parseSelectionDeepLink(search: string): SelectionDeepLinkTarget {
  return parseSelectionDeepLinkParams(new URLSearchParams(search));
}

export function parseSelectionDeepLinkUrl(rawUrl: string): SelectionDeepLinkTarget {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { backendId: null, projectId: null, sessionId: null };
  }

  try {
    if (trimmed.startsWith('?')) {
      return parseSelectionDeepLink(trimmed);
    }
    const parsed = new URL(trimmed, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return parseSelectionDeepLinkParams(parsed.searchParams);
  } catch {
    return parseSelectionDeepLink(trimmed);
  }
}

export function hasSelectionDeepLinkTarget(target: SelectionDeepLinkTarget): boolean {
  return Boolean(target.backendId || target.projectId || target.sessionId);
}

export function consumeSelectionDeepLinkFromWindow(): SelectionDeepLinkTarget | null {
  if (typeof window === 'undefined') return null;

  const globalTarget = (window as Window & { __MY_CLAUDIA_PENDING_SELECTION_TARGET__?: string })
    .__MY_CLAUDIA_PENDING_SELECTION_TARGET__;
  if (typeof globalTarget === 'string' && globalTarget.trim()) {
    delete (window as Window & { __MY_CLAUDIA_PENDING_SELECTION_TARGET__?: string })
      .__MY_CLAUDIA_PENDING_SELECTION_TARGET__;
    const parsed = parseSelectionDeepLinkUrl(globalTarget);
    return hasSelectionDeepLinkTarget(parsed) ? parsed : null;
  }

  const bridge = (window as Window & { AndroidNotifications?: AndroidNotificationBridge }).AndroidNotifications;
  if (bridge?.consumeSelectionTarget) {
    const bridgeTarget = bridge.consumeSelectionTarget();
    if (bridgeTarget?.trim()) {
      const parsed = parseSelectionDeepLinkUrl(bridgeTarget);
      return hasSelectionDeepLinkTarget(parsed) ? parsed : null;
    }
  }

  return null;
}

export function clearSelectionDeepLinkFromCurrentUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of TARGET_PARAM_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (!changed) return;
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
