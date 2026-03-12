console.warn('[deprecated] scripts/assets/generate-icons.cjs now forwards to scripts/assets/regenerate-icons.mjs');
import('./regenerate-icons.mjs').catch((error) => {
  console.error(error);
  process.exit(1);
});
