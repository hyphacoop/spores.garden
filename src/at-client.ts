/**
 * AT Protocol client for PDS (records) and Constellation (backlinks)
 */

import { Client } from '@atcute/client';
import {
  CompositeDidDocumentResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver
} from '@atcute/identity-resolver';
import { ENDPOINTS } from './config/endpoints';
import { deleteRecord } from './oauth'; // Import deleteRecord


// Cache for resolved PDS endpoints
const pdsCache = new Map<string, string>();

/**
 * Resolve PDS endpoint from DID
 */
async function resolvePdsEndpoint(did: string): Promise<string | null> {
  if (pdsCache.has(did)) {
    return pdsCache.get(did)!;
  }

  try {
    const resolver = new CompositeDidDocumentResolver({
      methods: {
        plc: new PlcDidDocumentResolver(),
        web: new WebDidDocumentResolver()
      }
    });

    const doc = await resolver.resolve(did as `did:plc:${string}` | `did:web:${string}`);
    // Extract PDS endpoint from DID document
    const service = doc?.service?.find((s: any) => s.id === '#atproto_pds');
    let pds: string | null = null;

    if (service?.serviceEndpoint) {
      // serviceEndpoint can be a string, object, or array
      if (typeof service.serviceEndpoint === 'string') {
        pds = service.serviceEndpoint;
      } else if (Array.isArray(service.serviceEndpoint) && service.serviceEndpoint.length > 0) {
        pds = typeof service.serviceEndpoint[0] === 'string' ? service.serviceEndpoint[0] : null;
      }
    }

    if (pds) {
      pdsCache.set(did, pds);
      return pds;
    }
  } catch (error) {
    console.warn(`Failed to resolve PDS for ${did}:`, error);
  }

  return null;
}

/**
 * Fetch a single record from PDS or Slingshot
 * 
 * @param did - The DID of the repository
 * @param collection - The collection name
 * @param rkey - The record key
 * @param options - Optional configuration
 * @param options.useSlingshot - If true, use Slingshot directly (useful for backlinks from many DIDs)
 */
