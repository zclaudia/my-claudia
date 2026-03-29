# AI Review CLI Jobs

## Summary

AI review now runs only through provider-specific `cli-jobs`.

It no longer falls back to the normal chat/session provider adapters. This keeps
AI review isolated, single-shot, and machine-oriented.

## Why

The old AI review path reused chat/session adapters that were designed for
interactive conversations. In practice that caused:

- `think` or reasoning text to be mixed with the final review JSON
- provider-specific stream/event noise to leak into parsing
- session drift across repeated review requests
- malformed JSON and schema mismatch failures that were adapter problems, not
  necessarily model problems

## Current flow

1. Local deterministic payload guard classifies the request as:
   - `safe_to_send`
   - `send_with_redaction`
   - `do_not_send`
2. Only allowed payloads continue to remote AI review.
3. Remote AI review uses a provider-specific single-shot CLI job.
4. The provider returns one final review result:
   - `approve`
   - `deny`
   - `uncertain`

## Provider support

AI review is only available for providers whose capabilities report
`supportsCliJobs = true`.

Current built-in providers:

- `claude`
- `codex`
- `cursor`
- `kimi`
- `opencode`

## Enforcement

The `supportsCliJobs` rule is enforced in three places:

1. Provider capabilities API
2. Desktop settings UI for AI review provider selection
3. Server-side validation when saving `analysisProviderId`

That means unsupported providers are not merely hidden in the UI; they are also
rejected on save.

## Diagnostics

Use the real CLI diagnostic script to verify review jobs:

```bash
cd server
node_modules/.bin/tsx scripts/test-cli-review-jobs.ts
```

The script prints:

- provider DB path
- CLI path source
- decision / confidence / reasoning
- stdout / stderr summaries

## Design rule

AI review is a task job, not a chat session.

Future one-shot features with the same shape should prefer the `cli-jobs`
architecture over the interactive provider adapters.
