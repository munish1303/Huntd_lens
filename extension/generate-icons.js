import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from 'canvas';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.join(__dirname, 'icons');
const sizes = [16, 48, 128];

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const context = canvas.getContext('2d');
  const radius = Math.max(3, Math.round(size * 0.18));

  context.clearRect(0, 0, size, size);
  context.fillStyle = '#2563EB';
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(size - radius, 0);
  context.quadraticCurveTo(size, 0, size, radius);
  context.lineTo(size, size - radius);
  context.quadraticCurveTo(size, size, size - radius, size);
  context.lineTo(radius, size);
  context.quadraticCurveTo(0, size, 0, size - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
  context.fill();

  context.fillStyle = '#FFFFFF';
  context.font = `bold ${Math.round(size * 0.52)}px Arial`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('H', size / 2, size / 2 + size * 0.02);

  return canvas.toBuffer('image/png');
}

await fs.mkdir(outputDir, { recursive: true });

for (const size of sizes) {
  await fs.writeFile(path.join(outputDir, `icon${size}.png`), drawIcon(size));
}

console.log('Generated Huntd Lens icons.');