export async function getRecord(did: string, collection: string, rkey: string, options: { useSlingshot?: boolean } = {}) {
  if (!did) {
    throw new Error('DID is required');
  }
  if (!collection) {
    throw new Error('Collection is required');
  }
  if (!rkey) {
    throw new Error('Rkey is required');
  }

  const { useSlingshot = false } = options;

  // Cache-busting headers to prevent stale data
  const fetchOptions: RequestInit = {
    headers: {
      'Cache-Control': 'no-cache',
    },
  };

  // If explicitly requested, use Slingshot (useful for backlinks from many DIDs)
  if (useSlingshot) {
    const url = new URL('/xrpc/com.atproto.repo.getRecord', ENDPOINTS.SLINGSHOT_URL);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', collection);
    url.searchParams.set('rkey', rkey);

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      // Treat 404 (not found) and 400 (bad request / unknown collection) as record not existing
      if (response.status === 404 || response.status === 400) return null;
      throw new Error(`Failed to fetch record: ${response.status}`);
    }

    return response.json();
  }

  // Resolve PDS endpoint from DID
  const pdsUrl = await resolvePdsEndpoint(did);
  if (!pdsUrl) {
    // Fallback to Slingshot if PDS resolution fails
    console.warn(`Could not resolve PDS for ${did}, falling back to Slingshot`);
    const url = new URL('/xrpc/com.atproto.repo.getRecord', ENDPOINTS.SLINGSHOT_URL);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', collection);
    url.searchParams.set('rkey', rkey);

    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      // Treat 404 (not found) and 400 (bad request / unknown collection) as record not existing
      if (response.status === 404 || response.status === 400) return null;
      throw new Error(`Failed to fetch record: ${response.status}`);
    }

    return response.json();
  }

  // Use resolved PDS
  const url = new URL('/xrpc/com.atproto.repo.getRecord', pdsUrl);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('rkey', rkey);

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      // Treat 404 (not found) and 400 (bad request / unknown collection) as record not existing
      if (response.status === 404 || response.status === 400) return null;
      throw new Error(`Failed to fetch record: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    // If PDS fails, try Slingshot as fallback
    console.warn(`PDS request failed for ${pdsUrl}, trying Slingshot:`, error);
    const fallbackUrl = new URL('/xrpc/com.atproto.repo.getRecord', ENDPOINTS.SLINGSHOT_URL);
    fallbackUrl.searchParams.set('repo', did);
    fallbackUrl.searchParams.set('collection', collection);
    fallbackUrl.searchParams.set('rkey', rkey);

    const response = await fetch(fallbackUrl, fetchOptions);
    if (!response.ok) {
      // Treat 404 (not found) and 400 (bad request / unknown collection) as record not existing
      if (response.status === 404 || response.status === 400) return null;
      throw new Error(`Failed to fetch record: ${response.status}`);
    }

    return response.json();
  }
}

/**
 * List records in a collection
 */
export async function listRecords(did: string, collection: string, options: { limit?: number; cursor?: string } = {}, agent: any = null) {
  if (!did) {
    throw new Error('DID is required');
  }
  if (!collection) {
    throw new Error('Collection is required');
  }

  const { limit = 50, cursor } = options;

  // Try authenticated agent first (if provided)
  if (agent) {
    try {
      // Validate agent
      if (!agent || typeof agent !== 'object') {
        throw new Error('Invalid agent: agent is not a valid object');
      }

      // Resolve PDS endpoint to ensure client uses correct service
      const pdsUrl = await resolvePdsEndpoint(did);

      // Create client with explicit service URL if we have it
      const clientOptions: any = { handler: agent };
      if (pdsUrl) {
        clientOptions.serviceUrl = pdsUrl;
      }

      const client = new Client(clientOptions);

      // Use get() for queries (listRecords is a query)
      const response = await (client as any).get('com.atproto.repo.listRecords', {
        params: {
          repo: did,
          collection,
          limit,
          ...(cursor && { cursor })
        }
      });

      if (!response.ok) {
        const errorMsg = response.data?.message || response.data?.error || 'Unknown error';
        throw new Error(`Failed to list records: ${errorMsg}`);
      }

      return response.data;
    } catch (error) {
      // If authenticated call fails, fall back to Slingshot
      // (but only if it's not a 404 - 404 means repo doesn't exist)
      if (error?.statusCode === 404 || error?.status === 404) {
        throw error; // Don't fall back for 404s
      }
      console.warn('Failed to list records via authenticated agent, falling back to Slingshot:', error);
      // Fall through to Slingshot
    }
  }

  // Fall back to PDS (resolved from DID) or Slingshot
  const pdsUrl = await resolvePdsEndpoint(did);
  const serviceUrl = pdsUrl || ENDPOINTS.SLINGSHOT_URL;

  if (!pdsUrl) {
    console.warn(`Could not resolve PDS for ${did}, falling back to Slingshot`);
  }

  // Cache-busting headers to prevent stale data
  const fetchOptions: RequestInit = {
    headers: {
      'Cache-Control': 'no-cache',
    },
  };

  const url = new URL('/xrpc/com.atproto.repo.listRecords', serviceUrl);
  url.searchParams.set('repo', did);
  url.searchParams.set('collection', collection);
  url.searchParams.set('limit', limit.toString());
  if (cursor) url.searchParams.set('cursor', cursor);

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      // If PDS fails and we haven't tried Slingshot yet, try it
      if (pdsUrl && serviceUrl === pdsUrl) {
        console.warn(`PDS request failed for ${pdsUrl}, trying Slingshot`);
        const fallbackUrl = new URL('/xrpc/com.atproto.repo.listRecords', ENDPOINTS.SLINGSHOT_URL);
        fallbackUrl.searchParams.set('repo', did);
        fallbackUrl.searchParams.set('collection', collection);
        fallbackUrl.searchParams.set('limit', limit.toString());
        if (cursor) fallbackUrl.searchParams.set('cursor', cursor);

        const fallbackResponse = await fetch(fallbackUrl, fetchOptions);
        if (!fallbackResponse.ok) {
          const errorText = await fallbackResponse.text().catch(() => 'Unknown error');
          throw new Error(`Failed to list records: ${fallbackResponse.status} ${fallbackResponse.statusText}. ${errorText}`);
        }

        const data = await fallbackResponse.json();
        if (!data || !data.records) {
          throw new Error('Invalid response format: missing records array');
        }
        return data;
      }

      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to list records: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json();

    if (!data || !data.records) {
      throw new Error('Invalid response format: missing records array');
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Network error: Unable to connect to ${serviceUrl}. Check your internet connection.`);
    }
    throw error;
  }
}

/**
 * Describe a repo to get all collections
 */
