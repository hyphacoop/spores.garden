/**
 * Publishes a flower web tile to the user's PDS as an ing.dasl.masl record.
 */

import { uploadBlob, createRecord } from '../oauth';
import { generateFlowerTileHTML } from './flower-tile';

const TILE_COLLECTION = 'ing.dasl.masl';

export async function publishFlowerTile(did: string): Promise<{ uri: string; cid: string }> {
  const html = generateFlowerTileHTML(did);
  const blob = new Blob([html], { type: 'text/html' });

  const uploadMimeType = 'application/octet-stream';
  console.log('[publishFlowerTile] uploading tile blob', {
    did,
    htmlLength: html.length,
    blobSize: blob.size,
    blobType: blob.type,
    uploadMimeType
  });

  const upload = await uploadBlob(blob, uploadMimeType);
  const blobRef = upload.data?.blob;
  console.log('[publishFlowerTile] upload result', {
    hasBlobRef: !!blobRef,
    blobRef
  });
  if (!blobRef) {
    throw new Error('Failed to upload tile blob');
  }

  const record = {
    $type: TILE_COLLECTION,
    tile: {
      name: 'My Flower',
      description: 'A unique flower generated from my DID on spores.garden',
      sizing: { width: 300, height: 300 },
      resources: {
        '/': {
          src: blobRef,
          'content-type': 'text/html; charset=utf-8'
        }
      }
    },
    createdAt: new Date().toISOString()
  };

  console.log('[publishFlowerTile] creating record', {
    collection: TILE_COLLECTION,
    record
  });

  const result = await createRecord(TILE_COLLECTION, record);
  console.log('[publishFlowerTile] record created', result);
  return { uri: result.uri, cid: result.cid };
}
