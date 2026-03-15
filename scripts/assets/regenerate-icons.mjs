/**
 * Regenerate app icons with transparent background
 * Removes the white border from the source icon
 */

import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const SOURCE_ICON = path.join(ROOT, 'assets/source-icon.png');
const ICONS_DIR = path.join(ROOT, 'apps/desktop/src-tauri/icons');

// Icon sizes needed for Tauri
const ICON_SIZES = {
  // Standard PNG icons
  '32x32.png': 32,
  '64x64.png': 64,
  '128x128.png': 128,
  '128x128@2x.png': 256,
  'icon.png': 512,

  // Windows Store logos
  'Square30x30Logo.png': 30,
  'Square44x44Logo.png': 44,
  'Square71x71Logo.png': 71,
  'Square89x89Logo.png': 89,
  'Square107x107Logo.png': 107,
  'Square142x142Logo.png': 142,
  'Square150x150Logo.png': 150,
  'Square284x284Logo.png': 284,
  'Square310x310Logo.png': 310,
  'StoreLogo.png': 50,

  // iOS icons
  'ios/AppIcon-20x20@1x.png': 20,
  'ios/AppIcon-20x20@2x.png': 40,
  'ios/AppIcon-20x20@3x.png': 60,
  'ios/AppIcon-29x29@1x.png': 29,
  'ios/AppIcon-29x29@2x.png': 58,
  'ios/AppIcon-29x29@3x.png': 87,
  'ios/AppIcon-40x40@1x.png': 40,
  'ios/AppIcon-40x40@2x.png': 80,
  'ios/AppIcon-40x40@3x.png': 120,
  'ios/AppIcon-60x60@2x.png': 120,
  'ios/AppIcon-60x60@3x.png': 180,
  'ios/AppIcon-76x76@1x.png': 76,
  'ios/AppIcon-76x76@2x.png': 152,
  'ios/AppIcon-83.5x83.5@2x.png': 167,
  'ios/AppIcon-512@2x.png': 1024,

  // Android icons
  'android/mipmap-mdpi/ic_launcher.png': 48,
  'android/mipmap-mdpi/ic_launcher_foreground.png': 108,
  'android/mipmap-mdpi/ic_launcher_round.png': 48,
  'android/mipmap-hdpi/ic_launcher.png': 72,
  'android/mipmap-hdpi/ic_launcher_foreground.png': 162,
  'android/mipmap-hdpi/ic_launcher_round.png': 72,
  'android/mipmap-xhdpi/ic_launcher.png': 96,
  'android/mipmap-xhdpi/ic_launcher_foreground.png': 216,
  'android/mipmap-xhdpi/ic_launcher_round.png': 96,
  'android/mipmap-xxhdpi/ic_launcher.png': 144,
  'android/mipmap-xxhdpi/ic_launcher_foreground.png': 324,
  'android/mipmap-xxhdpi/ic_launcher_round.png': 144,
  'android/mipmap-xxxhdpi/ic_launcher.png': 192,
  'android/mipmap-xxxhdpi/ic_launcher_foreground.png': 432,
  'android/mipmap-xxxhdpi/ic_launcher_round.png': 192,
};

