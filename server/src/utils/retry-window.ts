// Parsed reset windows can legitimately be hours away (e.g. "resets 7pm (Asia/Shanghai)").
// Keep an upper bound to avoid pathological waits from malformed text.
const MAX_PARSED_DELAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function clampDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, MAX_PARSED_DELAY_MS);
}

function parseDurationToken(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith('ms')) return value;
  if (u.startsWith('s')) return value * 1000;
  if (u.startsWith('m')) return value * 60 * 1000;
  if (u.startsWith('h')) return value * 60 * 60 * 1000;
  return value * 1000;
}

function getZonedParts(ts: number, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(new Date(ts));
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

function zonedLocalToEpoch(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number | null {
  // 1) naive UTC guess
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);

  // 2) derive zone offset at guess
  const p1 = getZonedParts(naiveUtc, timeZone);
  const p1AsUtc = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second);
  const offset1 = p1AsUtc - naiveUtc;
  let ts = naiveUtc - offset1;

  // 3) one more pass for DST/offset boundary correctness
  const p2 = getZonedParts(ts, timeZone);
  const p2AsUtc = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second);
  const offset2 = p2AsUtc - ts;
  ts = naiveUtc - offset2;

  const final = getZonedParts(ts, timeZone);
  return (
    final.year === year &&
    final.month === month &&
    final.day === day &&
    final.hour === hour &&
    final.minute === minute
  ) ? ts : null;
}

/**
 * Try to extract an exact retry delay from provider error text.
 *
 * Order:
 * 1) retry-after style numeric durations
 * 2) "in Xh Ym Zs" style durations
 * 3) "in HH:MM:SS" style durations
 * 4) absolute timestamps (ISO / UTC-like) and compute delta from now
 */
export function extractRetryDelayMsFromError(errorMessage: string, now = Date.now()): number | null {
  const text = errorMessage || '';
  if (!text) return null;

  // 1) retry-after: 12s / 1.5m / 2000ms (optional unit, defaults seconds)
  const retryAfter = text.match(/retry[-\s]?after[:\s]+(\d+(?:\.\d+)?)\s*(ms|msecs?|milliseconds?|s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)?/i);
  if (retryAfter) {
    const value = parseFloat(retryAfter[1]);
    const unit = retryAfter[2] || 's';
    const ms = clampDelay(parseDurationToken(value, unit));
    if (ms > 0) return ms;
  }

  // 2) in 1h 2m 3s / wait 45s / try again in 2 minutes
  const relativePhrase = text.match(/(?:retry|try again|reset(?:s)?|wait)[^.\n]*?\bin\b([^.\n]+)/i);
  if (relativePhrase) {
    const body = relativePhrase[1];
    let total = 0;
    const tokenRegex = /(\d+(?:\.\d+)?)\s*(ms|msecs?|milliseconds?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)/gi;
    let m: RegExpExecArray | null;
    while ((m = tokenRegex.exec(body)) !== null) {
      total += parseDurationToken(parseFloat(m[1]), m[2]);
    }
    const ms = clampDelay(total);
    if (ms > 0) return ms;
  }

  // 3) in HH:MM:SS or MM:SS
  const clockLike = text.match(/\bin\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\b/i);
  if (clockLike) {
    const hasHours = clockLike[3] !== undefined;
    const h = hasHours ? parseInt(clockLike[1], 10) : 0;
    const m = hasHours ? parseInt(clockLike[2], 10) : parseInt(clockLike[1], 10);
    const s = hasHours ? parseInt(clockLike[3] || '0', 10) : parseInt(clockLike[2], 10);
    const ms = clampDelay(((h * 60 + m) * 60 + s) * 1000);
    if (ms > 0) return ms;
  }

  // 3.5) resets 7pm (Asia/Shanghai) / resets 7:30am (Europe/London)
  const resetAtTz = text.match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i);
  if (resetAtTz) {
    const hour12 = parseInt(resetAtTz[1], 10);
    const minute = parseInt(resetAtTz[2] || '0', 10);
    const ampm = resetAtTz[3].toLowerCase();
    const timeZone = resetAtTz[4].trim();

    let hour24 = hour12 % 12;
    if (ampm === 'pm') hour24 += 12;

    try {
      const nowZoned = getZonedParts(now, timeZone);
      let targetYear = nowZoned.year;
      let targetMonth = nowZoned.month;
      let targetDay = nowZoned.day;

      let targetTs = zonedLocalToEpoch(targetYear, targetMonth, targetDay, hour24, minute, timeZone);
      if (targetTs != null && targetTs <= now) {
        const next = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay));
        next.setUTCDate(next.getUTCDate() + 1);
        targetYear = next.getUTCFullYear();
        targetMonth = next.getUTCMonth() + 1;
        targetDay = next.getUTCDate();
        targetTs = zonedLocalToEpoch(targetYear, targetMonth, targetDay, hour24, minute, timeZone);
      }

      if (targetTs != null && targetTs > now) {
        const ms = clampDelay(targetTs - now);
        if (ms > 0) return ms;
      }
    } catch {
      // Invalid/unsupported timezone string — ignore and continue fallbacks.
    }
  }

  // 4) absolute time
  // Examples:
  // - 2026-03-06T10:20:30Z
  // - 2026-03-06 10:20:30 UTC
  const isoLike = text.match(/\b(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2}| UTC)?)\b/i);
  if (isoLike) {
    const normalized = isoLike[1].replace(/\sUTC$/i, 'Z').replace(' ', 'T');
    const ts = Date.parse(normalized);
    if (!Number.isNaN(ts) && ts > now) {
      const ms = clampDelay(ts - now);
      if (ms > 0) return ms;
    }
  }

  return null;
}
