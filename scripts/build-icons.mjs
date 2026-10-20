// Renders the noclue icon set and Chrome Web Store artwork from the brand geometry
// (docs/brand/HANDOFF.md). Run with `npm run icons`; the PNGs are committed.
import { Resvg } from '@resvg/resvg-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import wawoff2 from 'wawoff2';

const root = resolve(import.meta.dirname, '..');
// The renderer reads TrueType only; decompress the bundled WOFF2 files to a temp folder.
const fonts = [];
for (const name of ['anta-latin-400-normal', 'manrope-latin-wght-normal']) {
  const ttf = await wawoff2.decompress(
    await readFile(resolve(root, `apps/extension/public/fonts/${name}.woff2`)),
  );
  const path = join(tmpdir(), `noclue-${name}.ttf`);
  await writeFile(path, ttf);
  fonts.push(path);
}
const ORANGE = ['#FF7A3C', '#F35216'];
const INK = '#171717';
const PAPER = '#F5F4F0';

/** Small-size stroke compensation from the manual: 64→14/8, 32→15/8.5, 16→16/9. */
function strokeFor(size) {
  if (size <= 16) return { stroke: 16, dot: 9 };
  if (size <= 32) return { stroke: 15, dot: 8.5 };
  if (size <= 64) return { stroke: 14, dot: 8 };
  return { stroke: 13, dot: 7.5 };
}
/** The question-mark glyph in its 100×100 box. */
function glyph(color, size) {
  const { stroke, dot } = strokeFor(size);
  return `<path d="M30 34 A20 20 0 1 1 58 52 Q50 57 50 66 L50 70" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/><circle cx="50" cy="88" r="${dot}" fill="${color}"/>`;
}
/** Icon tile: radius 25 % of the side, glyph ~62 % of the tile, optically centred. */
function tile(size, variant = 'primary', x = 0, y = 0) {
  const scale = (size * 0.62) / 100;
  const offset = (size - size * 0.62) / 2;
  const fill = variant === 'dark' ? INK : 'url(#nc-gradient)';
  const mark = variant === 'dark' ? ORANGE[1] : '#FFFFFF';
  return `<g transform="translate(${x} ${y})"><rect width="${size}" height="${size}" rx="${size / 4}" fill="${fill}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${glyph(mark, size)}</g></g>`;
}
const defs = `<defs><linearGradient id="nc-gradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ORANGE[0]}"/><stop offset="1" stop-color="${ORANGE[1]}"/></linearGradient></defs>`;
const svg = (w, h, body, background) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${background ? `<rect width="${w}" height="${h}" fill="${background}"/>` : ''}${body}</svg>`;

/** Horizontal lockup scaled from the 96 px reference: gap 22, wordmark 52, subtitle 20. */
function lockup(icon, x, y, onDark = true, subtitle = true) {
  const k = icon / 96;
  const textX = x + icon + 22 * k;
  const name = 52 * k;
  const sub = 20 * k;
  const nameY = subtitle ? y + icon / 2 + name * 0.18 : y + icon / 2 + name * 0.36;
  const subY = nameY + 4 * k + sub * 1.05;
  return `${tile(icon, 'primary', x, y)}<text x="${textX}" y="${nameY}" font-family="Anta" font-size="${name}" letter-spacing="${-0.02 * name}" fill="${onDark ? PAPER : '#1A1614'}">noclue</text>${
    subtitle
      ? `<text x="${textX}" y="${subY}" font-family="Anta" font-size="${sub}" letter-spacing="${0.02 * sub}"><tspan fill="${onDark ? '#B8B1AB' : '#7A726D'}">by </tspan><tspan fill="${onDark ? '#FF7A3C' : ORANGE[1]}">ignition</tspan></text>`
      : ''
  }`;
}
function render(markup, width) {
  return new Resvg(markup, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Manrope' },
  })
    .render()
    .asPng();
}
async function out(path, markup, width) {
  const file = resolve(root, path);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, render(markup, width));
  console.log('wrote', path);
}

for (const size of [16, 32, 48, 128]) {
  await out(`apps/extension/public/icons/icon-${size}.png`, svg(size, size, tile(size)), size);
  await out(
    `apps/extension/public/icons/icon-dark-${size}.png`,
    svg(size, size, tile(size, 'dark')),
    size,
  );
}
// Chrome Web Store: 128 icon (96 px artwork + 16 px transparent padding), promo tiles.
await out('store/icon-128.png', svg(128, 128, tile(96, 'primary', 16, 16)), 128);
// Clear space ≥ ¼ of icon height on all sides; only the anthracite background is allowed.
await out('store/promo-small-440x280.png', svg(440, 280, lockup(84, 101, 98), INK), 440);
await out('store/promo-marquee-1400x560.png', svg(1400, 560, lockup(200, 418, 180), INK), 1400);
await out('docs/brand/lockup-dark.png', svg(640, 240, lockup(96, 184, 72), INK), 1280);
await out('docs/brand/lockup-light.png', svg(640, 240, lockup(96, 184, 72, false), PAPER), 1280);
