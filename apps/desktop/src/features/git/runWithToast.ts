import { useToastStore } from '../../stores/toastStore';

/**
 * Runs an async operation and emits a success/error toast.
 * Returns the result on success, or null on failure.
 */
export async function runWithToast<T>(
  label: string,
  projectId: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    const result = await fn();
    useToastStore.getState().add({
      title: `${label} succeeded`,
      type: 'success',
      projectId,
      icon: 'system',
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useToastStore.getState().add({
      title: `${label} failed`,
      message,
      type: 'error',
      projectId,
      icon: 'error',
    });
    return null;
  }
}