export async function describeRepo(did: string, agent: any = null) {
  if (!did) {
    throw new Error('DID is required');
  }

  // Try authenticated agent first (if provided)
  if (agent) {
    try {
      // Validate agent
      if (!agent || typeof agent !== 'object') {
        throw new Error('Invalid agent: agent is not a valid object');
      }

      // Resolve PDS endpoint
      const pdsUrl = await resolvePdsEndpoint(did);

      // Create client with explicit service URL if we have it
      const clientOptions: any = { handler: agent };
      if (pdsUrl) {
        clientOptions.serviceUrl = pdsUrl;
      }

      const client = new Client(clientOptions);

      // Use get() for queries
      const response = await (client as any).get('com.atproto.repo.describeRepo', {
        params: { repo: did }
      });

      if (!response.ok) {
        const errorMsg = response.data?.message || response.data?.error || 'Unknown error';
        throw new Error(`Failed to describe repo: ${errorMsg}`);
      }

      return response.data;
    } catch (error) {
      // If authenticated call fails, fall back to Slingshot
      // (but only if it's not a 404 - 404 means repo doesn't exist)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const statusCode = error?.statusCode || error?.status;

      if (statusCode === 404) {
        console.warn('Authenticated call returned 404, repo may not exist');
        throw error; // Don't fall back for 404s
      }

      console.warn('Failed to describe repo via authenticated agent, falling back to Slingshot:', errorMessage);
      // Fall through to Slingshot
    }
  }

  // Fall back to PDS (resolved from DID) or Slingshot
  const pdsUrl = await resolvePdsEndpoint(did);
  const serviceUrl = pdsUrl || ENDPOINTS.SLINGSHOT_URL;

  if (!pdsUrl) {
    console.warn(`Could not resolve PDS for ${did}, falling back to Slingshot`);
  }

  // Cache-busting headers to prevent stale data
  const fetchOptions: RequestInit = {
    headers: {
      'Cache-Control': 'no-cache',
    },
  };

  const url = new URL('/xrpc/com.atproto.repo.describeRepo', serviceUrl);
  url.searchParams.set('repo', did);

  try {
    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      // If PDS fails and we haven't tried Slingshot yet, try it
      if (pdsUrl && serviceUrl === pdsUrl) {
        console.warn(`PDS request failed for ${pdsUrl}, trying Slingshot`);
        const fallbackUrl = new URL('/xrpc/com.atproto.repo.describeRepo', ENDPOINTS.SLINGSHOT_URL);
        fallbackUrl.searchParams.set('repo', did);

        const fallbackResponse = await fetch(fallbackUrl, fetchOptions);
        if (!fallbackResponse.ok) {
          const errorText = await fallbackResponse.text().catch(() => 'Unknown error');
          throw new Error(`Failed to describe repo: ${fallbackResponse.status} ${fallbackResponse.statusText}. ${errorText}`);
        }

        const data = await fallbackResponse.json();
        if (!data) {
          throw new Error('Empty response from describeRepo');
        }
        return data;
      }

      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to describe repo: ${response.status} ${response.statusText}. ${errorText}`);
    }

    const data = await response.json();

    if (!data) {
      throw new Error('Empty response from describeRepo');
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Network error: Unable to connect to ${serviceUrl}. Check your internet connection.`);
    }
    throw error;
  }
}

/**
 * Get backlinks from Constellation (for flower interactions, etc.)
 */
export async function getBacklinks(subject: string, source: string, options: { limit?: number; cursor?: string } = {}) {
  const { limit = 50, cursor } = options;

  // Cache-busting headers to prevent stale data
  const fetchOptions: RequestInit = {
    headers: {
      'Cache-Control': 'no-cache',
    },
  };

  const url = new URL('/xrpc/blue.microcosm.links.getBacklinks', ENDPOINTS.CONSTELLATION_URL);
  url.searchParams.set('subject', subject);
  url.searchParams.set('source', source);
  url.searchParams.set('limit', limit.toString());
  if (cursor) url.searchParams.set('cursor', cursor);

  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(
        `Failed to get backlinks: ${response.status} ${response.statusText}. ${errorText}`
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(
        `Network/CORS error: Unable to connect to ${ENDPOINTS.CONSTELLATION_URL}.`
      );
    }
    throw error;
  }
}

/**
 * Resolve a handle to DID
 */
export async function resolveHandle(handle) {
  // Cache-busting headers to prevent stale data
  const fetchOptions: RequestInit = {
    headers: {
      'Cache-Control': 'no-cache',
    },
  };

  const url = new URL('/xrpc/com.atproto.identity.resolveHandle', 'https://public.api.bsky.app');
  url.searchParams.set('handle', handle);

  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    throw new Error(`Failed to resolve handle: ${response.status}`);
  }

  const data = await response.json();
  return data.did;
}

/**
 * Get profile from Bluesky API
 */
