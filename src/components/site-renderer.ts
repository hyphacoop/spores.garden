import { getConfig, getSiteOwnerDid, isOwner } from '../config';
import { isLoggedIn, getCurrentDid, logout } from '../oauth';
import { getProfile } from '../at-client';
import { escapeHtml } from '../utils/sanitize';
import { getSafeHandle, truncateDid } from '../utils/identity';
import { SiteRouter } from './site-router';
import { generateFlowerSVGString, generateSporeFlowerSVGString, generateMonochromeSporeFlowerSVGString } from '../utils/flower-svg';
import { showSporeDetailsModal } from './spore-modal';
import { renderFlowerBed } from '../layouts/flower-bed';
import type { SiteAuth } from './site-auth';
import type { SiteEditor } from './site-editor';
import type { SiteInteractions } from './site-interactions';
import type { SiteData } from './site-data';
import './recent-gardens';
import './section-block';
import { findAllHeldSpores } from '../utils/special-spore';
import { createHelpTooltip } from '../utils/help-tooltip';
import { getIsolineSVGStringForDid } from '../themes/isolines';

/**
 * Handles the main rendering logic for the site application.
 */
export class SiteRenderer {
    private app: HTMLElement;
    private auth: SiteAuth;
    private editor: SiteEditor;
    private interactions: SiteInteractions;
    private data: SiteData;
    private renderId = 0;
    private scrollHandler: (() => void) | null = null;
    private homepageBlobUrl: string | null = null;

    constructor(
        app: HTMLElement,
        auth: SiteAuth,
        editor: SiteEditor,
        interactions: SiteInteractions,
        data: SiteData
    ) {
        this.app = app;
        this.auth = auth;
        this.editor = editor;
        this.interactions = interactions;
        this.data = data;
    }

