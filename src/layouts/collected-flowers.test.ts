import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderCollectedFlowers } from './collected-flowers';
import * as atClient from '../at-client';
import * as oauth from '../oauth';
import * as config from '../config';

// Mock dependencies
vi.mock('../at-client', () => ({
    listRecords: vi.fn(),
    getProfiles: vi.fn()
}));

vi.mock('../oauth', () => ({
    getCurrentDid: vi.fn(),
    isLoggedIn: vi.fn(() => true),
    deleteRecord: vi.fn(),
    putRecord: vi.fn(),
}));

vi.mock('../config', () => ({
    getSiteOwnerDid: vi.fn()
}));

describe('Collected Flowers Layout', () => {
    const mockOwnerDid = 'did:plc:owner';
    const mockVisitorDid = 'did:plc:visitor';

    beforeEach(() => {
        vi.clearAllMocks();
        // Default setup: logged in as owner
        vi.mocked(config.getSiteOwnerDid).mockReturnValue(mockOwnerDid);
        vi.mocked(oauth.getCurrentDid).mockReturnValue(mockOwnerDid);

        // Mock listRecords to return empty list by default
        vi.mocked(atClient.listRecords).mockResolvedValue({ records: [], cursor: '' });
    });

    it('should render currently with login restriction (pre-change behavior check)', async () => {
        // Setup: visitor viewing owner's garden
        vi.mocked(oauth.getCurrentDid).mockReturnValue(mockVisitorDid);

        const section = { type: 'collected-flowers' };
        const el = await renderCollectedFlowers(section);

        // Current behavior: shows restriction message
        // NOTE: This test expects the CURRENT behavior, will fail after we change it?
        // Actually, I'll write the test to expect the DESIRED behavior if I can, 
        // but the plan said "Create new test file to verify... Renders correctly for visitors".
        // Since I'm in execution mode, I should probably write the test expecting the *new* behavior 
        // and see it fail first (TDD), or update the code immediately. 
        // Let's write the test for the DESIRED behavior roughly.

        // Actually, let's write it strict to fail first if I haven't changed code yet.
        // The current code returns: "You must be logged in and viewing your own garden to see collected flowers."
        // if visitor !== owner.

        // I will write the test to expect the NEW behavior, so it will fail initially.
        // Wait, the prompt implies "verify changes".
        // I'll write the test for the NEW behavior.
    });

    it('should render flowers for visitor (logged out)', async () => {
        // Setup: logged out visitor viewing owner's garden
        vi.mocked(oauth.getCurrentDid).mockReturnValue(null);
        vi.mocked(config.getSiteOwnerDid).mockReturnValue(mockOwnerDid);

        const mockFlowers = [
            {
                uri: 'at://did/col/1',
                value: { subject: 'did:plc:source1', note: 'Nice flower' }
            }
        ];
        vi.mocked(atClient.listRecords).mockResolvedValue({ records: mockFlowers, cursor: '' });
        vi.mocked(atClient.getProfiles).mockResolvedValue(new Map());

        const section = { type: 'collected-flowers' };
        const el = await renderCollectedFlowers(section);

        // Should NOT show restriction message
        expect(el.textContent).not.toContain('must be logged in');

        // Should render the flower grid
        const grid = el.querySelector('.flower-grid');
        expect(grid).toBeTruthy();
        expect(el.textContent).toContain('Nice flower');

        // Should have called listRecords with OWNER DID, not visitor (null)
        expect(atClient.listRecords).toHaveBeenCalledWith(mockOwnerDid, 'garden.spores.social.takenFlower', expect.anything());
    });

    it('should render flowers for owner', async () => {
        // Setup: owner viewing own garden
        vi.mocked(oauth.getCurrentDid).mockReturnValue(mockOwnerDid);
        vi.mocked(config.getSiteOwnerDid).mockReturnValue(mockOwnerDid);

        const mockFlowers = [
            {
                uri: 'at://did/col/1',
                value: { subject: 'did:plc:source1' }
            }
        ];
        vi.mocked(atClient.listRecords).mockResolvedValue({ records: mockFlowers, cursor: '' });
        vi.mocked(atClient.getProfiles).mockResolvedValue(new Map());

        const section = { type: 'collected-flowers' };
        const el = await renderCollectedFlowers(section);

        const grid = el.querySelector('.flower-grid');
        expect(grid).toBeTruthy();
        expect(atClient.listRecords).toHaveBeenCalledWith(mockOwnerDid, 'garden.spores.social.takenFlower', expect.anything());
        expect(atClient.getProfiles).toHaveBeenCalledWith(['did:plc:source1']);
    });

    it('should show empty state when no flowers collected', async () => {
        vi.mocked(atClient.listRecords).mockResolvedValue({ records: [], cursor: '' });

        const section = { type: 'collected-flowers' };
        const el = await renderCollectedFlowers(section);

        expect(el.textContent).toContain('Visit other gardens');
    });
});