export async function getProfile(did) {
  // Cache-busting headers to prevent stale data
  const fetchOptions: RequestInit = {
    headers: {
      'Cache-Control': 'no-cache',
    },
  };

  const url = new URL('/xrpc/app.bsky.actor.getProfile', ENDPOINTS.BLUESKY_API_URL);
  url.searchParams.set('actor', did);

  const response = await fetch(url, fetchOptions);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to get profile: ${response.status}`);
  }

  return response.json();
}

export interface ActorSearchResult {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export async function searchActorsTypeahead(query: string, limit = 8): Promise<ActorSearchResult[]> {
  const url = new URL('/xrpc/app.bsky.actor.searchActorsTypeahead', ENDPOINTS.BLUESKY_API_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const data = await response.json();
    return data.actors ?? [];
  } catch {
    return [];
  }
}

export interface ActorSearchPage {
  actors: ActorSearchResult[];
  cursor?: string;
}

export async function searchActors(query: string, cursor?: string, limit = 8): Promise<ActorSearchPage> {
  const url = new URL('/xrpc/app.bsky.actor.searchActors', ENDPOINTS.BLUESKY_API_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  try {
    const response = await fetch(url);
    if (!response.ok) return { actors: [] };
    const data = await response.json();
    return { actors: data.actors ?? [], cursor: data.cursor };
  } catch {
    return { actors: [] };
  }
}

/** Max actors per getProfiles request (Bluesky API limit) */
const GET_PROFILES_BATCH_SIZE = 25;

/**
 * Get multiple Bluesky profiles in one or more batch requests.
 * Returns a Map of did -> profile (or null if not found / error). Fails gracefully per-actor.
 */
export async function getProfiles(actors: string[]): Promise<Map<string, unknown | null>> {
  const result = new Map<string, unknown | null>();
  const unique = [...new Set(actors)].filter(Boolean);
  if (unique.length === 0) return result;

  const fetchOptions: RequestInit = {
    headers: { 'Cache-Control': 'no-cache' },
  };

  for (let i = 0; i < unique.length; i += GET_PROFILES_BATCH_SIZE) {
    const batch = unique.slice(i, i + GET_PROFILES_BATCH_SIZE);
    const url = new URL('/xrpc/app.bsky.actor.getProfiles', ENDPOINTS.BLUESKY_API_URL);
    batch.forEach((actor) => url.searchParams.append('actors', actor));

    try {
      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        batch.forEach((did) => result.set(did, null));
        continue;
      }
      const data = await response.json();
      const profiles: unknown[] = data?.profiles ?? [];
      batch.forEach((did, idx) => {
        result.set(did, profiles[idx] ?? null);
      });
    } catch {
      batch.forEach((did) => result.set(did, null));
    }
  }

  return result;
}

/**
 * List all repos (DIDs) that have records in a given collection.
 * Calls the relay's com.atproto.sync.listReposByCollection endpoint.
 * Paginates through all results automatically.
 */
export async function listReposByCollection(collection: string): Promise<string[]> {
  const allDids: string[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL('/xrpc/com.atproto.sync.listReposByCollection', ENDPOINTS.RELAY_URL);
    url.searchParams.set('collection', collection);
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to list repos by collection: ${response.status}`);
    }

    const data = await response.json();
    for (const repo of data.repos || []) {
      if (repo.did) allDids.push(repo.did);
    }
    cursor = data.cursor;
  } while (cursor);

  return allDids;
}

/**
 * Parse an AT URI into components
 */
export function parseAtUri(uri) {
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/(.+)$/);
  if (!match) return null;

  return {
    did: match[1],
    collection: match[2],
    rkey: match[3]
  };
}

/**
 * Build an AT URI from components
 */
export function buildAtUri(did, collection, rkey) {
  return `at://${did}/${collection}/${rkey}`;
}

/**
 * Build a blob URL from a DID and blob reference
 * Blobs are accessed via com.atproto.sync.getBlob endpoint
 * 
 * @param did - The DID of the repository that owns the blob
 * @param blobRef - The blob reference object (with $link CID)
 * @returns The URL to fetch the blob
 */
export async function getBlobUrl(did: string, blobRef: { ref?: { $link: string }, $link?: string }): Promise<string> {
  // Handle both formats: { ref: { $link: "..." } } and { $link: "..." }
  const cid = blobRef.ref?.$link || blobRef.$link;
  if (!cid) {
    throw new Error('Invalid blob reference: missing $link');
  }

  // Resolve the PDS endpoint for this DID
  const pdsUrl = await resolvePdsEndpoint(did);
  const serviceUrl = pdsUrl || 'https://bsky.social';

  return `${serviceUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

/**
 * Delete a record using its AT URI
 */
export async function deleteRecordByUri(atUri: string) {
  const parsed = parseAtUri(atUri);
  if (!parsed) {
    throw new Error(`Invalid AT URI: ${atUri}`);
  }
  await deleteRecord(parsed.collection, parsed.rkey);
}