    async render() {
        if (this.homepageBlobUrl) {
            URL.revokeObjectURL(this.homepageBlobUrl);
            this.homepageBlobUrl = null;
        }
        const myRenderId = ++this.renderId;
        const config = getConfig() || {
            title: 'spores.garden',
            subtitle: '',
            sections: [],
            theme: {},
        };
        const ownerDid = getSiteOwnerDid();
        const isOwnerLoggedIn = isOwner();
        const isHomePage = !SiteRouter.isViewingProfile();

        // Show notification if a handle couldn't be found (user was redirected to homepage)
        if (config.handleNotFound) {
            // Use setTimeout to show notification after render completes
            const handle = config.handleNotFound;
            setTimeout(() => {
                this.showNotification(`Garden not found: @${handle}`, 'error');
            }, 100);
            // Clear the flag so we don't show it again on re-renders
            delete config.handleNotFound;
        }

        // Update favicon
        if (!isHomePage && ownerDid) {
            this.updateFavicon(ownerDid);
        } else if (isHomePage) {
            this.updateFavicon(null);
        }

        // On home page, always show default title/subtitle regardless of login state
        const displayTitle = isHomePage ? 'spores.garden' : (config.title || 'spores.garden');
        const displaySubtitle = isHomePage ? 'A personal ATProto website' : (config.subtitle || 'A personal ATProto website');

        // Update title and meta description
        document.title = displayTitle;
        const metaDescription = document.querySelector('#meta-description') as HTMLMetaElement;
        if (metaDescription) {
            metaDescription.content = displaySubtitle;
        }

        this.app.innerHTML = '';

        // Header with site title and controls
        const header = document.createElement('header');
        header.className = 'header';

        // Left group: home button + title/subtitle
        const leftGroup = document.createElement('div');
        leftGroup.className = 'header-left';
        leftGroup.style.display = 'flex';
        leftGroup.style.flexWrap = 'wrap';
        leftGroup.style.alignItems = 'self-start';
        leftGroup.style.gap = '1rem';

        // Home button with dandelion icon (home page) or owner's unique flower (garden pages)
        const homeButton = document.createElement('a');
        homeButton.href = '/';
        homeButton.className = 'home-button';
        homeButton.setAttribute('aria-label', 'Go to home page');
        homeButton.title = 'Go to home page';

        // On garden pages (not home), show owner's unique flower in monochrome
        if (!isHomePage && ownerDid) {
            homeButton.innerHTML = generateMonochromeSporeFlowerSVGString(ownerDid, 40);
        } else {
            homeButton.innerHTML = this.getDandelionIcon();
        }

        leftGroup.appendChild(homeButton);

        // Title and subtitle container
        const titleContainer = document.createElement('div');
        titleContainer.style.display = 'flex';
        titleContainer.style.flexDirection = 'column';

        // When in edit mode and owner is logged in, show editable inputs
        if (this.editor.editMode && isOwnerLoggedIn && !isHomePage) {
            // Editable title input
            const titleInput = document.createElement('input');
            titleInput.type = 'text';
            titleInput.className = 'site-title-input';
            titleInput.value = config.title || '';
            titleInput.placeholder = 'Site title';
            titleInput.maxLength = 100;
            titleInput.setAttribute('aria-label', 'Edit site title');
            titleInput.addEventListener('input', (e) => {
                const value = (e.target as HTMLInputElement).value;
                config.title = value;
            });
            titleContainer.appendChild(titleInput);

            // Editable subtitle input
            const subtitleInput = document.createElement('input');
            subtitleInput.type = 'text';
            subtitleInput.className = 'site-subtitle-input';
            subtitleInput.value = config.subtitle || '';
            subtitleInput.placeholder = 'Site subtitle';
            subtitleInput.maxLength = 200;
            subtitleInput.setAttribute('aria-label', 'Edit site subtitle');
            subtitleInput.addEventListener('input', (e) => {
                const value = (e.target as HTMLInputElement).value;
                config.subtitle = value;
            });
            titleContainer.appendChild(subtitleInput);
        } else {
            // Display mode - show static text
            const title = document.createElement('h1');
            title.className = 'site-title';
            title.textContent = displayTitle;
            titleContainer.appendChild(title);

            // Add subtitle as h2
            const subtitle = document.createElement('h2');
            subtitle.className = 'site-subtitle';
            subtitle.textContent = displaySubtitle;
            titleContainer.appendChild(subtitle);

            // Render Spores
            try {
                // We use findAllHeldSpores from utils/special-spore.ts
                // Note: The floating badge logic still exists at bottom, but we duplicate the *display* here for local user
                // The floating badge is for specific interactions (stealing), while this header one is for display/provenance.
                // However, the prompt says "Move the display... to the header".
                // If I render it here, I should make sure it looks good.

                if (ownerDid && !isHomePage) {
                    // Optimization: perform this check asynchronously and update DOM to avoid blocking render?
                    // However, for simplicity and ensuring it appears with header, we await it or allow it to pop in.
                    // Since render() is async, we can await it, but it might delay TTI.
                    // Let's fire it and append when ready to avoid blocking initial paint if possible, 
                    // but `render` is awaited by caller anyway.

                    findAllHeldSpores(ownerDid).then(spores => {
                        if (this.renderId !== myRenderId) return;
                        if (spores.length > 0) {
                            const sporesWrap = document.createElement('div');
                            sporesWrap.className = 'header-spores';
                            sporesWrap.style.display = 'flex';
                            sporesWrap.style.gap = '0.5rem';
                            // Zero margin top since it's now a sibling
                            sporesWrap.style.marginTop = '0';
                            sporesWrap.style.alignItems = 'center';

                            spores.forEach(spore => {
                                const sporeEl = document.createElement('div');
                                sporeEl.title = 'Special Spore';
                                sporeEl.dataset.originDid = spore.originGardenDid;
                                sporeEl.style.cursor = 'pointer';
                                sporeEl.style.width = '60px';
                                sporeEl.style.height = '60px';
                                sporeEl.style.flexShrink = '0';
                                sporeEl.innerHTML = generateSporeFlowerSVGString(spore.originGardenDid, 60);

                                sporeEl.addEventListener('click', (e) => {
                                    e.stopPropagation();
                                    showSporeDetailsModal(spore.originGardenDid);
                                });

                                sporesWrap.appendChild(sporeEl);
                            });

                            leftGroup.appendChild(sporesWrap);
                        }
                    });
                }
            } catch (err) {
                console.error("Failed to load header spores", err);
            }
        }

        leftGroup.appendChild(titleContainer);
        header.appendChild(leftGroup);

        // Controls
        const controls = document.createElement('div');
        controls.className = 'controls';

        const isViewingProfile = SiteRouter.isViewingProfile();

        if (isLoggedIn()) {
            if (isOwnerLoggedIn && !isHomePage) {
                // Edit/Save mode toggle
                const editBtn = document.createElement('button');
                editBtn.className = this.editor.editMode ? 'button button-primary' : 'button button-secondary';
                editBtn.textContent = this.editor.editMode ? 'Save' : 'Edit';
                editBtn.setAttribute('aria-label', this.editor.editMode ? 'Save changes and exit edit mode' : 'Enter edit mode');
                editBtn.setAttribute('aria-pressed', this.editor.editMode.toString());
                editBtn.addEventListener('click', () => this.editor.editMode ? this.editor.saveAndExitEdit() : this.editor.toggleEditMode());
                controls.appendChild(editBtn);

                // Fonts button (only in edit mode)
                if (this.editor.editMode) {
                    const fontBtn = document.createElement('button');
                    fontBtn.className = 'button button-secondary';
                    fontBtn.textContent = 'Fonts';
                    fontBtn.addEventListener('click', () => {
                        import('./font-modal').then(m => m.showFontModal());
                    });
                    controls.appendChild(fontBtn);
                }

                // Share on Bluesky button
                const shareBtn = document.createElement('button');
                shareBtn.className = 'button button-secondary';
                shareBtn.textContent = 'Share on Bluesky';
                shareBtn.setAttribute('aria-label', 'Share your garden to Bluesky');
                shareBtn.addEventListener('click', () => this.interactions.shareToBluesky());
                controls.appendChild(shareBtn);
            } else if (isHomePage) {
                // On home page when logged in, show "View My Garden" button
                const currentDid = getCurrentDid();
                if (currentDid) {
                    const viewMyGardenBtn = document.createElement('button');
                    viewMyGardenBtn.className = 'button button-primary';
                    viewMyGardenBtn.textContent = 'View My Garden';
                    viewMyGardenBtn.setAttribute('aria-label', 'Go to your garden');
                    viewMyGardenBtn.addEventListener('click', () => {
                        void SiteRouter.navigateToGardenDid(currentDid);
                    });
                    controls.appendChild(viewMyGardenBtn);
                }
            } else if (!isOwnerLoggedIn && isViewingProfile) {
                // Check if user already picked a flower from this garden
                const currentDid = getCurrentDid();
                const hasPickedFlower = await this.interactions.checkHasPickedFlower(currentDid, ownerDid!);

                // Guard against race conditions
                if (this.renderId !== myRenderId) return;

                // "View My Garden" button for visitors
                if (currentDid) {
                    const viewMyGardenBtn = document.createElement('button');
                    viewMyGardenBtn.className = 'button button-secondary';
                    viewMyGardenBtn.textContent = 'My Garden';
                    viewMyGardenBtn.setAttribute('aria-label', 'Go to your garden');
                    viewMyGardenBtn.addEventListener('click', () => {
                        void SiteRouter.navigateToGardenDid(currentDid);
                    });
                    controls.appendChild(viewMyGardenBtn);
                }

                // "Pick a flower" button for visitors (only when not yet collected)
                if (!hasPickedFlower) {
                    const takeFlowerBtn = document.createElement('button');
                    takeFlowerBtn.className = 'button button-secondary take-flower-btn';
                    takeFlowerBtn.textContent = 'Pick a flower';
                    takeFlowerBtn.setAttribute('aria-label', 'Pick a flower from this garden to plant in your own');
                    takeFlowerBtn.title = 'Collect a flower from this garden to plant in your own';
                    takeFlowerBtn.addEventListener('click', () => this.interactions.takeFlower());
                    controls.appendChild(takeFlowerBtn);
                }
            }

            // Logout button
            const logoutBtn = document.createElement('button');
            logoutBtn.className = 'button button-ghost';
            logoutBtn.textContent = 'Logout';
            logoutBtn.setAttribute('aria-label', 'Log out of your account');
            logoutBtn.addEventListener('click', () => {
                logout();
                this.render();
            });
            controls.appendChild(logoutBtn);
        } else {
            // Login button
            const loginBtn = document.createElement('button');
            loginBtn.className = 'button';
            loginBtn.textContent = 'Login';
            loginBtn.setAttribute(
                'aria-label',
                isViewingProfile ? 'Log in to interact with this garden' : 'Log in with AT Protocol'
            );
            loginBtn.addEventListener('click', () => this.auth.showLoginModal());
            controls.appendChild(loginBtn);
        }

        // Mobile menu toggle button (hamburger)
        const menuToggle = document.createElement('button');
        menuToggle.className = 'mobile-menu-toggle';
        menuToggle.setAttribute('aria-label', 'Toggle menu');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/>
        <line x1="3" y1="12" x2="21" y2="12"/>
        <line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    `;

        menuToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = controls.classList.toggle('open');
            menuToggle.setAttribute('aria-expanded', isOpen.toString());
            // Toggle between hamburger and X icon
            menuToggle.innerHTML = isOpen ? `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="6" y1="6" x2="18" y2="18"/>
          <line x1="6" y1="18" x2="18" y2="6"/>
        </svg>
      ` : `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      `;
        });

        const closeMenu = () => {
            controls.classList.remove('open');
            menuToggle.setAttribute('aria-expanded', 'false');
            menuToggle.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        `;
        };

