import { getRecord, listRecords, resolveHandle, parseAtUri, buildAtUri } from './at-client';
import { createRecord, putRecord, getCurrentDid, isLoggedIn, deleteRecord } from './oauth';
import { getThemePreset, generateThemeFromDid } from './themes/engine';
import { registerGarden } from './components/recent-gardens';

const CONFIG_COLLECTION = 'garden.spores.site.config';
const SECTION_COLLECTION = 'garden.spores.site.section';
const LAYOUT_COLLECTION = 'garden.spores.site.layout';
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
    ref: buildAtUri(did, 'garden.spores.site.profile', 'self'),
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
  console.log('[initConfig] URL identifier:', identifier);

  if (identifier) {
    if (identifier.type === 'did') {
      siteOwnerDid = identifier.value;
    } else if (identifier.type === 'handle') {
      try {
        siteOwnerDid = await resolveHandle(identifier.value);
        console.log(`[initConfig] Resolved handle "${identifier.value}" → DID: ${siteOwnerDid}`);
      } catch (error) {
        console.warn('[initConfig] Failed to resolve handle, redirecting to homepage:', error);
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
    siteOwnerDid = getCurrentDid(); // Fallback to logged-in user
    console.log('[initConfig] No URL identifier, fallback to logged-in DID:', siteOwnerDid);
    if (!siteOwnerDid) {
      currentConfig = getDefaultConfig();
      return currentConfig;
    }
  }

  const loaded = await loadUserConfig(siteOwnerDid);
  if (loaded === null) {
    console.log('[initConfig] loadUserConfig returned null — building preview config');
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

async function migrateSections(did: string) {
  // Only attempt migration if logged in and viewing own garden
  if (!isLoggedIn() || getCurrentDid() !== did) {
    console.log(`Skipping migration for ${did}: Not logged in or not owner.`);
    return;
  }
  const OLD_SECTIONS_COLLECTION = 'garden.spores.site.sections';
  try {
    const oldSectionsRecord = await getRecord(did, OLD_SECTIONS_COLLECTION, CONFIG_RKEY);
    if (oldSectionsRecord && oldSectionsRecord.value && oldSectionsRecord.value.sections) {
      console.log(`Migrating old sections record for user: ${did}`);

      const sections = oldSectionsRecord.value.sections as any[];
      const sectionUris: string[] = [];

      for (const section of sections) {
        const sectionRecord = {
          $type: SECTION_COLLECTION,
          type: section.type,
          title: section.title || undefined,
          layout: section.layout || undefined,
          collection: section.collection || undefined,
          rkey: section.rkey || undefined,
          records: section.records || undefined,
          content: section.content || undefined,
          format: section.format || undefined,
          limit: section.limit || undefined,
          hideHeader: section.hideHeader || undefined,
        };

        const response = await createRecord(SECTION_COLLECTION, sectionRecord);
        sectionUris.push(response.uri);
      }

      const layoutRecord = {
        $type: LAYOUT_COLLECTION,
        sections: sectionUris,
      };
      await putRecord(LAYOUT_COLLECTION, CONFIG_RKEY, layoutRecord);

      await deleteRecord(OLD_SECTIONS_COLLECTION, CONFIG_RKEY);
      console.log(`Migration successful for user: ${did}`);
    }
  } catch (error) {
    if (error.message.includes('not found')) {
        // This is expected if the user has already been migrated or is a new user.
    } else {
        console.error(`Error during sections migration check for user ${did}:`, error);
    }
  }
}

/**
 * Load config for a given user DID
 */
export async function loadUserConfig(did) {
  if (!did) {
    console.log('[loadUserConfig] No DID provided, returning default config');
    currentConfig = getDefaultConfig();
    return null;
  }

  console.log(`[loadUserConfig] Loading config for DID: ${did}`);

  try {
    await migrateSections(did);

    let configRecord = await getRecord(did, CONFIG_COLLECTION, CONFIG_RKEY);
    let layoutRecord = await getRecord(did, LAYOUT_COLLECTION, CONFIG_RKEY);

    console.log(`[loadUserConfig] configRecord (${CONFIG_COLLECTION}):`, configRecord ? 'found' : 'null');
    console.log(`[loadUserConfig] layoutRecord (${LAYOUT_COLLECTION}):`, layoutRecord ? 'found' : 'null');
    if (layoutRecord?.value) {
      console.log(`[loadUserConfig] layout sections:`, layoutRecord.value.sections);
    }

    // Config record is required for onboarding check.
    // If it doesn't exist, but we have a layout, create a default config.
    if (!configRecord) {
      if (layoutRecord) {
        // Create a default config record
        const defaultConfigToSave = {
          $type: CONFIG_COLLECTION,
          title: 'My Garden', // Default title
          subtitle: '',
        };
        await putRecord(CONFIG_COLLECTION, CONFIG_RKEY, defaultConfigToSave);
        configRecord = { value: defaultConfigToSave }; // Use this new config
        console.log('[loadUserConfig] Created default garden config record during loading.');
      } else {
        // No config and no layout, so truly no garden setup.
        console.log('[loadUserConfig] No config and no layout found — returning null (will show garden preview)');
        return null;
      }
    }

    const defaultConfig = getDefaultConfig();
    const config = configRecord.value;

    const { theme: generatedTheme } = generateThemeFromDid(did);
    const theme = { ...generatedTheme };

    let sections = [];

    if (layoutRecord && layoutRecord.value && Array.isArray(layoutRecord.value.sections) && layoutRecord.value.sections.length > 0) {
      const pdsSectionUris = layoutRecord.value.sections;
      console.log(`[loadUserConfig] Fetching ${pdsSectionUris.length} section records from layout...`);

      const pdsSectionResults = await Promise.all(
        pdsSectionUris.map(async (uri, i) => {
          const parsed = parseAtUri(uri);
          if (!parsed) {
            console.warn(`[loadUserConfig] Failed to parse section URI [${i}]: ${uri}`);
            return null;
          }
          console.log(`[loadUserConfig]   Fetching section [${i}]: ${parsed.collection}/${parsed.rkey}`);
          const record = await getRecord(parsed.did, parsed.collection, parsed.rkey);
          if (!record) {
            console.warn(`[loadUserConfig]   Section [${i}] returned null (not found): ${uri}`);
          } else {
            console.log(`[loadUserConfig]   Section [${i}] loaded: type=${record.value?.type}, title=${record.value?.title}, rkey=${record.value?.rkey || '(none)'}`);
          }
          return record;
        })
      );

      // Map PDS records to section objects.
      // sectionRkey = the section record's own rkey (for save/delete/layout URIs)
      // rkey = the target record's rkey within the collection (from the record value, e.g. 'self' for profiles)
      sections = pdsSectionResults.filter(Boolean).map(record => {
        const sectionRkey = record.uri?.split('/').pop();
        const val = record.value;
        // Construct ref from collection+rkey when absent (backward compat)
        let ref = val.ref;
        if (!ref && val.collection && val.rkey) {
          ref = buildAtUri(did, val.collection, val.rkey);
        }
        return {
          ...val,
          ref,
          id: sectionRkey,
          sectionRkey,
        };
      });

      // Order sections by layout URI order
      const sectionMap = new Map(sections.map(s => [s.sectionRkey, s]));
      sections = pdsSectionUris.map(uri => {
        const sectionRkey = uri.split('/').pop();
        return sectionMap.get(sectionRkey);
      }).filter(Boolean);

      console.log(`[loadUserConfig] Final sections after ordering: ${sections.length}`);
      sections.forEach((s, i) => console.log(`[loadUserConfig]   [${i}] type=${s.type} title=${s.title || '(none)'} rkey=${s.rkey || '(none)'} sectionRkey=${s.sectionRkey}`));
    } else {
      // No layout with sections — generate initial defaults for new/empty gardens
      sections = generateInitialSections(did);
      const reason = !layoutRecord ? 'no layout record' :
        !layoutRecord.value ? 'layout record has no value' :
        !Array.isArray(layoutRecord.value.sections) ? 'layout sections is not an array' :
        'layout sections array is empty';
      console.log(`[loadUserConfig] No layout sections (${reason}) — using ${sections.length} initial sections`);
    }

    currentConfig = {
      ...defaultConfig,
      ...config,
      theme: {
        ...theme,
        preset: 'minimal'
      },
      sections,
    };

    console.log(`[loadUserConfig] Config built successfully with ${sections.length} sections`);
    siteOwnerDid = did;
    return currentConfig;
  } catch (error) {
    console.warn('[loadUserConfig] Failed to load user config, using default:', error);
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

  let isFirstTimeConfig = isInitialOnboarding;
  if (!isInitialOnboarding) {
    try {
      const existingConfig = await getRecord(did, CONFIG_COLLECTION, CONFIG_RKEY);
      isFirstTimeConfig = !existingConfig;
    } catch (error) {
      isFirstTimeConfig = true;
    }
  }

  const promises: Promise<any>[] = [];

  const configToSave: any = {
    $type: CONFIG_COLLECTION,
    title: currentConfig.title,
    subtitle: currentConfig.subtitle,
  };
  promises.push(putRecord(CONFIG_COLLECTION, CONFIG_RKEY, configToSave));

  const updatedSections = await Promise.all(currentConfig.sections.map(async (section) => {
    const sectionRecord = {
      $type: SECTION_COLLECTION,
      type: section.type,
      title: section.title || undefined,
      layout: section.layout || undefined,
      ref: section.ref || undefined,
      collection: section.collection || undefined,
      rkey: section.rkey || undefined,
      records: section.records || undefined,
      content: section.content || undefined,
      format: section.format || undefined,
      limit: section.limit || undefined,
      hideHeader: section.hideHeader || undefined,
    };

    if (section.sectionRkey) {
      await putRecord(SECTION_COLLECTION, section.sectionRkey, sectionRecord);
      return section;
    } else {
      const response = await createRecord(SECTION_COLLECTION, sectionRecord);
      const newSectionRkey = response.uri.split('/').pop();
      return { ...section, sectionRkey: newSectionRkey, uri: response.uri };
    }
  }));
  currentConfig.sections = updatedSections;

  const sectionUris = currentConfig.sections.map(s => `at://${did}/${SECTION_COLLECTION}/${s.sectionRkey}`);
  promises.push(putRecord(LAYOUT_COLLECTION, CONFIG_RKEY, {
    $type: LAYOUT_COLLECTION,
    sections: sectionUris,
  }));

  if (isFirstTimeConfig) {
    const rng = seededRandom(did);
    const shouldGetSpore = TEST_SPORE_DIDS.includes(did) || rng() < 0.1;
    if (shouldGetSpore) {
      promises.push(putRecord(SPECIAL_SPORE_COLLECTION, CONFIG_RKEY, {
        $type: SPECIAL_SPORE_COLLECTION,
        subject: did,
        createdAt: new Date().toISOString()
      }));
    }

    // Clone Bluesky profile to garden.spores.site.profile
    try {
      const bskyProfileRecord = await getRecord(did, 'app.bsky.actor.profile', 'self');
      if (bskyProfileRecord?.value) {
        const bskyProfile = bskyProfileRecord.value;
        const profileRecord: any = {
          $type: 'garden.spores.site.profile',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          displayName: bskyProfile.displayName,
          description: bskyProfile.description,
          avatar: bskyProfile.avatar,
          banner: bskyProfile.banner,
        };
        promises.push(putRecord('garden.spores.site.profile', 'self', profileRecord));
      }
    } catch (error) {
      console.warn('Failed to clone Bluesky profile:', error);
    }
  }

  await Promise.all(promises);

  registerGarden(did);

  return currentConfig;
}

/**
 * Add a section to the config
 */
export function addSection(section) {
  const id = section.id || `section-${Date.now()}`;
  // Do not set rkey here. saveConfig will handle it.
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
export async function removeSection(id) {
  const sectionToRemove = currentConfig.sections.find(section => section.id === id);
  if (sectionToRemove && sectionToRemove.sectionRkey && siteOwnerDid) {
    try {
      await deleteRecord(SECTION_COLLECTION, sectionToRemove.sectionRkey);
    } catch (error) {
      console.error(`Failed to delete section record ${sectionToRemove.sectionRkey} from PDS:`, error);
      // Continue with local removal even if PDS delete fails
    }
  }
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


