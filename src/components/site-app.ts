/**
 * spores.garden - Main Entry Point
 * Refactored to use modular components.
 */

import { initConfig, getConfig, getSiteOwnerDid } from '../config';
import { applyTheme } from '../themes/engine';
import { escapeHtml } from '../utils/sanitize';
import { SiteRouter } from './site-router';
import { SiteAuth } from './site-auth';
import { SiteEditor } from './site-editor';
import { SiteRenderer } from './site-renderer';
import { SiteInteractions } from './site-interactions';
import { SiteData } from './site-data';

// Styles
// Note: We don't import styles here as they are likely global or component-specific

class SiteApp extends HTMLElement {
  private auth: SiteAuth;
  private editor: SiteEditor;
  private renderer: SiteRenderer;
  private interactions: SiteInteractions;
  private data: SiteData;

  constructor() {
    super();

    // Define callbacks
    const renderCallback = () => this.renderer.render();
    const showNotification = (msg: string, type: 'success' | 'error' = 'success') =>
      this.renderer.showNotification(msg, type);

    // Initialize sub-components
    this.data = new SiteData(showNotification);

    this.interactions = new SiteInteractions(this, showNotification);

    this.editor = new SiteEditor(renderCallback, showNotification);

    this.auth = new SiteAuth(
      renderCallback,
      (type) => this.editor.showAddSectionModal(type),
      showNotification
    );

    this.renderer = new SiteRenderer(
      this,
      this.auth,
      this.editor,
      this.interactions,
      this.data
    );
  }