        // Close menu when clicking outside
        const closeMenuOnClickOutside = (e: Event) => {
            if (!header.contains(e.target as Node) && controls.classList.contains('open')) {
                closeMenu();
            }
        };
        document.addEventListener('click', closeMenuOnClickOutside);

        header.appendChild(menuToggle);
        header.appendChild(controls);
        this.app.appendChild(header);

        // Hide header on scroll down, reveal on scroll up
        if (this.scrollHandler) window.removeEventListener('scroll', this.scrollHandler);
        let lastScrollY = window.scrollY;
        this.scrollHandler = () => {
            const currentScrollY = window.scrollY;
            const hiding = currentScrollY > lastScrollY && currentScrollY > 80;
            header.classList.toggle('header--hidden', hiding);
            if (hiding) closeMenu();
            lastScrollY = currentScrollY;
        };
        window.addEventListener('scroll', this.scrollHandler, { passive: true });

        // Flower bed header strip (shows visitor flowers under header)
        if (!isHomePage) {
            this.renderFlowerBedHeaderStrip(myRenderId, ownerDid, isOwnerLoggedIn);
        }

        // Main content
        const main = document.createElement('main');
        main.className = 'main';
        main.id = 'main-content';
        main.tabIndex = -1;

        const sections = config.sections || [];

