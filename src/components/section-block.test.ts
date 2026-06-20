import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRecordsByUris } from '../records/loader';
import { getProfile } from '../at-client';
import { getSiteOwnerDid } from '../config';
import { renderRecord } from '../layouts/index';

vi.mock('../records/loader', () => ({
  getRecordByUri: vi.fn(),
  getRecordsByUris: vi.fn(),
}));

vi.mock('../config', () => ({
  getSiteOwnerDid: vi.fn(() => 'did:plc:test-owner'),
  getConfig: vi.fn(() => ({ sections: [] })),
  updateSection: vi.fn(),
  removeSection: vi.fn(),
  moveSectionUp: vi.fn(() => false),
  moveSectionDown: vi.fn(() => false),
  saveConfig: vi.fn(),
}));

vi.mock('../at-client', () => ({
  getProfile: vi.fn(),
  getRecord: vi.fn(),
  getBlobUrl: vi.fn(),
  parseAtUri: vi.fn(() => null),
}));

vi.mock('../oauth', () => ({
  deleteRecord: vi.fn(),
}));

vi.mock('../layouts/index', () => ({
  renderRecord: vi.fn(async () => {
    const el = document.createElement('article');
    el.className = 'rendered-record';
    return el;
  }),
}));

vi.mock('../layouts/collected-flowers', () => ({
  renderCollectedFlowers: vi.fn(async () => document.createElement('div')),
}));

vi.mock('../config/nsid', () => ({
  isContentImageCollection: vi.fn(() => false),
  isContentTextCollection: vi.fn(() => false),
  isProfileCollection: vi.fn(() => false),
}));

vi.mock('../utils/loading-states', () => ({
  createErrorMessage: vi.fn((message: string) => {
    const el = document.createElement('div');
    el.className = 'error';
    el.textContent = message;
    return el;
  }),
  createLoadingSpinner: vi.fn((message: string) => {
    const el = document.createElement('div');
    el.className = 'loading';
    el.textContent = message;
    return el;
  }),
}));

vi.mock('../utils/confirm-modal', () => ({
  showConfirmModal: vi.fn(),
}));

vi.mock('../utils/help-tooltip', () => ({
  createHelpTooltip: vi.fn(() => document.createElement('span')),
}));

vi.mock('../utils/markdown', () => ({
  renderMarkdown: vi.fn((value: string) => value),
}));

vi.mock('../utils/sanitize', () => ({
  sanitizeHtml: vi.fn((value: string) => value),
}));

vi.mock('./create-profile', () => ({}));
vi.mock('./create-image', () => ({}));

import './section-block';

describe('section-block re-render behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    vi.mocked(getSiteOwnerDid).mockReturnValue('did:plc:test-owner');
    vi.mocked(getRecordsByUris).mockResolvedValue([
      { uri: 'at://did:plc:test-owner/app.bsky.feed.post/1', value: { text: 'post' } },
    ] as any);
    vi.mocked(getProfile).mockResolvedValue({
      displayName: 'Test Gardener',
      description: 'Hello',
      avatar: null,
      banner: null,
    } as any);
    vi.mocked(renderRecord).mockImplementation(async () => {
      const el = document.createElement('article');
      el.className = 'rendered-record';
      return el;
    });
  });

  it('adds content-enter only on first records render', async () => {
    const el = document.createElement('section-block') as any;
    el.section = {
      id: 'records-1',
      type: 'records',
      layout: 'card',
      records: ['at://did:plc:test-owner/app.bsky.feed.post/1'],
    };

    await el.render();
    expect(el.querySelector('.record-grid')?.classList.contains('content-enter')).toBe(true);

    await el.render();
    expect(el.querySelector('.record-grid')?.classList.contains('content-enter')).toBe(false);
  });

  it('adds content-enter only on first profile render', async () => {
    const el = document.createElement('section-block') as any;
    el.section = {
      id: 'profile-1',
      type: 'profile',
      layout: 'profile',
    };

    await el.render();
    expect(el.querySelector('.rendered-record')?.classList.contains('content-enter')).toBe(true);

    await el.render();
    expect(el.querySelector('.rendered-record')?.classList.contains('content-enter')).toBe(false);
  });
});
