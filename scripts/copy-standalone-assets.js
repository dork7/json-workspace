/**
 * After `next build` with `output: 'standalone'`, copy traced static assets
 * into `.next/standalone` so the production server can serve them.
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');
const staticSrc = path.join(root, '.next', 'static');
const staticDest = path.join(standalone, '.next', 'static');
const publicSrc = path.join(root, 'public');
const publicDest = path.join(standalone, 'public');

if (!fs.existsSync(standalone)) {
  console.warn(
    '[copy-standalone-assets] .next/standalone missing — run `next build` first.'
  );
  process.exit(0);
}

if (fs.existsSync(staticSrc)) {
  fs.mkdirSync(path.dirname(staticDest), { recursive: true });
  fs.cpSync(staticSrc, staticDest, { recursive: true });
  console.log('[copy-standalone-assets] Copied .next/static → standalone');
} else {
  console.warn('[copy-standalone-assets] .next/static not found (optional)');
}

if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true });
  console.log('[copy-standalone-assets] Copied public → standalone');
}