        if (isHomePage) {
            main.classList.add('is-homepage');
            // Home page view
            const homepageView = document.createElement('div');
            homepageView.className = 'homepage-view';

            // Monochrome isoline contour on the page body
            const root = document.documentElement;
            const isoW = document.documentElement.clientWidth || 1200;
            const isoH = document.documentElement.clientHeight || 800;
            const isoSvg = getIsolineSVGStringForDid(
                'did:web:spores.garden',
                { background: '#ffffff', text: '#000000' },
                isoW, isoH
            );
            const isoBlob = new Blob([isoSvg], { type: 'image/svg+xml' });
            const isoUrl = URL.createObjectURL(isoBlob);
            this.homepageBlobUrl = isoUrl; // tracked for cleanup on next render
            root.style.setProperty('--pattern-background', `url("${isoUrl}")`);
            root.style.setProperty('--pattern-width', `${isoW}px`);
            root.style.setProperty('--pattern-height', `${isoH}px`);
            document.body.classList.add('has-pattern');

            // Hero section
            const hero = document.createElement('div');
            hero.className = 'homepage-hero';

            const loggedIn = isLoggedIn();

            // Personalised greeting for logged-in users
            if (loggedIn) {
                const currentDid = getCurrentDid();
                if (currentDid) {
                    const greeting = document.createElement('p');
                    greeting.className = 'homepage-hero__greeting';
                    greeting.textContent = 'Welcome back!';
                    hero.appendChild(greeting);

                    this.data.getDisplayNameForDid(currentDid).then(displayName => {
                        if (displayName && this.renderId === myRenderId) {
                            greeting.textContent = `Welcome back, ${displayName}!`;
                        }
                    });
                }
            }

            if (!loggedIn) {
                const heading = document.createElement('h2');
                heading.className = 'homepage-hero__heading';
                heading.textContent = 'Your garden is waiting for you!';
                hero.appendChild(heading);
            }

            // Feature list
            const features = document.createElement('ul');
            features.className = 'homepage-features';
            const featureItems = [
                'Plant your ideas from across the Atmosphere',
                'Explore a neighbourhood of interconnected gardens',
                'Collect and leave flowers for other gardeners to follow',
            ];
            for (const text of featureItems) {
                const li = document.createElement('li');
                li.className = 'homepage-features__item';
                li.textContent = text;
                features.appendChild(li);
            }
            hero.appendChild(features);

            // Teaser
            const teaser = document.createElement('p');
            teaser.className = 'homepage-teaser';
            teaser.textContent = 'Can you find a special spore hiding amongst the gardens?';
            hero.appendChild(teaser);

            // Login CTA (only if not logged in)
            if (!loggedIn) {
                const loginBtn = document.createElement('button');
                loginBtn.className = 'button';
                loginBtn.textContent = 'Log in to start gardening';
                loginBtn.addEventListener('click', () => this.auth.showLoginModal());
                hero.appendChild(loginBtn);
            }

            homepageView.appendChild(hero);

            // Recent gardens
            const recentGardens = document.createElement('recent-gardens');
            recentGardens.setAttribute('data-limit', '12');
            recentGardens.setAttribute('data-show-empty', 'true');
            recentGardens.style.marginTop = 'var(--spacing-xl)';
            recentGardens.style.textAlign = 'left';
            homepageView.appendChild(recentGardens);

            const footer = document.createElement('footer');
            footer.className = 'footer';
            footer.innerHTML = 'Made with 🌱 by <a class="hypha-credit-link" href="https://bsky.app/profile/hypha.coop" target="_blank" rel="noopener noreferrer">Hypha Coop</a>';
            homepageView.appendChild(footer);

            main.appendChild(homepageView);
        } else if (sections.length === 0 && !this.editor.editMode) {
            // Garden preview: theme + flower + CTA when no sections (no config or empty garden)
            const preview = document.createElement('div');
            preview.className = 'garden-preview';

            const flowerBox = document.createElement('div');
            flowerBox.className = 'garden-preview__flower-box';

            const heading = document.createElement('h2');
            heading.className = 'garden-preview__heading';
            heading.textContent = "A garden could grow here.";
            flowerBox.appendChild(heading);

            const flowerSize = 140;
            const svgWrapper = document.createElement('div');
            svgWrapper.className = 'garden-preview__flower-svg';
            if (ownerDid) {
                svgWrapper.innerHTML = generateFlowerSVGString(ownerDid, flowerSize);
            } else {
                svgWrapper.innerHTML = this.getDandelionIcon();
            }
            flowerBox.appendChild(svgWrapper);

            const subtext = document.createElement('p');
            subtext.className = 'garden-preview__subtext';
            subtext.textContent = "If this is your identity, you can login and claim your flower.";
            flowerBox.appendChild(subtext);

            if (isOwnerLoggedIn) {
                const editHint = document.createElement('p');
                editHint.className = 'garden-preview__hint';
                const editBtn = document.createElement('button');
                editBtn.className = 'button button-primary';
                editBtn.textContent = 'Edit';
                editBtn.addEventListener('click', () => this.editor.toggleEditMode());
                editHint.appendChild(document.createTextNode('Click '));
                editHint.appendChild(editBtn);
                editHint.appendChild(document.createTextNode(' to add sections and start gardening.'));
                flowerBox.appendChild(editHint);
            } else {
                const loginBtn = document.createElement('button');
                loginBtn.className = 'button button-primary';
                loginBtn.textContent = 'Login';
                loginBtn.setAttribute('aria-label', 'Log in to claim your garden');
                loginBtn.addEventListener('click', () => this.auth.showLoginModal());
                flowerBox.appendChild(loginBtn);
            }

            preview.appendChild(flowerBox);

            main.appendChild(preview);

            // Resolve handle for heading: "@handle's garden could grow here"
            if (ownerDid) {
                getProfile(ownerDid).then((profile) => {
                    if (this.renderId !== myRenderId) return;
                    const safeHandle = getSafeHandle(profile?.handle, ownerDid);
                    const displayHandle = safeHandle === ownerDid ? truncateDid(ownerDid) : `@${safeHandle}`;
                    heading.textContent = `${displayHandle}'s garden could grow here`;
                }).catch(() => { /* keep fallback heading */ });
            }
        } else {
            // Viewing a profile with sections
            // Filter out deprecated section types (they're handled elsewhere)
            const activeSections = sections.filter(section => {
                // flower-bed sections are now rendered as a header strip, skip them here
                return section.type !== 'flower-bed';
            });

            for (const section of activeSections) {
                const sectionEl = document.createElement('section-block');
                sectionEl.setAttribute('data-section', JSON.stringify(section));
                sectionEl.setAttribute('data-edit-mode', (this.editor.editMode && isOwnerLoggedIn).toString());

                sectionEl.addEventListener('share-to-bluesky', () => {
                    this.interactions.shareToBluesky();
                });

                main.appendChild(sectionEl);
            }
        }

