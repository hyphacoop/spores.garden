import chroma from 'chroma-js';
import { getDefaultFontPairing } from './fonts.js';
import { generateColorsFromDid } from './colors.js';
import { generateIsolineConfigFromDid, getIsolineSVGStringForDid, clearIsolineCache, type IsolineConfig } from './isolines.js';

/** Current pattern Blob URLs for double buffering */
let currentPatternUrls: [string | null, string | null] = [null, null];
/** Which buffer is currently visible (0 or 1) */
let activeBufferIndex = 0;

/** Stored so we can avoid redundant theme applications and regenerate on resize */
let lastAppliedDid: string | null = null;
let lastAppliedThemeConfig: any = null;
let lastPatternDid: string | null = null;
let lastPatternColors: Record<string, string> | null = null;

/** Browser viewport size (innerWidth/innerHeight = what the user sees) 
 * Quantized to nearest 256px to avoid constant regeneration during resize.
 */
function getViewportPatternSize(): { w: number; h: number } {
  const step = 256;
  const w = Math.ceil(Math.max(window.innerWidth, 320) / step) * step;
  const h = Math.ceil(Math.max(window.innerHeight, 320) / step) * step;
  return { w, h };
}

/** Track viewport size to avoid redundant regenerations */
let lastW = 0;
let lastH = 0;

async function applyPatternAtViewportSize(): Promise<void> {
  if (!lastPatternDid || !lastPatternColors) return;
  const { w, h } = getViewportPatternSize();
  
  // Skip if quantized size hasn't changed
  if (w === lastW && h === lastH) return;
  lastW = w;
  lastH = h;

  const svgString = getIsolineSVGStringForDid(lastPatternDid, lastPatternColors, w, h);
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const newUrl = URL.createObjectURL(blob);
  
  // Pre-warm in browser image cache and force decode before swapping CSS var
  await new Promise<void>(resolve => {
    const img = new Image();
    img.onload = () => {
      if ('decode' in img) {
        (img as any).decode().then(() => resolve()).catch(() => resolve());
      } else {
        resolve();
      }
    };
    img.onerror = () => resolve();
    img.src = newUrl;
  });
  
  const root = document.documentElement;
  const inactiveIndex = 1 - activeBufferIndex;
  const oldUrl = currentPatternUrls[inactiveIndex];
  
  currentPatternUrls[inactiveIndex] = newUrl;
  root.style.setProperty(`--pattern-bg-${inactiveIndex + 1}`, `url("${newUrl}")`);
  root.style.setProperty('--pattern-width', `${w}px`);
  root.style.setProperty('--pattern-height', `${h}px`);
  
  // Crossfade
  activeBufferIndex = inactiveIndex;
  if (activeBufferIndex === 1) {
    root.classList.add('pattern-buffer-swap');
  } else {
    root.classList.remove('pattern-buffer-swap');
  }
  
  // Wait for fade transition (400ms in CSS) before revoking old blob
  setTimeout(() => {
    if (oldUrl) URL.revokeObjectURL(oldUrl);
  }, 500);
}

let resizeDebounceId: ReturnType<typeof setTimeout> | null = null;
function onResize(): void {
  const { w, h } = getViewportPatternSize();
  if (w === lastW && h === lastH) return;

  document.documentElement.classList.add('resizing');
  if (resizeDebounceId) clearTimeout(resizeDebounceId);
  resizeDebounceId = setTimeout(async () => {
    resizeDebounceId = null;
    await applyPatternAtViewportSize();
    document.documentElement.classList.remove('resizing');
  }, 400);
}

let resizeListenerAdded = false;
function ensureResizeListener(): void {
  if (resizeListenerAdded) return;
  resizeListenerAdded = true;
  window.addEventListener('resize', onResize);
}

/**
 * Theme Engine
 *
 * Handles applying themes to the site.
 * Uses CSS custom properties for easy runtime theming.
 */

const BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'groove'];
const BORDER_WIDTHS = ['1px', '2px', '3px', '4px'];
const SHADOW_OFFSETS = [0, 2, 4, 6, 8, 10, 12];
const SHADOW_BLURS = [0, 4, 8, 12, 16, 20, 28];
const SHADOW_SPREADS = [0, 0, 1, 2, 3];
const SHADOW_OPACITIES = [0, 0.06, 0.1, 0.14, 0.18, 0.22];
const SHADOW_TYPES: Array<'normal' | 'inset'> = ['normal', 'normal', 'normal', 'inset'];

const LAST_THEME_STORAGE_KEY = 'spores.lastTheme';

/**
 * Simple hash function to convert a string to a number
 * Used for generating deterministic values from DID
 */
function stringToHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Generates a theme from a DID string
 */
export function generateThemeFromDid(did: string) {
  const hash = stringToHash(did);
  const hue = hash % 360;

  // Generate colors using the dedicated color generation module
  const colors = generateColorsFromDid(did);

  // Generate shadow
  const shadowOffsetIndex = hash % SHADOW_OFFSETS.length;
  const shadowBlurIndex = (hash >> 3) % SHADOW_BLURS.length;
  const shadowSpreadIndex = (hash >> 6) % SHADOW_SPREADS.length;
  const shadowOpacityIndex = (hash >> 9) % SHADOW_OPACITIES.length;
  const shadowTypeIndex = (hash >> 12) % SHADOW_TYPES.length;
  const shadowColorBase = colors.accent || colors.primary || colors.text || '#000000';
  
  const shadow = {
    type: SHADOW_TYPES[shadowTypeIndex],
    x: `${SHADOW_OFFSETS[shadowOffsetIndex]}px`,
    y: `${SHADOW_OFFSETS[shadowOffsetIndex]}px`,
    blur: `${SHADOW_BLURS[shadowBlurIndex]}px`,
    spread: `${SHADOW_SPREADS[shadowSpreadIndex]}px`,
    color: chroma(shadowColorBase).alpha(SHADOW_OPACITIES[shadowOpacityIndex]).css()
  };

  // Generate isoline configuration
  const isolines = generateIsolineConfigFromDid(did, colors);

  return {
    theme: {
      colors,
      fonts: getDefaultFontPairing(),
      borderStyle: BORDER_STYLES[hash % BORDER_STYLES.length],
      borderWidth: BORDER_WIDTHS[hash % BORDER_WIDTHS.length],
      shadow,
      isolines
    },
    metadata: {
      hash,
      hue,
      borderStyleIndex: hash % BORDER_STYLES.length,
      borderWidthIndex: hash % BORDER_WIDTHS.length,
      shadowOffsetIndex,
      shadowBlurIndex,
      shadowSpreadIndex,
      shadowOpacityIndex,
      shadowTypeIndex
    }
  };
}


/**
 * Extract font family name from CSS font string
 * e.g., "'Bungee', sans-serif" -> "Bungee"
 * e.g., "'Press Start 2P', monospace" -> "Press Start 2P"
 * Returns null for system fonts
 */
function extractFontName(fontString: string): string | null {
  if (!fontString) return null;
  
  // Match quoted font names (single or double quotes)
  const match = fontString.match(/['"]([^'"]+)['"]/);
  if (!match) return null;
  
  const fontName = match[1];
  
  // Skip system fonts
  const systemFonts = ['system-ui', 'apple-system', 'Georgia', 'Courier New', 'JetBrains Mono', 'Work Sans'];
  if (systemFonts.some(sys => fontName.includes(sys))) {
    return null;
  }
  
  return fontName;
}

/**
 * Build Google Fonts URL for specific fonts
 */
