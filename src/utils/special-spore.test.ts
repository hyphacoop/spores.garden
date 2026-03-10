import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findAllHeldSpores, findSporeByOrigin, stealSpore } from './special-spore';
import { getBacklinks, getRecord, listRecords } from '../at-client';
import { createRecord } from '../oauth';
import { isValidSpore } from '../config';
import { showAlertModal } from './confirm-modal';
import { getCollection } from '../config/nsid';

vi.mock('../at-client', () => ({
  getBacklinks: vi.fn(),
  getRecord: vi.fn(),
  listRecords: vi.fn(),
}));

vi.mock('../oauth', () => ({
  createRecord: vi.fn(),
}));

vi.mock('../config', () => ({
  isValidSpore: vi.fn(() => true),
}));

vi.mock('./confirm-modal', () => ({
  showAlertModal: vi.fn(),
}));

describe('special spore guardrails', () => {
  const now = new Date('2026-02-16T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.mocked(isValidSpore).mockImplementation((did: string) => did === 'did:plc:origin');
  });

  it('ignores implausible future-timestamp records when resolving holder', async () => {
    vi.mocked(getBacklinks).mockResolvedValue({
      records: [
        { did: 'did:plc:owner', collection: 'garden.spores.item.specialSpore', rkey: 'abc' },
      ],
    } as any);

    vi.mocked(getRecord).mockResolvedValue({
      value: {
        createdAt: '2026-02-16T12:20:00.000Z',
      },
    } as any);

    const result = await findSporeByOrigin('did:plc:origin');
    expect(result).toBeNull();
  });

  it('blocks rapid re-steals inside cooldown window', async () => {
    vi.mocked(getBacklinks).mockResolvedValue({
      records: [
        { did: 'did:plc:current-owner', collection: 'garden.spores.item.specialSpore', rkey: 'abc' },
      ],
    } as any);

    vi.mocked(getRecord).mockResolvedValue({
      value: {
        subject: 'did:plc:origin',
        createdAt: '2026-02-16T11:59:30.000Z',
      },
    } as any);

    await expect(
      stealSpore('did:plc:origin', 'did:plc:new-owner', 'current-owner')
    ).rejects.toThrow('just captured');

    expect(createRecord).not.toHaveBeenCalled();
    expect(showAlertModal).not.toHaveBeenCalled();
  });

  it('allows steals after cooldown and writes capture record', async () => {
    vi.mocked(getBacklinks).mockResolvedValue({
      records: [
        { did: 'did:plc:current-owner', collection: 'garden.spores.item.specialSpore', rkey: 'abc' },
      ],
    } as any);

    vi.mocked(getRecord).mockResolvedValue({
      value: {
        subject: 'did:plc:origin',
        createdAt: '2026-02-16T11:58:00.000Z',
      },
      uri: 'at://did:plc:current-owner/garden.spores.item.specialSpore/abc',
    } as any);

    vi.mocked(createRecord).mockResolvedValue({
      uri: 'at://did:plc:new-owner/garden.spores.item.specialSpore/xyz',
    } as any);

    await stealSpore('did:plc:origin', 'did:plc:new-owner', 'current-owner');

    const specialSporeCollection = getCollection('itemSpecialSpore');
    expect(createRecord).toHaveBeenCalledWith(specialSporeCollection, expect.objectContaining({
      $type: specialSporeCollection,
      subject: 'did:plc:origin',
    }));
    expect(showAlertModal).toHaveBeenCalled();
  });

  it('deduplicates held spores returned from old and new collections', async () => {
    vi.mocked(listRecords).mockResolvedValue({
      records: [
        {
          value: {
            subject: 'did:plc:origin',
          },
        },
      ],
    } as any);

    vi.mocked(getBacklinks).mockResolvedValue({
      records: [
        { did: 'did:plc:holder', collection: 'garden.spores.item.specialSpore', rkey: 'abc' },
      ],
    } as any);

    vi.mocked(getRecord).mockResolvedValue({
      value: {
        subject: 'did:plc:origin',
        createdAt: '2026-02-16T11:58:00.000Z',
      },
    } as any);

    const result = await findAllHeldSpores('did:plc:holder');

    expect(result).toEqual([
      expect.objectContaining({
        originGardenDid: 'did:plc:origin',
        currentOwnerDid: 'did:plc:holder',
      }),
    ]);
    expect(getBacklinks).toHaveBeenCalledTimes(2);
    expect(getRecord).toHaveBeenCalledTimes(2);
  });
});
