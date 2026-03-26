/**
 * Facade Constants
 *
 * TTL and GC configuration for stream lifecycle management.
 */

/** TTL for ephemeral runtime streams (no desired state). */
export const EPHEMERAL_STREAM_TTL = 2 * 60_000; // 2 minutes

/** TTL for closed streams with no desired state. */
export const CLOSED_TOMBSTONE_TTL = 10 * 60_000; // 10 minutes

/** TTL for error streams with no desired state. */
export const ERROR_TOMBSTONE_TTL = 30 * 60_000; // 30 minutes

/** Recommended GC interval (caller is responsible for scheduling). */
export const DEFAULT_GC_INTERVAL = 60_000; // 1 minute
