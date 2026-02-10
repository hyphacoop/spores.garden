import { getSiteOwnerDid } from '../config';
import { isLoggedIn, getCurrentDid, createRecord, uploadBlob, post } from '../oauth';
import { listRecords, getBacklinks, getProfile } from '../at-client';
import { setCachedActivity, registerGarden } from './recent-gardens';
import { escapeHtml } from '../utils/sanitize';
import { generateSocialCardImage } from '../utils/social-card';
import { renderFlowerBed } from '../layouts/flower-bed';

/**
 * Handles social interactions like planting flowers, picking flowers, and sharing.
 */
export class SiteInteractions {
    private app: HTMLElement;
    private showNotification: (msg: string, type?: 'success' | 'error') => void;

    constructor(
        app: HTMLElement,
        showNotification: (msg: string, type?: 'success' | 'error') => void
    ) {
        this.app = app;
        this.showNotification = showNotification;
    }

    async plantFlower() {
        if (!isLoggedIn()) {
            this.showNotification('You must be logged in to plant a flower.', 'error');
            return;
        }

        const ownerDid = getSiteOwnerDid();
        if (!ownerDid) {
            this.showNotification('Could not determine the garden owner.', 'error');
            return;
        }

        try {
            await createRecord('garden.spores.social.flower', {
                subject: ownerDid,
                createdAt: new Date().toISOString()
            });
            this.showNotification('You planted a flower!.', 'success');

            // Record local activity
            const currentDid = getCurrentDid();
            if (currentDid) {
                setCachedActivity(currentDid, 'flower', new Date());
                registerGarden(ownerDid);
            }

            // Refresh the header strip (create if it doesn't exist)
            const headerStrip = this.app.querySelector('.flower-bed.header-strip') as HTMLElement;
            const newHeaderStrip = await renderFlowerBed({}, true);

            if (newHeaderStrip) {
                if (headerStrip) {
                    // Replace the old header strip with the new one
                    headerStrip.replaceWith(newHeaderStrip);
                } else {
                    // Header strip doesn't exist yet, create it
                    const main = this.app.querySelector('main');
                    if (main) {
                        this.app.insertBefore(newHeaderStrip, main);
                    } else {
                        this.app.appendChild(newHeaderStrip);
                    }
                }
            } else if (headerStrip) {
                // If no flowers to show, remove the header strip
                headerStrip.remove();
            }

            // Remove the CTA button if it exists (user has now planted)
            const ctaButton = this.app.querySelector('.header-strip-cta') as HTMLElement;
            if (ctaButton) {
                ctaButton.remove();
            }
        } catch (error) {
            console.error('Failed to plant flower:', error);
            this.showNotification(`Failed to plant flower: ${error.message}`, 'error');
        }
    }

