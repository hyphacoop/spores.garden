import { setSiteOwnerDid, loadUserConfig, hasUserConfig, getSiteOwnerDid, hasGardenIdentifierInUrl } from '../config';
import { initOAuth, login, getCurrentDid } from '../oauth';
import { ATPROTO_GRANULAR_SCOPE } from '../oauth-scope';
import { applyTheme } from '../themes/engine';
import { SiteRouter } from './site-router';
import type { WelcomeModalElement, WelcomeAction } from '../types';
import './welcome-modal';

/**
 * Manages authentication state and onboarding flow.
 */
export class SiteAuth {
    private hasShownWelcome = false;
    private renderCallback: () => void;
    private showAddSectionModalCallback: (preferredType?: string) => void;
    private showNotification?: (msg: string, type?: 'success' | 'error') => void;

    constructor(
        renderCallback: () => void,
        showAddSectionModalCallback: (preferredType?: string) => void,
        showNotification?: (msg: string, type?: 'success' | 'error') => void
    ) {
        this.renderCallback = renderCallback;
        this.showAddSectionModalCallback = showAddSectionModalCallback;
        this.showNotification = showNotification;
    }

    /**
     * Initializes OAuth and sets up auth event listeners.
     */
    async init() {
        // For local dev, AT Protocol uses a special loopback client_id format
        const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        const redirectUri = `${location.origin}/`;
        const scope = ATPROTO_GRANULAR_SCOPE;

        const clientId = isLocalDev
            ? `http://localhost?redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}`
            : `${location.origin}/client-metadata.json`;

        // Listen for auth changes
        window.addEventListener('auth-change', async (e: Event) => {
            const detail = (e as CustomEvent).detail;
            await this.handleAuthChange(detail);
        });

        await initOAuth({
            oauth: {
                clientId,
                redirectUri,
                scope
            }
        });
    }

    private async handleAuthChange(detail: any) {
        // Session expired (401/403 from PDS): show message and rely on auth-change to re-render logged out
        if (detail?.reason === 'expired' && this.showNotification) {
            this.showNotification('Session expired. Please log in again.', 'error');
        }

        // If user logged in and no site owner set (home page), they become the owner
        const currentSiteOwner = getSiteOwnerDid();

        if (detail?.loggedIn && detail?.did && !currentSiteOwner && !hasGardenIdentifierInUrl()) {
            // Try to load existing config for this user
            const existingConfig = await loadUserConfig(detail.did);

            if (existingConfig) {
                // User has existing config - set as owner and don't show welcome
                setSiteOwnerDid(detail.did);

                if (SiteRouter.isViewingProfile() && getSiteOwnerDid() === detail.did) {
                    await applyTheme(existingConfig.theme, { did: detail.did });
                }

            } else {
                // New user - set as owner and show welcome
                setSiteOwnerDid(detail.did);
                // Check if user has completed onboarding before (localStorage backup)
                const hasCompletedOnboarding = this.hasCompletedOnboarding(detail.did);
                // Also check PDS as primary source of truth
                const hasConfig = await hasUserConfig(detail.did);

                // Show welcome modal only for truly new users
                if (!this.hasShownWelcome && !hasCompletedOnboarding && !hasConfig) {
                    this.showWelcome();
                    this.hasShownWelcome = true;
                }
            }
        }

        this.renderCallback();
    }

    showLoginModal() {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
      <div class="modal-content login-modal-content" role="dialog" aria-modal="true" aria-labelledby="login-modal-title">
        <h2 id="login-modal-title">Log in with Bluesky or ATProto</h2>
        <form class="login-form">
          <label for="login-handle" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;">Your Bluesky handle or domain</label>
          <input id="login-handle" type="text" placeholder="your.handle.com" class="input" required>
          <button type="submit" class="button">Log in</button>
        </form>
        <button class="button button-secondary modal-close">Cancel</button>
      </div>
    `;

        const closeModal = () => {
            document.removeEventListener('keydown', handleKeydown);
            modal.remove();
        };

        const handleKeydown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeModal();
        };

        modal.querySelector('form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = modal.querySelector('input');
            const handle = input ? input.value.trim() : '';
            if (handle) {
                closeModal();
                await login(handle);
            }
        });

        modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        document.addEventListener('keydown', handleKeydown);
        document.body.appendChild(modal);
        modal.querySelector<HTMLInputElement>('input')?.focus();
    }

    showWelcome() {
        // Check if any other modal is currently open
        const activeModals = document.querySelectorAll('.modal');
        if (activeModals.length > 0) {
            console.warn('Attempted to show welcome modal while other modals are active. Aborting.');
            return;
        }

        const welcome = document.createElement('welcome-modal') as WelcomeModalElement;
        welcome.setOnClose(() => {
            // Mark onboarding complete when welcome modal closes
            const currentDid = getCurrentDid();
            if (currentDid) {
                this.markOnboardingComplete(currentDid);
            }
            this.renderCallback();
        });
        document.body.appendChild(welcome);
    }

    handleWelcomeAction(action: WelcomeAction) {
        // Create a welcome component and trigger the appropriate action
        const welcome = document.createElement('welcome-modal') as WelcomeModalElement;
        welcome.setOnClose(() => {
            this.renderCallback();
        });
        welcome.setOnBack(() => {
            welcome.remove();
            this.showAddSectionModalCallback();
        });
        document.body.appendChild(welcome);

        // Trigger the action after component is connected
        setTimeout(() => {
            welcome.triggerAction(action);
        }, 10);
    }

    private hasCompletedOnboarding(did: string): boolean {
        try {
            return localStorage.getItem(`spores.garden.hasCompletedOnboarding.${did}`) === 'true';
        } catch (error) {
            console.warn('Failed to check onboarding status from localStorage:', error);
            return false;
        }
    }

    private markOnboardingComplete(did: string): void {
        try {
            localStorage.setItem(`spores.garden.hasCompletedOnboarding.${did}`, 'true');
        } catch (error) {
            console.warn('Failed to save onboarding status to localStorage:', error);
        }
    }
}