async function processIcon() {
  console.log('Loading source icon...');

  // Read the source image
  const sourceBuffer = fs.readFileSync(SOURCE_ICON);

  // Get image info
  const metadata = await sharp(sourceBuffer).metadata();
  console.log(`Source size: ${metadata.width}x${metadata.height}`);

  // Process the image: remove white/light background
  // The white border color is approximately #f8f6f4 (RGB: 248, 246, 244)
  // We'll make pixels close to white transparent
  const { data, info } = await sharp(sourceBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Find actual content bounds (pixels with brightness < 100 - the dark blue icon)
  // This excludes the light border pixels around the icon
  let minX = info.width, maxX = 0, minY = info.height, maxY = 0;

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];

      // Check if this is a 'content' pixel (part of the icon, not transparent background)
      // The icon has dark blue background (#1c1c61, brightness ~36) and gradient ring
      // Gradient goes from purple to cyan, brightness ranges from ~80 to ~220
      // Use threshold < 240 to capture all icon content while excluding white/light border
      const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
      if (brightness < 240 && a > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }

  console.log(`Content bounds: (${minX},${minY}) to (${maxX},${maxY})`);
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  console.log(`Content size: ${contentWidth}x${contentHeight}`);

  // Extract the content area
  const { data: extractedData, info: extractedInfo } = await sharp(sourceBuffer)
    .extract({
      left: minX,
      top: minY,
      width: contentWidth,
      height: contentHeight
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = extractedInfo.width;
  const height = extractedInfo.height;
  const bgColor = { r: 28, g: 28, b: 97 };

  // Step 1: Mark all transparent pixels that are connected to corners (exterior)
  // Using flood fill from all 4 corners
  const isExterior = new Uint8Array(width * height);  // 0 = not exterior, 1 = exterior

  const queue = [];
  // Add corner seeds
  for (let y = 0; y < height; y++) {
    queue.push([0, y], [width - 1, y]);  // left and right edges
  }
  for (let x = 0; x < width; x++) {
    queue.push([x, 0], [x, height - 1]);  // top and bottom edges
  }

  while (queue.length > 0) {
    const [x, y] = queue.pop();
    if (x < 0 || x >= width || y < 0 || y >= height) continue;

    const pos = y * width + x;
    if (isExterior[pos]) continue;  // Already visited

    const idx = pos * 4;
    if (extractedData[idx + 3] !== 0) continue;  // Not transparent, stop

    isExterior[pos] = 1;
    queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]);
  }

  // Step 2: Process pixels
  for (let i = 0; i < extractedData.length; i += 4) {
    const pos = i / 4;
    if (extractedData[i + 3] === 0) {  // Transparent pixel
      if (isExterior[pos]) {
        // Exterior (corner) - fill with dark blue
        extractedData[i] = bgColor.r;
        extractedData[i + 1] = bgColor.g;
        extractedData[i + 2] = bgColor.b;
        extractedData[i + 3] = 255;
      } else {
        // Interior (hole in </> symbol) - make opaque white
        extractedData[i + 3] = 255;
      }
    }
  }

  // Convert to PNG
  const processedBuffer = await sharp(extractedData, {
    raw: {
      width: width,
      height: height,
      channels: 4
    }
  }).png().toBuffer();

  console.log('Generating icons...');

  // Generate all sizes
  for (const [filename, size] of Object.entries(ICON_SIZES)) {
    const outputPath = path.join(ICONS_DIR, filename);

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    await sharp(processedBuffer)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toFile(outputPath);

    console.log(`  Generated: ${filename} (${size}x${size})`);
  }

  // Generate ICO file for Windows
  console.log('Generating ICO file...');
  // ICO needs multiple sizes bundled
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoBuffers = await Promise.all(
    icoSizes.map(size =>
      sharp(processedBuffer)
        .resize(size, size)
        .png()
        .toBuffer()
    )
  );

  // For ICO, we'll just use the 256x256 as the main icon
  // (proper ICO bundling requires additional tools)
  await sharp(processedBuffer)
    .resize(256, 256)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon.ico.png'));
  console.log('  Note: ICO file needs manual conversion or use tauri icon command');

  // Generate ICNS for macOS
  console.log('Generating ICNS placeholder...');
  await sharp(processedBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(ICONS_DIR, 'icon.icns.png'));
  console.log('  Note: ICNS file needs manual conversion or use tauri icon command');

  // Also update the app-icon.svg reference image
  const appIconPath = path.join(ROOT, 'apps/desktop/app-icon.svg');
  if (fs.existsSync(appIconPath)) {
    // Save a high-res PNG version
    await sharp(processedBuffer)
      .resize(512, 512)
      .png()
      .toFile(path.join(ROOT, 'apps/desktop/app-icon.png'));
    console.log('  Generated: app-icon.png');
  }

  console.log('\nDone! Icons regenerated with transparent background.');
  console.log('\nTo complete ICO/ICNS generation, run:');
  console.log('  cd apps/desktop && pnpm tauri icon');
}

processIcon().catch(console.error);
