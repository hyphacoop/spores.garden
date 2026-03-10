/**
 * Special spore (capture-the-flag) logic: finding held spores and stealing.
 * Shared by header display (site-renderer) and steal UI (spore-modal).
 */

import { getBacklinks, getRecord, listRecords } from '../at-client';
import { createRecord } from '../oauth';
import { isValidSpore } from '../config';
import { getBacklinkQueries, getCollection, getReadCollections } from '../config/nsid';
import { showAlertModal } from './confirm-modal';

const SPECIAL_SPORE_COLLECTION = getCollection('itemSpecialSpore');
const MAX_CAPTURE_FUTURE_SKEW_MS = 5 * 60 * 1000;
const SPORE_STEAL_COOLDOWN_MS = 1 * 60 * 1000;

export interface SporeInfo {
  originGardenDid: string;
  currentOwnerDid: string;
  currentRecord: any;
}

function dedupeSporesByOrigin(spores: SporeInfo[]): SporeInfo[] {
  const seen = new Set<string>();
  return spores.filter((spore) => {
    if (!spore?.originGardenDid || seen.has(spore.originGardenDid)) {
      return false;
    }
    seen.add(spore.originGardenDid);
    return true;
  });
}

function parseCaptureTimestampMs(createdAt: unknown, nowMs = Date.now()): number | null {
  if (typeof createdAt !== 'string' || !createdAt) {
    return null;
  }

  const parsedMs = new Date(createdAt).getTime();
  if (!Number.isFinite(parsedMs)) {
    return null;
  }

  // Ignore records with implausible future timestamps.
  if (parsedMs > nowMs + MAX_CAPTURE_FUTURE_SKEW_MS) {
    return null;
  }

  return parsedMs;
}

/**
 * Find spore info by its origin garden DID (current holder from latest record).
 */
export async function findSporeByOrigin(originGardenDid: string): Promise<SporeInfo | null> {
  try {
    const backlinkResponses = await Promise.all(
      getBacklinkQueries('itemSpecialSpore', 'subject').map((q) =>
        getBacklinks(originGardenDid, q, { limit: 100 }).catch(() => null)
      )
    );
    const backlinks = backlinkResponses.flatMap((response: any) => response?.records || response?.links || []);

    if (backlinks.length === 0) return null;

    const records = await Promise.all(
      backlinks.map(async (bl) => {
        try {
          return await getRecord(bl.did, bl.collection || SPECIAL_SPORE_COLLECTION, bl.rkey);
        } catch {
          return null;
        }
      })
    );

    const validRecords = records.filter((r) => {
      if (!r?.value) return false;
      return parseCaptureTimestampMs(r.value.createdAt) !== null;
    });
    if (validRecords.length === 0) return null;

    validRecords.sort((a, b) => {
      const timeA = parseCaptureTimestampMs(a.value.createdAt) || 0;
      const timeB = parseCaptureTimestampMs(b.value.createdAt) || 0;
      return timeB - timeA;
    });

    const currentRecord = validRecords[0];
    const currentOwnerIndex = records.findIndex(r => r === currentRecord);
    const currentOwnerDid = backlinks[currentOwnerIndex]?.did;
    return {
      originGardenDid,
      currentOwnerDid,
      currentRecord
    };
  } catch (error) {
    console.error('Failed to find spore by origin:', error);
    return null;
  }
}

/**
 * Find all spores currently held by this garden owner.
 */
export async function findAllHeldSpores(gardenOwnerDid: string): Promise<SporeInfo[]> {
  const heldSpores: SporeInfo[] = [];

  try {
    if (isValidSpore(gardenOwnerDid)) {
      const spore = await findSporeByOrigin(gardenOwnerDid);
      if (spore && spore.currentOwnerDid === gardenOwnerDid) {
        heldSpores.push(spore);
      }
    }

    const ownedResponses = await Promise.all(
      getReadCollections('itemSpecialSpore').map((collection) =>
        listRecords(gardenOwnerDid, collection, { limit: 10 }).catch(() => ({ records: [] }))
      )
    );
    const sporeRecords = ownedResponses.flatMap((response: any) => response.records || []);

    const alreadyFound = new Set(heldSpores.map(s => s.originGardenDid));
    const candidateOrigins = sporeRecords
      .map(r => r.value?.subject)
      .filter((originDid): originDid is string =>
        !!originDid && isValidSpore(originDid) && !alreadyFound.has(originDid)
      );
    const candidates = Array.from(new Set(candidateOrigins));
    const fetched = await Promise.all(candidates.map(findSporeByOrigin));
    for (const spore of fetched) {
      if (spore && spore.currentOwnerDid === gardenOwnerDid) heldSpores.push(spore);
    }

    return dedupeSporesByOrigin(heldSpores);
  } catch (error) {
    console.error('Failed to find held spores:', error);
    return dedupeSporesByOrigin(heldSpores);
  }
}

/**
 * Steal a spore (FFA capture-the-flag). Creates a new record for the new owner.
 */
export async function stealSpore(
  originGardenDid: string,
  newOwnerDid: string,
  previousOwnerHandle: string
): Promise<void> {
  const currentHolder = await findSporeByOrigin(originGardenDid);
  if (!currentHolder) {
    throw new Error('Could not find a valid spore record to steal.');
  }

  if (currentHolder.currentOwnerDid === newOwnerDid) {
    throw new Error('You already hold this spore.');
  }

  const latestCaptureMs = parseCaptureTimestampMs(currentHolder.currentRecord?.value?.createdAt);
  if (latestCaptureMs === null) {
    throw new Error('Spore capture timestamp is invalid. Try again in a few minutes.');
  }

  const nowMs = Date.now();
  const elapsedMs = Math.max(0, nowMs - latestCaptureMs);
  if (elapsedMs < SPORE_STEAL_COOLDOWN_MS) {
    const remainingMs = SPORE_STEAL_COOLDOWN_MS - elapsedMs;
    const remainingMinutes = Math.ceil(remainingMs / 60000);
    throw new Error(`This spore was just captured. Try again in about ${remainingMinutes} minute(s).`);
  }

  try {
    await createRecord(SPECIAL_SPORE_COLLECTION, {
      $type: SPECIAL_SPORE_COLLECTION,
      subject: originGardenDid,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to steal spore:', error);
    throw new Error('Failed to steal spore.');
  }

  await showAlertModal({
    title: 'Spore Stolen!',
    message: `You successfully stole the special spore from @${previousOwnerHandle}! It is now yours. For now...`,
    buttonText: 'Nice!',
    type: 'success'
  });
}
