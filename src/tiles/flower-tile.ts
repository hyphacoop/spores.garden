/**
 * Generates a self-contained HTML tile that renders a user's unique flower.
 * The flower SVG and theme colors are baked into the HTML at publish time.
 */

import { generateFlowerSVGString } from '../utils/flower-svg';
import { generateThemeFromDid } from '../themes/engine';

export function generateFlowerTileHTML(did: string): string {
  const flowerSVG = generateFlowerSVGString(did, 200);
  const { theme } = generateThemeFromDid(did);
  const { colors } = theme;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>flower</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: 100%; height: 100%; overflow: hidden;
  background: ${colors.background};
  color: ${colors.text};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
}
.tile {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 12px;
}
.flower svg { display: block; }
.brand {
  font-size: 13px; font-weight: 500;
  opacity: 0.6; letter-spacing: -0.2px;
}
.brand a {
  color: ${colors.primary};
  text-decoration: none;
}
</style>
</head>
<body>
<div class="tile">
  <div class="flower">${flowerSVG}</div>
  <div class="brand"><a href="https://spores.garden/${encodeURIComponent(did)}" target="_blank" rel="noopener">spores.garden</a></div>
</div>
</body>
</html>`;
}
