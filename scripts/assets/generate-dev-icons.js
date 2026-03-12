#!/usr/bin/env node
/**
 * Generate dev variant icons with an orange "DEV" badge overlay.
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
  // Badge is a rounded-rect strip at bottom with "DEV" text
  const badgeHeight = Math.round(height * 0.22);
  const fontSize = Math.round(badgeHeight * 0.65);
  const y = height - badgeHeight;
  const radius = Math.round(badgeHeight * 0.25);

  return Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${y}" width="${width}" height="${badgeHeight}"
            rx="${radius}" ry="${radius}" fill="#FF6B00" opacity="0.92"/>
      <text x="${width / 2}" y="${y + badgeHeight * 0.72}"
            font-family="Arial,Helvetica,sans-serif" font-weight="bold"
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