        // Add section button in edit mode
        if (this.editor.editMode && isOwnerLoggedIn && !isHomePage) {
            const addBtn = document.createElement('button');
            addBtn.className = 'add-section';
            addBtn.textContent = '+ Add Section';
            addBtn.setAttribute('aria-label', 'Add a new section to your garden');
            addBtn.addEventListener('click', () => this.editor.showAddSectionModal());
            main.appendChild(addBtn);

            const saveBar = document.createElement('div');
            saveBar.className = 'save-bar';
            const saveBtn = document.createElement('button');
            saveBtn.className = 'button button-primary save-btn';
            saveBtn.textContent = 'Save Changes';
            saveBtn.setAttribute('aria-label', 'Save your changes and exit edit mode');
            saveBtn.addEventListener('click', () => this.editor.saveAndExitEdit());
            saveBar.appendChild(saveBtn);
            main.appendChild(saveBar);
        }

        this.app.appendChild(main);

        // Dev tool reset button
        const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        if (isLocalDev && isLoggedIn()) {
            const devTools = document.createElement('div');
            devTools.className = 'dev-tools';

            const devBackupBtn = document.createElement('button');
            devBackupBtn.className = 'dev-tool-button dev-tool-button-backup';
            devBackupBtn.textContent = 'Back Up Garden Data';
            devBackupBtn.setAttribute('aria-label', 'Download a JSON backup of your spores garden records (dev only)');
            devBackupBtn.title = 'Download backup JSON';
            devBackupBtn.addEventListener('click', () => this.data.backupGardenData());
            devTools.appendChild(devBackupBtn);

            const devResetBtn = document.createElement('button');
            devResetBtn.className = 'dev-tool-button dev-tool-button-reset';
            devResetBtn.textContent = 'Reset Garden Data';
            devResetBtn.setAttribute('aria-label', 'Delete all garden.spores.* localStorage and PDS records (dev only)');
            devResetBtn.title = 'Delete all garden.spores.* localStorage and PDS records';
            devResetBtn.addEventListener('click', () => this.data.resetGardenData());
            devTools.appendChild(devResetBtn);

            const devRestoreBtn = document.createElement('button');
            devRestoreBtn.className = 'dev-tool-button dev-tool-button-restore';
            devRestoreBtn.textContent = 'Restore Garden Data';
            devRestoreBtn.setAttribute('aria-label', 'Restore garden records from a backup JSON file (dev only)');
            devRestoreBtn.title = 'Restore from backup JSON';
            devRestoreBtn.addEventListener('click', () => this.data.restoreGardenDataFromFile());
            devTools.appendChild(devRestoreBtn);

            this.app.appendChild(devTools);
        }
    }

    /**
     * Renders the flower bed header strip (shows visitor flowers under header).
     * This replaces the old flower-bed section type.
     */
    private renderFlowerBedHeaderStrip(
        myRenderId: number,
        ownerDid: string | null,
        isOwnerLoggedIn: boolean
    ): void {
        if (!ownerDid) return;

        // Render asynchronously to avoid blocking the main render
        renderFlowerBed({}, true).then(async flowerBedStrip => {
            // Guard against race conditions
            if (this.renderId !== myRenderId) return;

            // Check if we should show the "Plant a flower" CTA
            // Only for logged-in visitors who haven't planted yet
            const canShowPlantCTA = isLoggedIn() && !isOwnerLoggedIn && ownerDid;

            if (canShowPlantCTA) {
                const currentDid = getCurrentDid();
                const hasPlantedFlower = await this.interactions.checkHasPlantedFlower(ownerDid, currentDid);

                // Guard against race conditions after async check
                if (this.renderId !== myRenderId) return;

                if (!hasPlantedFlower) {
                    // Create the flower bed strip if it doesn't exist (no visitors yet)
                    if (!flowerBedStrip) {
                        flowerBedStrip = document.createElement('div');
                        flowerBedStrip.className = 'flower-bed header-strip';
                        const grid = document.createElement('div');
                        grid.className = 'flower-grid';
                        flowerBedStrip.appendChild(grid);
                    }

                    // Create the CTA button
                    const plantCTA = document.createElement('button');
                    plantCTA.className = 'button button-small header-strip-cta';
                    plantCTA.textContent = 'Plant your flower';
                    plantCTA.setAttribute('aria-label', 'Plant your flower in this garden');
                    plantCTA.title = 'Leave your unique flower in this garden';
                    plantCTA.addEventListener('click', () => this.interactions.plantFlower());

                    const plantHelp = createHelpTooltip(
                        'Leave your flower to show you\u2019ve been here! Others will be able to see it and follow it back to your garden.'
                    );

                    // Add CTA to the flower grid
                    const grid = flowerBedStrip.querySelector('.flower-grid');
                    if (grid) {
                        grid.appendChild(plantCTA);
                        grid.appendChild(plantHelp);
                    }
                }
            }

            if (flowerBedStrip) {
                // Insert after header, before main
                const main = this.app.querySelector('main');
                if (main) {
                    this.app.insertBefore(flowerBedStrip, main);
                } else {
                    this.app.appendChild(flowerBedStrip);
                }
            }
        }).catch(err => {
            console.error('Failed to render flower bed header strip:', err);
        });
    }

    showNotification(message: string, type: 'success' | 'error' = 'success') {
        const existing = document.querySelector('.notification');
        if (existing) {
            existing.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${escapeHtml(message)}</span>
        <button class="notification-close" aria-label="Close">×</button>
      </div>
    `;

        notification.querySelector('.notification-close')?.addEventListener('click', () => {
            notification.remove();
        });

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                setTimeout(() => notification.remove(), 200);
            }
        }, 3000);
    }

    getLoadingMessage(): string {
        return 'Loading spores...';
    }

    private updateFavicon(did: string | null): void {
        let svgString: string;

        if (!did) {
            svgString = this.getDandelionIcon();
        } else {
            svgString = generateFlowerSVGString(did, 32);
        }

        const dataUri = `data:image/svg+xml;base64,${btoa(svgString)}`;

        let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
        if (link) {
            link.href = dataUri;
        } else {
            link = document.createElement('link');
            link.rel = 'icon';
            link.href = dataUri;
            document.head.appendChild(link);
        }
    }

    private getDandelionIcon(): string {
        const color = '#4a7c59';
        return `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" class="dandelion-icon">
       <path d="M20 38 Q19 30 20 22" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
       <circle cx="20" cy="12" r="3" fill="${color}"/>
       <g stroke="${color}" stroke-width="0.8" stroke-linecap="round">
         <line x1="20" y1="12" x2="20" y2="2"/>
         <circle cx="20" cy="1.5" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="27" y2="4"/>
         <circle cx="27.5" cy="3.5" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="30" y2="10"/>
         <circle cx="30.5" cy="10" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="28" y2="18"/>
         <circle cx="28.5" cy="18.5" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="13" y2="4"/>
         <circle cx="12.5" cy="3.5" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="10" y2="10"/>
         <circle cx="9.5" cy="10" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="12" y2="18"/>
         <circle cx="11.5" cy="18.5" r="1" fill="${color}"/>
         <line x1="20" y1="12" x2="24" y2="3"/>
         <circle cx="24.5" cy="2.5" r="0.8" fill="${color}"/>
         <line x1="20" y1="12" x2="16" y2="3"/>
         <circle cx="15.5" cy="2.5" r="0.8" fill="${color}"/>
         <line x1="20" y1="12" x2="29" y2="14"/>
         <circle cx="29.5" cy="14" r="0.8" fill="${color}"/>
         <line x1="20" y1="12" x2="11" y2="14"/>
         <circle cx="10.5" cy="14" r="0.8" fill="${color}"/>
       </g>
       <g transform="translate(32, 6)" opacity="0.6">
         <line x1="0" y1="3" x2="0" y2="0" stroke="${color}" stroke-width="0.5"/>
         <circle cx="0" cy="0" r="0.8" fill="${color}"/>
       </g>
     </svg>`;
    }
}
