/**
 * Parse a local virtual channel ID into its components.
 *
 * Format: `local:<backendId>:<epoch>`
 * The backendId may itself contain colons, so we use first/last index
 * rather than split(':').
 */
export function parseLocalChannelId(channelId: string): { backendId: string; epoch: string } | null {
  if (!channelId.startsWith('local:')) return null;
  const firstColon = channelId.indexOf(':');   // 5 — after 'local'
  const lastColon = channelId.lastIndexOf(':'); // after backendId
  if (firstColon < 0 || lastColon <= firstColon) return null;
  return {
    backendId: channelId.slice(firstColon + 1, lastColon),
    epoch: channelId.slice(lastColon + 1),
  };
}
