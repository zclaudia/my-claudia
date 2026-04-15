/**
 * Legacy compatibility shim for older E2E config.
 *
 * Historical AI-assisted helpers were removed, but the E2E Vitest config still
 * imports this file as a setup module. Keep it as a no-op so targeted E2E runs
 * and older suites can bootstrap without module resolution failures.
 */

export {};
