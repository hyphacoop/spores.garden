import { getRecord, resolveHandle } from './at-client';
import { putRecord, getCurrentDid, isLoggedIn, deleteRecord } from './oauth';
import { getThemePreset, generateThemeFromDid } from './themes/engine';
import { registerGarden } from './components/recent-gardens';

const CONFIG_COLLECTION = 'garden.spores.site.config';
const SECTIONS_COLLECTION = 'garden.spores.site.sections';
const SPECIAL_SPORE_COLLECTION = 'garden.spores.item.specialSpore';
const CONFIG_RKEY = 'self';

let currentConfig = null;
let siteOwnerDid = null;

export type UrlIdentifier =
  | { type: 'did'; value: string }
  | { type: 'handle'; value: string };

/**
 * Seed-based random number generator
 * Creates a deterministic PRNG from a seed string (e.g., DID)
 */
function seededRandom(seed: string): () => number {
  // Hash the seed string to get initial state
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  let state = Math.abs(hash);

  // Linear Congruential Generator
  return function () {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

// Test DIDs that always get a spore (for development/testing)
const TEST_SPORE_DIDS = [
  'did:plc:y3lae7hmqiwyq7w2v3bcb2c2', // v's test DID
];

/**
 * Validate if a spore is authentic (should exist for the given origin DID)
 * 
 * Prevents adversarial actors from creating fake spores by verifying that
 * the origin garden should have received a spore based on deterministic generation.
 * 
 * @param originGardenDid - The DID where the spore was originally created
 * @returns true if the spore is valid (origin DID had 10% chance), false otherwise
 */
export function isValidSpore(originGardenDid: string): boolean {
  if (!originGardenDid) {
    return false;
  }

  // Test DIDs always get a spore
  if (TEST_SPORE_DIDS.includes(originGardenDid)) {
    return true;
  }

  // Use the same deterministic logic as spore creation
  const rng = seededRandom(originGardenDid);
  // 1 in 10 chance - same as in saveConfig
  return rng() < 0.1;
}

/**
 * Generate initial sections for a new user
 * Creates a fixed set of sections in a consistent order
 */
function generateInitialSections(did: string): any[] {
  const sections: any[] = [];
  let sectionId = 0;

  // 1. Profile
  sections.push({
    id: `section-${sectionId++}`,
    type: 'profile',
    collection: 'garden.spores.site.profile',
    rkey: 'self',
    layout: 'profile'
  });

  // 2. Welcome
  sections.push({
    id: `section-${sectionId++}`,
    type: 'content',
    collection: 'garden.spores.content.text',
    format: 'markdown',
    title: 'Welcome'
  });

  // 3. Collected Flowers
  sections.push({
    id: `section-${sectionId++}`,
    type: 'collected-flowers',
    layout: 'collected-flowers',
    title: 'Collected Flowers'
  });

  // 4. Share to Bluesky
  sections.push({
    id: `section-${sectionId++}`,
    type: 'share-to-bluesky',
    title: 'Share on Bluesky'
  });

  return sections;
}

/**
 * Default configuration for new sites
 */
function getDefaultConfig() {
  const defaultPreset = getThemePreset('minimal');
  return {
    title: 'spores.garden',
    subtitle: '',
    theme: {
      preset: 'minimal',
      colors: { ...defaultPreset.colors },
      fonts: { ...defaultPreset.fonts },
      borderStyle: 'solid',
      borderWidth: '2px',
    },

    sections: [],
  };
}

/**
 * Preview config when URL has a DID but no garden config record.
 * Theme is generated from DID; sections are empty so the renderer shows garden preview UI.
 */
function buildPreviewConfig(did: string) {
  const defaultConfig = getDefaultConfig();
  const { theme: generatedTheme } = generateThemeFromDid(did);
  return {
    ...defaultConfig,
    theme: {
      ...generatedTheme,
      preset: 'minimal',
    },
    sections: [],
    isGardenPreview: true,
  };
}

/**
 * Parse identifier from URL (supports both path-based and query params)
 * Supports: /@handle, /@did, /handle (legacy shorthand), ?handle=..., ?did=...
 */
export function parseIdentifierFromUrl(loc: Location = location): UrlIdentifier | null {
  const pathMatch = loc.pathname.match(/^\/@(.+)$/);
  if (pathMatch) {
    const identifier = decodeURIComponent(pathMatch[1]);
    if (identifier.startsWith('did:')) {
      return { type: 'did', value: identifier };
    } else {
      return { type: 'handle', value: identifier };
    }
  }

  // Legacy/shorthand: support `/handle` style URLs (e.g. `/alice.example.com`).
  // This prevents unknown single-segment paths from silently falling back to the
  // logged-in user's garden.
  const bareMatch = loc.pathname.match(/^\/([^/]+)$/);
  if (bareMatch) {
    const segment = decodeURIComponent(bareMatch[1]);

    // Ignore obvious static files and known metadata endpoints.
    const lower = segment.toLowerCase();
    const isStaticFile = /\.(js|css|map|png|jpg|jpeg|gif|webp|svg|ico|json|txt|xml|webmanifest)$/.test(lower);
    if (lower !== 'client-metadata.json' && !isStaticFile) {
      if (segment.startsWith('did:')) {
        return { type: 'did', value: segment };
      }
      // Only treat domain-like segments as handles to avoid catching random paths.
      if (segment.includes('.')) {
        return { type: 'handle', value: segment };
      }
    }
  }

  const params = new URLSearchParams(loc.search);
  const didParam = params.get('did');
  const handleParam = params.get('handle');

  if (didParam) {
    return { type: 'did', value: didParam };
  } else if (handleParam) {
    return { type: 'handle', value: handleParam };
  }

  return null;
}

export function hasGardenIdentifierInUrl(loc: Location = location): boolean {
  return parseIdentifierFromUrl(loc) !== null;
}

/**
 * Initialize config - determine site owner and load config
 */
export async function initConfig() {
  const identifier = parseIdentifierFromUrl();

  if (identifier) {
    if (identifier.type === 'did') {
      siteOwnerDid = identifier.value;
    } else if (identifier.type === 'handle') {
      try {
        siteOwnerDid = await resolveHandle(identifier.value);
      } catch (error) {
        console.warn('Failed to resolve handle, redirecting to homepage:', error);
        // Update URL to homepage (removes the invalid handle from URL)
        history.replaceState(null, '', '/');
        // Return homepage config with notification flag
        siteOwnerDid = null;
        currentConfig = getDefaultConfig();
        currentConfig.handleNotFound = identifier.value;
        return currentConfig;
      }
    }
  } else {
    siteOwnerDid = null;
    currentConfig = getDefaultConfig();
    return currentConfig;
  }

  const loaded = await loadUserConfig(siteOwnerDid);
  if (loaded === null) {
    // No config record: set preview config so the app can render theme + flower
    currentConfig = buildPreviewConfig(siteOwnerDid);
  }

  return currentConfig;
}

/**
 * Get current config
 */
export function getConfig() {
  return currentConfig;
}

/**
 * Get site owner DID
 */
export function getSiteOwnerDid() {
  return siteOwnerDid;
}

/**
 * Check if current user is the site owner
 */
export function isOwner() {
  if (!isLoggedIn()) return false;
  const currentDid = getCurrentDid();
  const ownerDid = getSiteOwnerDid(); // Use the getter

  if (!currentDid || !ownerDid) {
    return false;
  }
  return currentDid === ownerDid;
}

/**
 * Set site owner DID (used when user logs in to create new site)
 */
export function setSiteOwnerDid(did) {
  siteOwnerDid = did;
}

/**
 * Load config for a given user DID
 */
export async function loadUserConfig(did) {
  if (!did) {
    currentConfig = getDefaultConfig();
    return null;
  }

  try {
    const [configRecord, sectionsRecord] = await Promise.all([
      getRecord(did, CONFIG_COLLECTION, CONFIG_RKEY),
      getRecord(did, SECTIONS_COLLECTION, CONFIG_RKEY)
    ]);

    // Config record is required for onboarding check
    if (!configRecord) {
      return null;
    }

    const defaultConfig = getDefaultConfig();
    const config = configRecord.value;

    // Theme is 100% generated from DID - no PDS storage needed
    const { theme: generatedTheme } = generateThemeFromDid(did);
    const theme = { ...generatedTheme };

    // Generate initial sections from DID as the base
    let sections = generateInitialSections(did);

    // Overlay custom sections from PDS if they exist
    if (sectionsRecord) {
      const sectionsConfig = sectionsRecord.value;
      if (sectionsConfig.sections && sectionsConfig.sections.length > 0) {
        sections = sectionsConfig.sections;
      }
    }

    currentConfig = {
      ...defaultConfig,
      ...config,
      theme: {
        ...theme,
        preset: 'minimal' // Frontend-only preset for UI
      },

      sections,
    };

    siteOwnerDid = did;
    return currentConfig;
  } catch (error) {
    console.warn('Failed to load user config, using default:', error);
    currentConfig = getDefaultConfig();
    return null;
  }
}

/**
 * Check if user has an existing config record
 * Note: Style and sections are now optional (generated client-side)
 */
export async function hasUserConfig(did) {
  if (!did) {
    return false;
  }

  try {
    // Only config record is required - style and sections are optional
    const configRecord = await getRecord(did, CONFIG_COLLECTION, CONFIG_RKEY);
    return configRecord !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Update config (in memory)
 */
export function updateConfig(updates) {
  currentConfig = {
    ...currentConfig,
    ...updates,
  };
  return currentConfig;
}

/**
 * Save config to PDS
 */
export async function saveConfig({ isInitialOnboarding = false } = {}) {
  if (!isLoggedIn()) {
    throw new Error('Must be logged in to save config');
  }

  const did = getCurrentDid();
  if (did !== siteOwnerDid && siteOwnerDid !== null) {
    throw new Error('Can only save config to your own PDS');
  }

  if (!siteOwnerDid) {
    siteOwnerDid = did;
  }

  // Check if this is truly the first time creating a config
  // If isInitialOnboarding is false, verify by checking if config exists
  let isFirstTimeConfig = isInitialOnboarding;
  if (!isInitialOnboarding) {
    try {
      const existingConfig = await getRecord(did, CONFIG_COLLECTION, CONFIG_RKEY);
      isFirstTimeConfig = !existingConfig;
    } catch (error) {
      // If getRecord fails (e.g., 404), treat as first time
      isFirstTimeConfig = true;
    }
  }

  const configToSave: any = {
    $type: CONFIG_COLLECTION,
    title: currentConfig.title,
    subtitle: currentConfig.subtitle,
  };

  // Styles and sections are generated client-side from DID
  // No need to write them to PDS

  // Write config and sections to PDS
  const promises: Promise<any>[] = [
    putRecord(CONFIG_COLLECTION, CONFIG_RKEY, configToSave)
  ];

  // Save sections configuration
  // Even though we generate defaults client-side, we need to save user customizations (ordering, new sections)
  if (currentConfig.sections) {
    promises.push(putRecord(SECTIONS_COLLECTION, CONFIG_RKEY, {
      $type: SECTIONS_COLLECTION,
      sections: currentConfig.sections
    }));
  }

  // On first config, create special spore if lucky (or if test DID)
  if (isFirstTimeConfig) {
    const rng = seededRandom(did);
    // 1 in 10 chance to get a special spore, OR test DID always gets one
    const shouldGetSpore = TEST_SPORE_DIDS.includes(did) || rng() < 0.1;
    if (shouldGetSpore) {
      promises.push(putRecord(SPECIAL_SPORE_COLLECTION, CONFIG_RKEY, {
        $type: SPECIAL_SPORE_COLLECTION,
        subject: did, // Subject for backlink indexing (origin garden)
        createdAt: new Date().toISOString()
      }));
    }

    // Clone Bluesky profile to garden.spores.site.profile
    // Fetches the raw app.bsky.actor.profile record to get blob refs (not CDN URLs)
    try {
      const bskyProfileRecord = await getRecord(did, 'app.bsky.actor.profile', 'self');
      if (bskyProfileRecord?.value) {
        const bskyProfile = bskyProfileRecord.value;
        const profileRecord: any = {
          $type: 'garden.spores.site.profile',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        if (bskyProfile.displayName) {
          profileRecord.displayName = bskyProfile.displayName;
        }
        if (bskyProfile.description) {
          profileRecord.description = bskyProfile.description;
        }
        // Copy blob refs directly - they reference blobs on the same PDS
        if (bskyProfile.avatar) {
          profileRecord.avatar = bskyProfile.avatar;
        }
        if (bskyProfile.banner) {
          profileRecord.banner = bskyProfile.banner;
        }

        promises.push(putRecord('garden.spores.site.profile', 'self', profileRecord));
      }
    } catch (error) {
      console.warn('Failed to clone Bluesky profile to garden.spores.site.profile:', error);
      // Don't fail the entire onboarding if profile cloning fails
    }
  }

  await Promise.all(promises);

  // Register this garden in the recent gardens discovery system
  registerGarden(did);

  return currentConfig;
}

/**
 * Add a section to the config
 */
export function addSection(section) {
  const id = section.id || `section-${Date.now()}`;
  const newSection = { ...section, id };

  currentConfig.sections = [...(currentConfig.sections || []), newSection];
  return newSection;
}

/**
 * Update a section by ID
 */
export function updateSection(id, updates) {
  currentConfig.sections = currentConfig.sections.map(section =>
    section.id === id ? { ...section, ...updates } : section
  );
}

/**
 * Remove a section by ID
 */
export function removeSection(id) {
  currentConfig.sections = currentConfig.sections.filter(section => section.id !== id);
}

/**
 * Reorder sections
 */
export function reorderSections(orderedIds) {
  const sectionMap = new Map(currentConfig.sections.map(s => [s.id, s]));
  currentConfig.sections = orderedIds.map(id => sectionMap.get(id)).filter(Boolean);
}

/**
 * Move a section up in the order
 */
export function moveSectionUp(sectionId) {
  const sections = currentConfig.sections || [];
  const index = sections.findIndex(s => s.id === sectionId);

  if (index <= 0) {
    return false;
  }

  [sections[index - 1], sections[index]] = [sections[index], sections[index - 1]];
  return true;
}

/**
 * Move a section down in the order
 */
export function moveSectionDown(sectionId) {
  const sections = currentConfig.sections || [];
  const index = sections.findIndex(s => s.id === sectionId);

  if (index < 0 || index >= sections.length - 1) {
    return false;
  }

  [sections[index], sections[index + 1]] = [sections[index + 1], sections[index]];
  return true;
}

/**
 * Update theme
 */
export function updateTheme(themeUpdates) {
  if (!currentConfig.theme) {
    currentConfig.theme = { preset: 'minimal', colors: {}, fonts: {}, borderStyle: 'solid' };
  }

  currentConfig.theme = {
    ...currentConfig.theme,
    ...themeUpdates
  };
  return currentConfig.theme;
}


