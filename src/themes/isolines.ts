/**
 * Isoline Generator
 *
 * Combines noise generation and marching squares to create
 * topographic-style contour backgrounds for garden pages.
 * Each DID produces a unique, deterministic pattern.
 */

import { createSeededNoise2D, generateNoiseGrid } from './noise.js';
import { extractContours, generateThresholds, type ContourPath } from './marching-squares.js';

export interface IsolineConfig {
  noiseScale: number;      // 0.015-0.04 (lower = larger features)
  noiseOctaves: number;    // 1-3
  contourCount: number;    // 3-8 levels
  strokeWidth: number;     // 1-2px
  strokeColor: string;     // From theme (text color with low alpha)
  fillColor: string;       // From theme (background color for gradient fills)
  fillEnabled: boolean;    // Whether to add subtle fills between contours
  fillOpacity: number;     // Base fill opacity
  thresholdMin: number;    // Where contours start (0.2-0.5) - higher = more white
  thresholdMax: number;    // Where contours end (0.6-0.85)
}

export interface ThemeColors {
  background?: string;
  text?: string;
  primary?: string;
  accent?: string;
  muted?: string;
  border?: string;
}

// Configuration options
const NOISE_SCALES = [0.025, 0.03, 0.035, 0.04, 0.045, 0.05];
const NOISE_OCTAVES = [1, 2, 3];
const CONTOUR_COUNTS = [6, 7, 8, 9, 10, 11];
const STROKE_WIDTHS = [1.5, 2];

/**
 * Simple hash function to convert a string to a number
 */
function stringToHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Parse hex color to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Generate isoline configuration from a DID
 * Uses different bit ranges of the hash for each parameter
 */
export function generateIsolineConfigFromDid(did: string, colors: ThemeColors): IsolineConfig {
  const hash = stringToHash(did);

  // Extract parameters from different bit ranges
  const noiseScaleIndex = (hash >> 15) % NOISE_SCALES.length;
  const noiseOctavesIndex = (hash >> 18) % NOISE_OCTAVES.length;
  const contourCountIndex = (hash >> 20) % CONTOUR_COUNTS.length;
  const strokeWidthIndex = (hash >> 23) % STROKE_WIDTHS.length;

  // Threshold variability - controls white vs color balance
  // thresholdMin: 0.2 to 0.5 (higher = more white areas)
  // thresholdMax: 0.6 to 0.85
  const thresholdMinIndex = (hash >> 26) % 4; // 0-3
  const thresholdMaxIndex = (hash >> 28) % 3; // 0-2
  const thresholdMin = 0.2 + (thresholdMinIndex * 0.1); // 0.2, 0.3, 0.4, 0.5
  const thresholdMax = 0.6 + (thresholdMaxIndex * 0.125); // 0.6, 0.725, 0.85

  // Derive stroke color from theme text color with low alpha
  const textColor = colors.text || '#000000';
  const textRgb = hexToRgb(textColor);
  const strokeColor = textRgb
    ? `rgba(${textRgb.r}, ${textRgb.g}, ${textRgb.b}, 0.22)`
    : 'rgba(0, 0, 0, 0.22)';

  // Use background color for fills (white base → background color gradient)
  const bgColor = colors.background || '#ffffff';
  const fillColor = bgColor;

  return {
    noiseScale: NOISE_SCALES[noiseScaleIndex],
    noiseOctaves: NOISE_OCTAVES[noiseOctavesIndex],
    contourCount: CONTOUR_COUNTS[contourCountIndex],
    strokeWidth: STROKE_WIDTHS[strokeWidthIndex],
    strokeColor,
    fillColor,
    fillEnabled: true, // Always enable fills for color differentiation
    fillOpacity: 0.2,
    thresholdMin,
    thresholdMax
  };
}

/**
 * Generate SVG string for isoline pattern
 *
 * @param config - Isoline configuration
 * @param width - SVG width
 * @param height - SVG height
 * @param seed - Numeric seed for noise generation
 * @returns SVG string
 */