function buildGoogleFontsUrl(fontNames: string[]): string {
  if (fontNames.length === 0) return '';
  
  // Filter out Inter (already loaded statically) and system fonts
  const fontsToLoad = fontNames.filter(name => name && name !== 'Inter');
  
  if (fontsToLoad.length === 0) return '';
  
  // Build URL with font families
  // Most fonts use weight 400, some need specific weights
  const fontSpecs = fontsToLoad.map(name => {
    // Handle fonts that need specific weights
    const weightMap: Record<string, string> = {
      'Inter': 'wght@400;500;600;700;800',
      'Orbitron': 'wght@400;700;900',
      'Passion One': 'wght@400;700;900',
      'Sniglet': 'wght@400;800',
      'Stardos Stencil': 'wght@400;700',
      'Trochut': 'wght@400;700',
      'Amatic SC': 'wght@400;700',
      'Caveat': 'wght@400;700',
      'Dancing Script': 'wght@400;700',
      'Shadows Into Light': 'wght@400',
      'Zilla Slab Highlight': 'wght@400;700',
      'Kalam': 'wght@300;400;700',
      'Flamenco': 'wght@300;400',
      'Cinzel Decorative': 'wght@400',
      'Syncopate': 'wght@400;700',
    };
    
    const weight = weightMap[name] || 'wght@400';
    return `family=${encodeURIComponent(name)}:${weight}`;
  });
  
  return `https://fonts.googleapis.com/css2?${fontSpecs.join('&')}&display=swap`;
}

// Track loaded fonts to avoid duplicates
const loadedFonts = new Set<string>();

/**
 * Dynamically load Google Fonts
 */
function loadGoogleFonts(fontNames: string[]): Promise<void> {
  return new Promise((resolve) => {
    const url = buildGoogleFontsUrl(fontNames);
    if (!url) {
      resolve();
      return;
    }
    
    // Check if we already loaded these fonts
    const allLoaded = fontNames.every(name => !name || name === 'Inter' || loadedFonts.has(name));
    if (allLoaded) {
      resolve();
      return;
    }
    
    // Mark fonts as loading
    fontNames.forEach(name => {
      if (name && name !== 'Inter') {
        loadedFonts.add(name);
      }
    });
    
    // Create and inject link tag
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.onload = () => resolve();
    link.onerror = () => resolve(); // Resolve anyway to not block rendering
    document.head.appendChild(link);
  });
}

/**
 * Restore the last applied theme colors to the document so the loading screen
 * shows the previous garden's colors instead of white when navigating.
 * 
 * Note: This is primarily called via inline script in index.html for earliest execution.
 * Kept as exported function for potential programmatic use or fallback scenarios.
 */