    async takeFlower() {
        if (!isLoggedIn()) {
            this.showNotification('You must be logged in to pick a flower.', 'error');
            return;
        }

        const ownerDid = getSiteOwnerDid();
        if (!ownerDid) {
            this.showNotification('Could not determine the garden owner.', 'error');
            return;
        }

        // Show modal to optionally add a note
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
      <div class="modal-content">
        <h2>Pick a flower</h2>
        <p>Collect a flower from this garden to plant in your own — visitors will see it in your garden and can follow it back here.</p>
        <form class="take-flower-form">
          <div class="form-group">
            <label for="flower-note">Note — this note will appear below the flower in your garden</label>
            <textarea 
              id="flower-note" 
              class="textarea" 
              placeholder="Optional"
              maxlength="500"
              rows="3"
            ></textarea>
          </div>
          <div class="modal-actions">
            <button type="submit" class="button button-primary">Pick a flower</button>
            <button type="button" class="button button-secondary modal-close">Cancel</button>
          </div>
        </form>
      </div>
    `;

        const form = modal.querySelector('.take-flower-form');
        const noteInput = modal.querySelector('#flower-note') as HTMLTextAreaElement;

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const note = noteInput.value.trim();

            modal.remove();

            try {
                const recordData: any = {
                    subject: ownerDid,
                    createdAt: new Date().toISOString()
                };

                // Only include note if provided
                if (note) {
                    recordData.note = note;
                }

                await createRecord('garden.spores.social.takenFlower', recordData);
                this.showNotification('Flower picked! View it in your Collected Flowers section.', 'success');

                // Record local activity
                const currentDid = getCurrentDid();
                if (currentDid) {
                    setCachedActivity(currentDid, 'seedling', new Date());
                    registerGarden(ownerDid);
                }

                // Update button state directly
                const btn = this.app.querySelector('.take-flower-btn') as HTMLButtonElement;
                if (btn) {
                    btn.textContent = 'Already picked';
                    btn.disabled = true;
                    btn.setAttribute('aria-label', 'You have already picked a flower from this garden');
                    btn.title = 'You have already picked a flower from this garden';
                }

                // Refresh any collected flowers sections
                const sections = this.app.querySelectorAll('section-block');
                sections.forEach(section => {
                    if (section.getAttribute('data-type') === 'collected-flowers') {
                        (section as any).render();
                    }
                });
            } catch (error) {
                console.error('Failed to pick flower:', error);
                this.showNotification(`Failed to pick flower: ${error.message}`, 'error');
            }
        });

        modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);
    }

    async shareToBluesky() {
        if (!isLoggedIn()) {
            this.showNotification('You must be logged in to share to Bluesky.', 'error');
            return;
        }

        const currentDid = getCurrentDid();
        if (!currentDid) {
            this.showNotification('Could not determine your DID.', 'error');
            return;
        }

        // Show share modal with preview
        this.showShareModal(currentDid);
    }

    async showShareModal(currentDid: string) {
        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal share-modal';
        modal.innerHTML = `
      <div class="modal-content" style="max-width: 800px;">
        <h2>Share on Bluesky</h2>
        <div class="share-modal-body">
          <div class="share-preview-loading">
            <div class="loading-spinner"></div>
            <p>Generating social card preview...</p>
          </div>
        </div>
        <div class="modal-actions">
          <button class="button button-primary share-confirm-btn" disabled>Share on Bluesky</button>
          <button class="button button-secondary modal-close">Cancel</button>
        </div>
      </div>
    `;

        const modalBody = modal.querySelector('.share-modal-body') as HTMLElement;
        const confirmBtn = modal.querySelector('.share-confirm-btn') as HTMLButtonElement;
        const closeBtn = modal.querySelector('.modal-close') as HTMLButtonElement;

        // Close handlers
        closeBtn.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.body.appendChild(modal);

        // Variables to store generated data for posting
        let imageBlob: Blob | null = null;
        let dataUrl: string | null = null;

        const BLUESKY_GRAPHEME_LIMIT = 300;
        const profile = await getProfile(currentDid).catch(() => null);
        const handle = (profile as { handle?: string } | null)?.handle;
        const gardenUrl = handle
            ? `${window.location.origin}/@${handle}`
            : window.location.origin;
        const shareLines = [
            `We all get a garden on spores.garden! ${gardenUrl}`,
            `Check out my unique garden on spores.garden! ${gardenUrl}`,
            `Grow your garden on spores.garden! ${gardenUrl}`,
            `Come see my garden on spores.garden! ${gardenUrl}`,
        ];
        const defaultText = shareLines[Math.floor(Math.random() * shareLines.length)];

        function countGraphemes(s: string): number {
            const segmenter = new (Intl as any).Segmenter('en', { granularity: 'grapheme' });
            return [...segmenter.segment(s)].length;
        }

        try {
            // Generate social card
            imageBlob = await generateSocialCardImage();

            // Convert blob to data URL for preview
            dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(imageBlob!);
            });

            // Show preview and editable post text
            modalBody.innerHTML = `
        <div class="share-preview">
          <img src="${dataUrl}" alt="Social card preview">
        </div>
        <div class="share-post-text">
          <label for="share-post-text-input">Post text</label>
          <div class="share-post-text-controls">
            <textarea
              id="share-post-text-input"
              class="textarea share-post-text-input"
              rows="3"
              maxlength="2000"
              placeholder="What will be posted with the image..."
            >${escapeHtml(defaultText)}</textarea>
            <div class="share-post-text-meta">
              <span class="share-post-text-count" data-count="">0</span>/300
              <button type="button" class="share-post-text-reset" hidden title="Reset to default">Reset</button>
            </div>
          </div>
          <p class="share-preview-hint">
            This text and the image above will be posted to your Bluesky feed.
          </p>
        </div>
      `;

            const textInput = modalBody.querySelector('#share-post-text-input') as HTMLTextAreaElement;
            const countEl = modalBody.querySelector('.share-post-text-count') as HTMLElement;
            const resetBtn = modalBody.querySelector('.share-post-text-reset') as HTMLButtonElement;

            function updateState() {
                const text = textInput.value;
                const count = countGraphemes(text);
                const isOverLimit = count > BLUESKY_GRAPHEME_LIMIT;
                const isModified = text !== defaultText;

                countEl.textContent = String(count);
                countEl.classList.toggle('over-limit', isOverLimit);
                resetBtn.hidden = !isModified;
                confirmBtn.disabled = isOverLimit;
            }

            textInput.addEventListener('input', updateState);
            resetBtn.addEventListener('click', () => {
                textInput.value = defaultText;
                updateState();
                textInput.focus();
            });

            updateState();
            textInput.focus();

        } catch (error) {
            console.error('Failed to generate social card preview:', error);
            modalBody.innerHTML = `
        <div class="share-error">
          <p style="color: var(--error-color);">Failed to generate preview: ${escapeHtml(error.message)}</p>
        </div>
      `;
            return;
        }

        // Handle confirm button click
        confirmBtn.addEventListener('click', async () => {
            if (!imageBlob) return;

            const textInput = modalBody.querySelector('#share-post-text-input') as HTMLTextAreaElement | null;
            const text = textInput?.value?.trim() || defaultText;

            // Show posting state
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Posting...';
            closeBtn.disabled = true;

            try {
                // 1. Upload image to Bluesky blob store
                const uploadedImage = await uploadBlob(imageBlob, 'image/png');

                // 2. Compose post
                const postRecord = {
                    $type: 'app.bsky.feed.post',
                    text: text,
                    createdAt: new Date().toISOString(),
                    embed: {
                        $type: 'app.bsky.embed.images',
                        images: [
                            {
                                alt: 'spores.garden social card',
                                image: uploadedImage.data.blob,
                            },
                        ],
                    },
                };

                // 3. Publish post
                const result = await post(postRecord) as { uri: string; cid: string };

                // 4. Show success with post URL
                // AT Protocol URI format: at://did/app.bsky.feed.post/rkey
                // Convert to Bluesky web URL: https://bsky.app/profile/did/post/rkey
                const uri = result.uri;
                const uriParts = uri.replace('at://', '').split('/');
                const postDid = uriParts[0];
                const postRkey = uriParts[2];
                const postUrl = `https://bsky.app/profile/${postDid}/post/${postRkey}`;

                modalBody.innerHTML = `
          <div class="share-success">
            <div style="text-align: center; padding: var(--spacing-lg);">
              <div style="font-size: 3em; margin-bottom: var(--spacing-md);">🎉</div>
              <h3 style="margin-bottom: var(--spacing-md);">Successfully shared!</h3>
              <p style="margin-bottom: var(--spacing-lg);">Your garden has been shared to Bluesky.</p>
              <a href="${postUrl}" target="_blank" rel="noopener noreferrer" class="button button-primary" style="display: inline-block; text-decoration: none;">
                View Post on Bluesky →
              </a>
            </div>
          </div>
        `;

                // Update modal actions
                const actionsDiv = modal.querySelector('.modal-actions') as HTMLElement;
                actionsDiv.innerHTML = `
          <button class="button button-secondary modal-close">Close</button>
        `;
                actionsDiv.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());

            } catch (error) {
                console.error('Failed to share to Bluesky:', error);
                modalBody.innerHTML = `
          <div class="share-error">
            <p style="color: var(--error-color);">Failed to share: ${escapeHtml(error.message)}</p>
          </div>
        `;
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Try Again';
                closeBtn.disabled = false;
            }
        });
    }

    /**
     * Check if current user has already planted a flower in the given garden
     */
    async checkHasPlantedFlower(ownerDid: string, currentDid: string | null): Promise<boolean> {
        if (!currentDid) return false;

        try {
            // 1. Check backlinks (cached/faster usually)
            const response = await getBacklinks(ownerDid, 'garden.spores.social.flower:subject', { limit: 100 });
            const plantedFlowers = response.records || response.links || [];
            const foundInBacklinks = plantedFlowers.some(flower => flower.did === currentDid);

            if (foundInBacklinks) return true;

            // 2. Check PDS directly (authoritative, handles indexer lag)
            const userFlowers = await listRecords(currentDid, 'garden.spores.social.flower', { limit: 50 });
            return userFlowers?.records?.some(r => r.value?.subject === ownerDid);
        } catch (error) {
            console.error('Failed to check planted flowers:', error);
            return false;
        }
    }

    /**
     * Check if current user has already picked a flower from the given garden
     */
    async checkHasPickedFlower(currentDid: string | null, ownerDid: string): Promise<boolean> {
        if (!currentDid) return false;

        try {
            const response = await listRecords(currentDid, 'garden.spores.social.takenFlower', { limit: 100 });
            const takenFlowers = response.records || [];
            return takenFlowers.some(record => record.value?.subject === ownerDid);
        } catch (error) {
            console.error('Failed to check if user picked a flower:', error);
            return false;
        }
    }
}