export function generateIsolineSVG(
  config: IsolineConfig,
  width: number,
  height: number,
  seed: number
): string {
  // Grid resolution - finer grid for denser, smoother isolines (~14px per cell), clamped for performance
  const maxDimension = Math.max(width, height);
  // Calculate grid size for the largest dimension, clamped between 60 and 100
  const maxGridSize = Math.max(60, Math.min(100, Math.floor(maxDimension / 14)));

  // Calculate grid dimensions maintaining aspect ratio
  // Ensure at least 2 cells to avoid errors
  const gridWidth = Math.max(2, Math.floor(maxGridSize * (width / maxDimension)));
  const gridHeight = Math.max(2, Math.floor(maxGridSize * (height / maxDimension)));

  // Generate noise grid
  const noise = createSeededNoise2D(seed);
  const grid = generateNoiseGrid(
    noise,
    gridWidth,
    gridHeight,
    config.noiseScale,
    config.noiseOctaves,
    0.5 // persistence
  );

  // Generate contour thresholds with DID-based variability
  const thresholds = generateThresholds(config.contourCount, config.thresholdMin, config.thresholdMax);

  // Extract contours
  const contours = extractContours(grid, thresholds, width, height);

  // Build SVG
  const paths = buildSVGPaths(contours, config);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
  <defs>
    <style>
      .isoline { fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .isoline-fill { stroke: none; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${paths}
</svg>`;
}

/**
 * Build SVG path elements from contours
 */
function buildSVGPaths(contours: ContourPath[], config: IsolineConfig): string {
  const paths: string[] = [];

  // Parse fill color (background color) to RGB for opacity variation
  const fillRgb = hexToRgb(config.fillColor);

  // Add filled regions if enabled - gradient from white to background color
  // Only fill closed contours; open ones (hitting grid edge) would be implicitly
  // closed by a straight line, causing visible "non-curvy" artifacts
  if (config.fillEnabled && contours.length > 1 && fillRgb) {
    for (let i = 0; i < contours.length; i++) {
      const contour = contours[i];
      const fillD = contour.dClosed;
      if (!fillD) continue;

      const opacity = config.fillOpacity + (contour.threshold * 0.5);
      const fill = `rgba(${fillRgb.r}, ${fillRgb.g}, ${fillRgb.b}, ${opacity.toFixed(3)})`;

      paths.push(
        `  <path class="isoline-fill" d="${fillD}" fill="${fill}" />`
      );
    }
  }

  // Add contour lines
  for (const contour of contours) {
    paths.push(
      `  <path class="isoline" d="${contour.d}" stroke="${config.strokeColor}" stroke-width="${config.strokeWidth}" />`
    );
  }

  return paths.join('\n');
}

/**
 * Generate data URI for isoline pattern
 * Suitable for use as CSS background-image
 *
 * @param config - Isoline configuration
 * @param width - Pattern tile width
 * @param height - Pattern tile height
 * @param seed - Numeric seed for noise generation
 * @returns Data URI string
 */
export function generateIsolineDataURI(
  config: IsolineConfig,
  width: number,
  height: number,
  seed: number
): string {
  const svg = generateIsolineSVG(config, width, height, seed);
  // Encode for data URI
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * Cache for generated isoline data URIs
 * Key: DID string
 * Value: { dataUri, config }
 */
const isolineCache = new Map<string, { dataUri: string; config: IsolineConfig }>();

/**
 * Get raw SVG string for isoline pattern (for Blob URL; avoids Chrome data-URI size limit).
 */
export function getIsolineSVGStringForDid(
  did: string,
  colors: ThemeColors,
  width: number,
  height: number
): string {
  const config = generateIsolineConfigFromDid(did, colors);
  const seed = stringToHash(did);
  return generateIsolineSVG(config, width, height, seed);
}

/**
 * Get or generate isoline data URI for a DID
 * Uses caching to avoid regeneration
 *
 * @param did - DID string
 * @param colors - Theme colors
 * @param width - SVG width (default 1920 for full viewport coverage)
 * @param height - SVG height (default 1080 for full viewport coverage)
 * @returns Object with dataUri and config
 */
export function getIsolineForDid(
  did: string,
  colors: ThemeColors,
  width: number = 1920,
  height: number = 1080
): { dataUri: string; config: IsolineConfig } {
  // Cache key includes dimensions to regenerate on viewport change
  const cacheKey = `${did}:${width}x${height}`;

  // Check cache
  const cached = isolineCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Generate config and pattern
  const config = generateIsolineConfigFromDid(did, colors);
  const seed = stringToHash(did);
  const dataUri = generateIsolineDataURI(config, width, height, seed);

  // Cache result
  const result = { dataUri, config };
  isolineCache.set(cacheKey, result);

  return result;
}

/**
 * Clear the isoline cache
 * Call when theme colors change significantly
 */
export function clearIsolineCache(): void {
  isolineCache.clear();
}
