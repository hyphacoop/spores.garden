/**
 * Publishes a flower web tile to the user's PDS as an ing.dasl.masl record.
 */

import { uploadBlob, createRecord } from '../oauth';
import { generateFlowerTileHTML } from './flower-tile';

const TILE_COLLECTION = 'ing.dasl.masl';

export async function publishFlowerTile(did: string): Promise<{ uri: string; cid: string }> {
  const html = generateFlowerTileHTML(did);
  const blob = new Blob([html], { type: 'text/html' });

  const upload = await uploadBlob(blob, 'application/octet-stream');
  const blobRef = upload.data?.blob;
  if (!blobRef) {
    throw new Error('Failed to upload tile blob');
  }

  const record = {
    name: 'My Flower',
    description: 'A unique flower generated from my DID on spores.garden',
    sizing: { width: 300, height: 300 },
    resources: {
      '/': {
        src: blobRef,
        'content-type': 'text/html'
      }
    },
    createdAt: new Date().toISOString()
  };

  const result = await createRecord(TILE_COLLECTION, record);
  return { uri: result.uri, cid: result.cid };
}