  async connectedCallback() {
    // Initial loading state
    this.innerHTML = `<div class="loading">${this.renderer.getLoadingMessage()}</div>`;

    window.addEventListener('auth-ready', async () => {
        try {
            // Set up event listeners (only once)
            this.setupEventListeners();

            // Set up client-side navigation (only once)
            this.setupClientSideNavigation();

            // Initial load: initialize config, theme, auth, and render
            await this.initializeAndRender(true);
        } catch (error) {
            console.error('Failed to initialize site:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.innerHTML = `
              <div class="error">
                <h2>Failed to load site</h2>
                <p>${escapeHtml(errorMessage)}</p>
                <button onclick="location.reload()">Try Again</button>
              </div>
            `;
        }
    });

    // Kick off auth initialization — dispatches 'auth-ready' when done
    try {
      await this.auth.init();
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    }
  }

  /**
   * Shared initialization and rendering logic.
   * Used for both initial load and navigation.
   * @param isInitialLoad - If true, also initializes auth and sets theme-ready flag
   */
  private async initializeAndRender(isInitialLoad = false): Promise<void> {
    // Show loading state
    this.innerHTML = `<div class="loading">${this.renderer.getLoadingMessage()}</div>`;
    
    // Initialize config with current URL params
    const config = await initConfig();

    // Always apply theme (including home page) so fonts-ready is set and text isn't hidden.
    // On the homepage, use default theme — never apply a garden's custom colors or background.
    // On navigation, don't block on font loading (big perf win when gardens use different fonts).
    const isGardenPage = SiteRouter.isViewingProfile();
    const did = isGardenPage ? getSiteOwnerDid() : undefined;

    // Prefetch spores now so the network request runs in parallel with font loading
    if (did) this.renderer.prefetchSpores(did);

    await applyTheme(isGardenPage ? config.theme : {}, { waitForFonts: isInitialLoad, did: did || undefined });
    
    // On initial load, set up theme-ready state
    if (isInitialLoad) {
      this.classList.add('theme-ready');
    }
    
    // Render with current config
    await this.renderer.render();

    // After first render, mark app as fully rendered to prevent re-triggering global animations
    if (isInitialLoad) {
      requestAnimationFrame(() => {
        this.classList.add('fully-rendered');
      });
    }
  }

  /**
   * Set up event listeners for config updates and user actions.
   * Only called once during initial load.
   */
  private setupEventListeners(): void {
    // Listen for config updates
    window.addEventListener('config-updated', async () => {
      const config = getConfig();
      // Only apply theme when viewing a garden page, not on home page
      if (SiteRouter.isViewingProfile()) {
        const did = getSiteOwnerDid();
        await applyTheme(config.theme, { did: did || undefined });
      }
      this.renderer.render();
    });

    // Listen for add section requests (e.g. from welcome modal or other parts)
    window.addEventListener('add-section', (e: Event) => {
      this.editor.editMode = true;
      this.editor.showAddSectionModal((e as CustomEvent).detail?.type);
      this.renderer.render();
    });

    // Listen for share to Bluesky requests
    window.addEventListener('share-to-bluesky', () => {
      this.interactions.shareToBluesky();
    });
  }

  /**
   * Handle navigation by reloading config and re-rendering.
   * Used for both programmatic navigation (click interception) and browser back/forward.
   */
  private async handleNavigation(): Promise<void> {
    try {
      this.editor.editMode = false;
      await this.initializeAndRender(false);
    } catch (error) {
      console.error('Failed to handle navigation:', error);
      // Fallback to full page reload on error
      location.reload();
    }
  }

  /**
   * Set up client-side navigation to prevent GitHub Pages 404 redirects.
   * Intercepts clicks on internal links (e.g., /@handle, /did:plc:...) and uses
   * history.pushState instead of full page navigation, preserving theme transitions.
   * Only called once during initial load.
   */
  private setupClientSideNavigation(): void {
    // Track pathname+search to detect real route changes vs hash-only popstate events
    let lastRoutePath = location.pathname + location.search;

    // Intercept clicks on internal links
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      // Don't intercept clicks on buttons, inputs, or other interactive elements
      // This ensures modals and forms work correctly
      if (
        target.tagName === 'BUTTON' ||
        target.tagName === 'INPUT' ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('select') ||
        target.closest('textarea')
      ) {
        return;
      }
      
      const link = target.closest('a');
      if (!link?.href) return;

      try {
        const url = new URL(link.href, location.origin);
        // Only intercept internal navigation (same origin)
        if (url.origin !== location.origin) return;

        // Never intercept hash-only anchor links (e.g. skip links, in-page anchors)
        if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

        const pathname = url.pathname;
        const search = url.search;

        // Check if this is an internal app route (garden navigation)
        // Canonical patterns: /@handle, /did:plc:..., or / (home).
        // Legacy query patterns are still supported for backwards compatibility.
        const isInternalRoute =
          pathname === '/' ||
          pathname.startsWith('/@') ||
          pathname.startsWith('/did:') ||
          search.includes('did=') ||
          search.includes('handle=');

        if (isInternalRoute) {
          e.preventDefault();
          // If the link lives inside a modal, close it before navigating.
          // Previously, full page navigation implicitly cleared modals.
          const modal = link.closest('.modal') as HTMLElement | null;
          modal?.remove();
          // Use pushState to update URL without page reload
          history.pushState(null, '', url.pathname + url.search);
          lastRoutePath = url.pathname + url.search;
          // Manually trigger navigation handler (pushState doesn't fire popstate)
          void this.handleNavigation();
        }
      } catch {
        // Invalid URL, let browser handle it normally
      }
    });

    // Handle browser back/forward buttons
    // pushState doesn't fire popstate; hash-only changes do — skip those
    window.addEventListener('popstate', () => {
      const routePath = location.pathname + location.search;
      if (routePath === lastRoutePath) return;
      lastRoutePath = routePath;
      this.handleNavigation();
    });
  }

  // Expose methods for console debugging/dev tools if needed
  public getComponents() {
    return {
      auth: this.auth,
      editor: this.editor,
      renderer: this.renderer,
      interactions: this.interactions,
      data: this.data
    };
  }
}

customElements.define('site-app', SiteApp);
