export type SetPassthrough = (passthrough: boolean) => Promise<unknown>;

export interface PassthroughController {
  set: (passthrough: boolean) => Promise<void>;
}

export function createPassthroughController(apply: SetPassthrough): PassthroughController {
  let requested: boolean | null = null;
  let applied: boolean | null = null;
  let inFlight: Promise<void> | null = null;

  const flush = async () => {
    while (requested !== applied) {
      const next = requested;
      if (next === null) return;
      await apply(next);
      applied = next;
    }
  };

  return {
    set: (passthrough) => {
      requested = passthrough;
      if (!inFlight) {
        inFlight = flush()
          .finally(() => {
            inFlight = null;
          });
      }
      return inFlight;
    },
  };
}
