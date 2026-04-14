#!/usr/bin/env node
/**
 * Generate dev variant icons with a high-contrast corner badge overlay.
 * Uses sharp (already in devDependencies).
 *
 * Output: ic_launcher_dev.png, ic_launcher_dev_round.png, ic_launcher_dev_foreground.png
 *         in each mipmap-* directory alongside the release icons.
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RES_DIR = path.join(
  __dirname,
  '../../apps/desktop/src-tauri/gen/android/app/src/main/res'
);

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];

function createBadgeSvg(width, height) {
  const badgeWidth = Math.round(width * 0.32);
  const badgeHeight = Math.round(height * 0.15);
  const x = Math.round((width - badgeWidth) / 2);
  const y = Math.round(height * 0.66);
  const corner = Math.round(badgeHeight * 0.5);
  const fontSize = Math.round(badgeHeight * 0.58);
  const shadowBlur = Math.max(4, Math.round(badgeHeight * 0.16));
  const shadowOffset = Math.max(2, Math.round(badgeHeight * 0.08));

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="${shadowOffset}" dy="${shadowOffset}" stdDeviation="${shadowBlur}" flood-color="#111827" flood-opacity="0.35"/>
        </filter>
      </defs>
      <g filter="url(#shadow)">
        <rect x="${x}" y="${y}" width="${badgeWidth}" height="${badgeHeight}"
              rx="${corner}" ry="${corner}" fill="#FF6A00"/>
        <rect x="${x + Math.max(2, Math.round(badgeHeight * 0.12))}" y="${y + Math.max(2, Math.round(badgeHeight * 0.12))}"
              width="${badgeWidth - Math.max(4, Math.round(badgeHeight * 0.24))}" height="${badgeHeight - Math.max(4, Math.round(badgeHeight * 0.24))}"
              rx="${Math.round(corner * 0.78)}" ry="${Math.round(corner * 0.78)}"
              fill="none" stroke="#FFF7ED" stroke-width="${Math.max(2, Math.round(badgeHeight * 0.08))}" opacity="0.9"/>
      </g>
      <text x="${x + badgeWidth / 2}" y="${y + badgeHeight * 0.68}"
            font-family="Arial,Helvetica,sans-serif" font-weight="900"
            font-size="${fontSize}" fill="white" text-anchor="middle">DEV</text>
    </svg>
  `);
}

async function processIcon(density, srcName, dstName) {
  const dir = path.join(RES_DIR, `mipmap-${density}`);
  const srcPath = path.join(dir, srcName);
  const dstPath = path.join(dir, dstName);

  const meta = await sharp(srcPath).metadata();
  const badge = createBadgeSvg(meta.width, meta.height);

  await sharp(srcPath)
    .composite([{ input: badge, top: 0, left: 0 }])
    .toFile(dstPath);

  console.log(`  ${density}/${dstName} (${meta.width}x${meta.height})`);
}

async function main() {
  console.log('Generating dev icons...');

  for (const density of DENSITIES) {
    await processIcon(density, 'ic_launcher_foreground.png', 'ic_launcher_dev_foreground.png');
    await processIcon(density, 'ic_launcher.png', 'ic_launcher_dev.png');
    await processIcon(density, 'ic_launcher_round.png', 'ic_launcher_dev_round.png');
  }

  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
