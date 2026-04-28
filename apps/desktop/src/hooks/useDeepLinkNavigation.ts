import { useEffect, useCallback } from 'react';
import { useSelectionCoordinator } from './useSelectionCoordinator';
import {
  clearSelectionDeepLinkFromCurrentUrl,
  consumeSelectionDeepLinkFromWindow,
  hasSelectionDeepLinkTarget,
  parseSelectionDeepLink,
  parseSelectionDeepLinkUrl,
  SELECTION_DEEP_LINK_EVENT,
  type SelectionDeepLinkTarget,
} from '../utils/selectionDeepLink';

/**
 * Handles URL-based and window-event-based deep link navigation
 * (backend/project/session selection from external sources).
 */
export function useDeepLinkNavigation(controlPlaneState: string) {
  const { selectBackend, selectProject: selectProjectRoute, selectSession: selectSessionRoute } = useSelectionCoordinator();

  const applyTarget = useCallback((target: SelectionDeepLinkTarget) => {
    if (!hasSelectionDeepLinkTarget(target)) return;

    if (target.sessionId) {
      selectSessionRoute(target.sessionId, { backendId: target.backendId });
      return;
    }

    if (target.projectId) {
      if (target.backendId) selectBackend(target.backendId);
      selectProjectRoute(target.projectId);
      return;
    }

    if (target.backendId) {
      selectBackend(target.backendId);
    }
  }, [selectBackend, selectProjectRoute, selectSessionRoute]);

  // Apply deep link from URL query params on initial ready
  useEffect(() => {
    if (controlPlaneState !== 'ready') return;
    const target = parseSelectionDeepLink(window.location.search);
    if (!hasSelectionDeepLinkTarget(target)) return;

    applyTarget(target);
    clearSelectionDeepLinkFromCurrentUrl();
  }, [applyTarget, controlPlaneState]);

  // Listen for deep link events from other windows
  useEffect(() => {
    if (controlPlaneState !== 'ready') return;

    const pendingTarget = consumeSelectionDeepLinkFromWindow();
    if (pendingTarget) {
      applyTarget(pendingTarget);
    }

    const handleSelectionTarget = (event: Event) => {
      const rawTarget = (event as CustomEvent<string>).detail;
      if (typeof rawTarget !== 'string' || !rawTarget.trim()) return;
      applyTarget(parseSelectionDeepLinkUrl(rawTarget));
    };

    window.addEventListener(SELECTION_DEEP_LINK_EVENT, handleSelectionTarget as EventListener);
    return () => {
      window.removeEventListener(SELECTION_DEEP_LINK_EVENT, handleSelectionTarget as EventListener);
    };
  }, [applyTarget, controlPlaneState]);
}
