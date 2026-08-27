/**
 * The home-screen icons, rendered from `app/icon.svg`.
 *
 * The SVG is the source and these are generated, for the same reason the HTML
 * artifacts are generated from Markdown: two hand-drawn owls drift, and the one
 * on somebody's phone is the one nobody looks at again.
 *
 * Two shapes, because Android and iOS want different things:
 *
 *   - `any` keeps the rounded square the SVG draws. It is used as-is.
 *   - `maskable` is full-bleed. The platform crops it to whatever shape the
 *     launcher uses - circle, squircle, teardrop - so a rounded square drawn
 *     inside it gets its corners cut off and reads as a sticker on a tile. This
 *     one fills the frame with the brand colour and keeps the owl inside the
 *     safe zone, which the spec puts at the middle 80% (a circle of radius 40%).
 *
 * Run with `npm run icons`.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'app', 'icon.svg'), 'utf8');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

/** The brand teal, read off the source rather than repeated by hand. */
const brand = source.match(/fill="(#[0-9a-fA-F]{6})"/)?.[1] ?? '#17707f';

/** The owl alone: the source with its rounded background rectangle removed. */
const owlOnly = source.replace(/<rect[^>]*\/>/, '');

/**
 * Full-bleed variant. The owl is scaled to 66% and centred, which keeps every
 * part of it inside the 80% safe circle with room to spare - an ear tuft
 * clipped by a round launcher mask is exactly the failure this avoids.
 */
const maskable = owlOnly.replace(
  '<g transform="translate(2.4 2.4) scale(0.8)">',
  `<rect width="24" height="24" fill="${brand}" /><g transform="translate(4.1 4.1) scale(0.66)">`,
);

async function render(svg, size, name) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(join(outDir, name));
  console.log(`${name} ${size}x${size}`);
}

await render(source, 192, 'icon-192.png');
await render(source, 512, 'icon-512.png');
await render(maskable, 512, 'icon-maskable-512.png');