export function restorePreviousTheme(): void {
  try {
    const raw = sessionStorage.getItem(LAST_THEME_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as Record<string, string>;
    const root = document.documentElement;
    if (saved.background) root.style.setProperty('--color-background', saved.background);
    if (saved.text) root.style.setProperty('--color-text', saved.text);
    if (saved.muted) root.style.setProperty('--color-text-muted', saved.muted);
  } catch {
    // Ignore parse errors or missing storage
  }
}

/**
 * Apply a theme to the document
 * Returns a promise that resolves when the theme is fully applied and fonts are loaded
 */
export function applyTheme(
  themeConfig: any = {},
  options?: { waitForFonts?: boolean; did?: string }
): Promise<void> {
  return new Promise(async (resolve) => {
    const waitForFonts = options?.waitForFonts !== false;
    const did = options?.did;

    // Skip redundant applications if nothing has changed
    const currentThemeHash = JSON.stringify(themeConfig);
    if (did === lastAppliedDid && currentThemeHash === lastAppliedThemeConfig) {
      resolve();
      return;
    }
    lastAppliedDid = did;
    lastAppliedThemeConfig = currentThemeHash;

    const colors = themeConfig.colors || {};
    const fonts = { ...getDefaultFontPairing(), ...themeConfig.fonts };
    const borderStyle = themeConfig.borderStyle || 'solid';
    const borderWidth = themeConfig.borderWidth || '2px';
    const shadow = themeConfig.shadow || {};
    // Isolines: apply when DID is present unless theme explicitly disables (default on for garden pages)
    const isolines = themeConfig.hasOwnProperty('isolines') ? themeConfig.isolines : true;

    // Extract font names that need to be loaded
    const fontNamesToLoad: string[] = [];
    Object.values(fonts).forEach((fontString) => {
      const fontName = extractFontName(fontString as string);
      if (fontName) {
        fontNamesToLoad.push(fontName);
      }
    });

    // Load fonts dynamically. For navigation we can avoid blocking on font load
    // to keep route changes snappy; fonts will swap in when ready.
    if (waitForFonts) {
      await loadGoogleFonts(fontNamesToLoad);
    } else {
      void loadGoogleFonts(fontNamesToLoad);
    }

    // Apply CSS custom properties
    const root = document.documentElement;

    // Helper to extract RGB values from hex color
    const hexToRgb = (hex: string): string | null => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result
        ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
        : null;
    };

    // Colors
    // If colors are provided, apply them. If not (homepage), remove the overrides to return to CSS defaults.
    if (Object.keys(colors).length > 0) {
      Object.entries(colors).forEach(([key, value]) => {
        if (value) {
          root.style.setProperty(`--color-${key}`, value as string);
          const rgb = hexToRgb(value as string);
          if (rgb) root.style.setProperty(`--color-${key}-rgb`, rgb);
        }
      });
      // Set border-dark to be inverted for dark mode (use text color for borders in dark mode)
      const borderDark = colors.text || '#000000';
      root.style.setProperty('--color-border-dark', borderDark);

      // Persist theme colors for next page load
      try {
        sessionStorage.setItem(LAST_THEME_STORAGE_KEY, JSON.stringify({
          background: colors.background,
          text: colors.text,
          muted: colors.muted
        }));
      } catch {}
    } else {
      // No theme (homepage) - clear theme-specific properties so base.css :root takes over
      const propsToClear = ['background', 'text', 'text-muted', 'primary', 'accent', 'border', 'border-muted', 'border-dark', 'surface'];
      propsToClear.forEach(p => {
        root.style.removeProperty(`--color-${p}`);
        root.style.removeProperty(`--color-${p}-rgb`);
      });
    }

    // Fonts
    Object.entries(fonts).forEach(([key, value]) => {
      if (value) {
        root.style.setProperty(`--font-${key}`, value as string);
      } else {
        root.style.removeProperty(`--font-${key}`);
      }
    });

    // Border style
    root.style.setProperty('--border-style', borderStyle);
    root.style.setProperty('--border-width', borderWidth);

    // Drop shadows
    const shadowProps = ['type', 'x', 'y', 'blur', 'spread', 'color'];
    shadowProps.forEach(p => {
      if (shadow[p]) root.style.setProperty(`--shadow-${p}`, String(shadow[p]));
      else root.style.removeProperty(`--shadow-${p}`);
    });

    // Apply isoline background pattern (static image, not motion)
    // Use Blob URL so Chrome doesn't hit data-URI size limit (~2MB).
    // Size SVG to layout viewport (clientWidth/clientHeight) so pattern matches screen.
    const patternDid = did || 'did:web:spores.garden';
    const patternColors = did ? colors : { background: '#ffffff', text: '#000000' };

    if (isolines !== false) {
      // Skip pattern regeneration if it's the same parameters and same dimensions
      const { w, h } = getViewportPatternSize();
      const isSamePattern = patternDid === lastPatternDid && 
                           JSON.stringify(patternColors) === JSON.stringify(lastPatternColors) &&
                           w === lastW && h === lastH;
      
      if (!isSamePattern) {
        lastPatternDid = patternDid;
        lastPatternColors = patternColors as Record<string, string>;
        lastW = w;
        lastH = h;
        
        const svgString = getIsolineSVGStringForDid(patternDid, lastPatternColors, w, h);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const newUrl = URL.createObjectURL(blob);
        
        // Pre-warm in browser image cache and force decode before swapping CSS var
        await new Promise<void>(resolve => {
          const img = new Image();
          img.onload = () => {
            if ('decode' in img) {
              (img as any).decode().then(() => resolve()).catch(() => resolve());
            } else {
              resolve();
            }
          };
          img.onerror = () => resolve();
          img.src = newUrl;
        });
        
        const inactiveIndex = 1 - activeBufferIndex;
        const oldUrl = currentPatternUrls[inactiveIndex];
        
        currentPatternUrls[inactiveIndex] = newUrl;
        root.style.setProperty(`--pattern-bg-${inactiveIndex + 1}`, `url("${newUrl}")`);
        root.style.setProperty('--pattern-width', `${w}px`);
        root.style.setProperty('--pattern-height', `${h}px`);
        
        // Crossfade
        activeBufferIndex = inactiveIndex;
        if (activeBufferIndex === 1) {
          root.classList.add('pattern-buffer-swap');
        } else {
          root.classList.remove('pattern-buffer-swap');
        }
        
        // Wait for fade transition (400ms in CSS) before revoking old blob
        setTimeout(() => {
          if (oldUrl) URL.revokeObjectURL(oldUrl);
        }, 500);
        
        root.classList.add('has-pattern');
        ensureResizeListener();
      }
    } else {
      const oldUrl1 = currentPatternUrls[0];
      const oldUrl2 = currentPatternUrls[1];
      currentPatternUrls = [null, null];
      lastPatternDid = null;
      lastPatternColors = null;
      lastW = 0;
      lastH = 0;
      
      if (oldUrl1 || oldUrl2) {
        root.style.setProperty('--pattern-bg-1', 'none');
        root.style.setProperty('--pattern-bg-2', 'none');
        root.style.removeProperty('--pattern-width');
        root.style.removeProperty('--pattern-height');
        root.classList.remove('has-pattern');
        root.classList.remove('pattern-buffer-swap');
        if (oldUrl1) URL.revokeObjectURL(oldUrl1);
        if (oldUrl2) URL.revokeObjectURL(oldUrl2);
      }
    }

    // Clean up stale theme classes efficiently without wiping important state
    const themeClasses = Array.from(root.classList).filter(c => c.startsWith('theme-'));
    if (themeClasses.length > 0) {
      root.classList.remove(...themeClasses);
    }

    // Wait for fonts to load before marking theme as ready (optional).
    // This prevents text flicker when custom fonts load, but can slow navigation.
    if (waitForFonts && document.fonts && fontNamesToLoad.length > 0) {
      // Wait for specific fonts to load
      const fontPromises = fontNamesToLoad.map(fontName => {
        return document.fonts.load(`1em "${fontName}"`).catch(() => {
          // Ignore errors - font might already be loaded or might fail
        });
      });
      
      Promise.all(fontPromises).then(() => {
        // Double-check with fonts.ready for safety
        return document.fonts.ready;
      }).then(() => {
        // Mark fonts as ready
        root.classList.add('fonts-ready');
        
        // Mark theme as ready after CSS properties have been applied and painted
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            root.setAttribute('data-theme-ready', 'true');
            resolve();
          });
        });
      }).catch(() => {
        // Fallback if font loading fails - show text anyway after a short delay
        root.classList.add('fonts-ready');
        setTimeout(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              root.setAttribute('data-theme-ready', 'true');
              resolve();
            });
          });
        }, 100);
      });
    } else {
      // No custom fonts to load, Font Loading API not available, or we chose not to wait.
      root.classList.add('fonts-ready');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          root.setAttribute('data-theme-ready', 'true');
          resolve();
        });
      });
    }
  });
}

// Re-export isoline utilities for external use
export { clearIsolineCache, type IsolineConfig };
