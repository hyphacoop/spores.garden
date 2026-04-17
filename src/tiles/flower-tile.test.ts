import { describe, it, expect } from 'vitest';
import { generateFlowerTileHTML } from './flower-tile';

const TEST_DID = 'did:plc:abc123testdid';

describe('generateFlowerTileHTML', () => {
  it('returns a valid HTML document', () => {
    const html = generateFlowerTileHTML(TEST_DID);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('contains an SVG flower', () => {
    const html = generateFlowerTileHTML(TEST_DID);
    expect(html).toContain('<svg');
    expect(html).toContain('</svg>');
  });

  it('includes a link to the user garden', () => {
    const html = generateFlowerTileHTML(TEST_DID);
    expect(html).toContain(`spores.garden/${encodeURIComponent(TEST_DID)}`);
  });

  it('is deterministic — same DID produces identical output', () => {
    const a = generateFlowerTileHTML(TEST_DID);
    const b = generateFlowerTileHTML(TEST_DID);
    expect(a).toBe(b);
  });

  it('produces different output for different DIDs', () => {
    const a = generateFlowerTileHTML('did:plc:aaaaaaaaaaaaaaaa');
    const b = generateFlowerTileHTML('did:plc:bbbbbbbbbbbbbbbb');
    expect(a).not.toBe(b);
  });

  it('bakes background color from theme into the CSS', () => {
    const html = generateFlowerTileHTML(TEST_DID);
    expect(html).toMatch(/background:\s*#[0-9a-fA-F]{6}/);
  });

  it('is self-contained with no external script or stylesheet references', () => {
    const html = generateFlowerTileHTML(TEST_DID);
    expect(html).not.toMatch(/<script\s+src=/);
    expect(html).not.toMatch(/<link\s+rel="stylesheet"/);
  });

  describe('manifest contract', () => {
    it('produces HTML that can be encoded as a UTF-8 Blob without loss', () => {
      const html = generateFlowerTileHTML(TEST_DID);
      const encoded = new TextEncoder().encode(html);
      const decoded = new TextDecoder().decode(encoded);
      expect(decoded).toBe(html);
    });

    it('does not contain bare </script> tags that would break srcdoc embedding', () => {
      const html = generateFlowerTileHTML(TEST_DID);
      // An unescaped </script> inside srcdoc terminates the parent document's script
      // block early. The tile has no inline scripts, so this should never appear.
      expect(html).not.toContain('</script>');
    });

    it('does not embed the DID in a way that could break HTML attribute context', () => {
      // DID characters are alphanumeric + colon, safe in attribute values,
      // but verify no angle brackets or quotes slip through from future changes.
      const did = 'did:plc:abc123testdid';
      const html = generateFlowerTileHTML(did);
      const gardenLinkMatch = html.match(/href="([^"]+)"/g) || [];
      for (const attr of gardenLinkMatch) {
        expect(attr).not.toContain('<');
        expect(attr).not.toContain('>');
      }
    });
  });
});
