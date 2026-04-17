/**
 * Section container component.
 * Renders sections based on type (records, content, profile).
 * Provides edit controls for section management.
 */

import { getRecordByUri, getRecordsByUris } from '../records/loader';
import { getSiteOwnerDid, getConfig, updateSection, removeSection, moveSectionUp, moveSectionDown, saveConfig } from '../config';
import { getProfile, getRecord, getBlobUrl, parseAtUri } from '../at-client';
import { deleteRecord } from '../oauth';
import { renderRecord } from '../layouts/index';
import { renderCollectedFlowers } from '../layouts/collected-flowers';
import { isContentImageCollection, isContentTextCollection, isProfileCollection } from '../config/nsid';
import { createErrorMessage, createLoadingSpinner } from '../utils/loading-states';
import { showConfirmModal } from '../utils/confirm-modal';
import { createHelpTooltip } from '../utils/help-tooltip';
import { renderMarkdown } from '../utils/markdown';
import { sanitizeHtml } from '../utils/sanitize';
import './create-profile'; // Register profile editor component
import './create-image'; // Register image editor component

class SectionBlock extends HTMLElement {
  section: any;
  editMode: boolean;
  renderToken: number;
  constructor() {
    super();
    this.section = null;
    this.editMode = false;
    this.renderToken = 0;
  }

  static get observedAttributes() {
    return ['data-section', 'data-edit-mode'];
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name === 'data-section') {
      try {
        this.section = JSON.parse(newValue);
      } catch {
        this.section = null;
      }
    }
    if (name === 'data-edit-mode') {
      this.editMode = newValue === 'true';
    }
    this.render();
  }

  connectedCallback() {
    this.render();
  }

  async render() {
    const token = ++this.renderToken;
    this.classList.remove('section-ready');
    if (!this.section) {
      this.replaceChildren();
      this.innerHTML = '<div class="error">Invalid section</div>';
      this.classList.add('section-ready');
      return;
    }

    const fragment = document.createDocumentFragment();

    // Check if this is a Bluesky post section (hide title in view mode)
    const isBlueskyPostSection =
      this.section.collection === 'app.bsky.feed.post' ||
      (this.section.type === 'records' && this.section.records &&
        this.section.records.some(uri => uri.includes('app.bsky.feed.post')));

    // Section header (title + edit controls)
    // Hide title if hideHeader is set, even in edit mode (so we can preview it hidden)
    // editMode will still ensure the header container exists to hold the controls
    const shouldShowTitle = this.section.title &&
      (!isBlueskyPostSection && !this.section.hideHeader);
    const isCollectedFlowers = this.section.type === 'collected-flowers';
    const collectedFlowersHelp = isCollectedFlowers
      ? createHelpTooltip('Collected flowers are a way to lead people to other gardens that you\u2019ve enjoyed visiting. You can collect a flower from someone\u2019s garden by visiting it and clicking \u201cPick A Flower\u201d.')
      : null;

    let editControls: HTMLElement | null = null;
    if (shouldShowTitle || this.editMode) {
      const header = document.createElement('div');
      header.className = 'section-header';

      // Always add a left-side container (even if empty) to keep controls on the right
      const titleContainer = document.createElement('div');
      titleContainer.className = 'section-title-wrapper';

      if (shouldShowTitle) {
        const title = document.createElement('h2');
        title.className = 'section-title';
        title.textContent = this.section.title;
        titleContainer.appendChild(title);

        // Place help tooltip inline with the title
        if (collectedFlowersHelp) {
          titleContainer.appendChild(collectedFlowersHelp);
        }
      }

      header.appendChild(titleContainer);

      if (this.editMode) {
        editControls = this.createEditControls();
      }

      fragment.appendChild(header);
    }

    // Section content
    const content = document.createElement('div');
    content.className = 'section-content';

    try {
      switch (this.section.type) {
        case 'profile':
          await this.renderProfile(content);
          break;
        case 'records':
          await this.renderRecords(content);
          break;
        case 'collected-flowers': {
          const rendered = await renderCollectedFlowers(this.section, {
            onRefresh: () => this.render(),
            editMode: this.editMode,
          });
          rendered.classList.add('content-enter');
          content.innerHTML = '';
          content.appendChild(rendered);
          break;
        }
        case 'content':
        case 'block': // Support legacy 'block' type
          await this.renderBlock(content);
          break;
        case 'share-to-bluesky':
          await this.renderShareToBluesky(content);
          break;
        case 'web-tile':
          await this.renderWebTile(content);
          break;
        default:
          content.innerHTML = `<p>Unknown section type: ${this.section.type}</p>`;
      }
    } catch (error) {
      console.error('Failed to render section:', error);
      const errorEl = createErrorMessage(
        'Failed to load section',
        async () => {
          // Retry by re-rendering
          await this.render();
        },
        error instanceof Error ? error.message : String(error)
      );
      content.innerHTML = '';
      content.appendChild(errorEl);
    }

    if (token !== this.renderToken) {
      return;
    }

    this.className = 'section';
    this.setAttribute('data-type', this.section.type);
    fragment.appendChild(content);

    // In edit mode, keep the title above but move controls under the content
    if (this.editMode && editControls) {
      fragment.appendChild(editControls);
      // Update info box asynchronously after controls are in the DOM
      const infoBox = editControls.querySelector('.section-info');
      if (infoBox) {
        this.updateInfoBox(infoBox as HTMLElement);
      }
    }
    this.classList.add('section-ready');
    this.replaceChildren(fragment);
  }

  createEditControls() {
    const controls = document.createElement('div');
    controls.className = 'section-controls';

    // Info row container (info box + move buttons)
    const infoRow = document.createElement('div');
    infoRow.className = 'section-info-row';

    // Info box showing element type
    const infoBox = document.createElement('div');
    infoBox.className = 'section-info';
    infoRow.appendChild(infoBox);

    // Move buttons container
    const moveButtons = document.createElement('div');
    moveButtons.className = 'section-move-buttons';

    // Get current section index to determine if buttons should be disabled
    const config = getConfig();
    const sections = config.sections || [];
    const currentIndex = sections.findIndex(s => s.id === this.section.id);
    const isFirst = currentIndex === 0;
    const isLast = currentIndex === sections.length - 1;

    // Move up button
    const moveUpBtn = document.createElement('button');
    moveUpBtn.className = 'button button-secondary button-small';
    moveUpBtn.innerHTML = '↑';
    moveUpBtn.title = 'Move up';
    moveUpBtn.disabled = isFirst;
    moveUpBtn.addEventListener('click', () => {
      if (moveSectionUp(this.section.id)) {
        window.dispatchEvent(new CustomEvent('config-updated'));
      }
    });
    moveButtons.appendChild(moveUpBtn);

    // Move down button
    const moveDownBtn = document.createElement('button');
    moveDownBtn.className = 'button button-secondary button-small';
    moveDownBtn.innerHTML = '↓';
    moveDownBtn.title = 'Move down';
    moveDownBtn.disabled = isLast;
    moveDownBtn.addEventListener('click', () => {
      if (moveSectionDown(this.section.id)) {
        window.dispatchEvent(new CustomEvent('config-updated'));
      }
    });
    moveButtons.appendChild(moveDownBtn);

    infoRow.appendChild(moveButtons);
    controls.appendChild(infoRow);

    // Action buttons container (toggle header, edit, delete)
    const actionButtons = document.createElement('div');
    actionButtons.className = 'section-action-buttons';

    // Hide/Show Header toggle button (only if section has a title)
    if (this.section.title) {
      const toggleHeaderBtn = document.createElement('button');
      toggleHeaderBtn.className = 'button button-secondary button-small';
      toggleHeaderBtn.textContent = this.section.hideHeader ? 'Show Header' : 'Hide Header';
      toggleHeaderBtn.title = this.section.hideHeader
        ? 'Show header in preview mode'
        : 'Hide header in preview mode';
      toggleHeaderBtn.addEventListener('click', () => {
        const newValue = !this.section.hideHeader;

        // Update global config
        updateSection(this.section.id, { hideHeader: newValue });

        // Update local state and re-render this block immediately (avoids global flicker)
        this.section.hideHeader = newValue;
        this.render();
      });
      actionButtons.appendChild(toggleHeaderBtn);
    }

    // Edit button only for section types that support editing
    const recordUri = this.section.records?.[0];
    const isImageRecord =
      isContentImageCollection(this.section.collection) ||
      (typeof recordUri === 'string' && (recordUri.includes('/garden.spores.content.image/') || recordUri.includes('/coop.hypha.spores.content.image/')));

    const supportsEditing =
      this.section.type === 'content' ||
      this.section.type === 'block' ||
      this.section.type === 'profile' ||
      (this.section.type === 'records' && isImageRecord);
    // share-to-bluesky doesn't need editing - it's just a button

    if (supportsEditing) {
      const editBtn = document.createElement('button');
      editBtn.className = 'button button-secondary button-small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        if (this.section.type === 'content' || this.section.type === 'block') {
          this.editBlock();
        } else if (this.section.type === 'profile') {
          this.editProfile();
        } else if (this.section.type === 'records') {
          this.editRecords();
        }
      });
      actionButtons.appendChild(editBtn);
    }

    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'button button-danger button-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await showConfirmModal({
        title: 'Delete Section',
        message: 'Are you sure you want to delete this section?',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmDanger: true,
      });

      if (confirmed) {
        // If this is a content/block with a PDS record, delete it
        if (this.section.type === 'content' || this.section.type === 'block') {
          const parsed = this.section.ref ? parseAtUri(this.section.ref) : null;
          const collection = parsed?.collection || this.section.collection;
          const rkey = parsed?.rkey || this.section.rkey;

          if (isContentTextCollection(collection) && rkey) {
            try {
              await deleteRecord(collection, rkey);
            } catch (error) {
              console.error('Failed to delete content record from PDS:', error);
              // Continue with section removal even if PDS delete fails
            }
          }
        }

        // If this is an image record section, delete the PDS record too
        if (this.section.type === 'records') {
          const parsed = this.section.ref ? parseAtUri(this.section.ref) : null;
          let collection = parsed?.collection || this.section.collection as string | undefined;
          let rkey = parsed?.rkey || this.section.rkey as string | undefined;

          if ((!collection || !rkey) && this.section.records?.[0]) {
            const uri = this.section.records[0];
            const parts = uri.split('/');
            if (parts.length >= 5) {
              collection = parts[3];
              rkey = parts[4];
            }
          }

          if (isContentImageCollection(collection) && rkey) {
            try {
              await deleteRecord(collection, rkey);
            } catch (error) {
              console.error('Failed to delete image record from PDS:', error);
              // Continue with section removal even if PDS delete fails
            }
          }
        }
        await removeSection(this.section.id);

        // Save the updated sections to PDS
        try {
          await saveConfig();
        } catch (error) {
          console.error('Failed to save sections after deletion:', error);
          // Section is already removed from UI, but may need to be re-added on reload
        }

        this.remove();
      }
    });
    actionButtons.appendChild(deleteBtn);
    controls.appendChild(actionButtons);

    return controls;
  }

  async updateInfoBox(infoBox: HTMLElement) {
    let typeInfo = '';

    if (this.section.type === 'content' || this.section.type === 'block') {
      typeInfo = 'Content';
    } else if (this.section.type === 'records') {
      typeInfo = 'Loading...';
    } else if (this.section.type === 'share-to-bluesky') {
      typeInfo = 'Share on Bluesky';
    } else if (this.section.type === 'web-tile') {
      typeInfo = 'Web Tile';
    } else {
      typeInfo = this.section.type.charAt(0).toUpperCase() + this.section.type.slice(1);
    }

    infoBox.textContent = typeInfo;

      // For records, fetch the actual $type asynchronously
      if (this.section.type === 'records' && this.section.records && this.section.records.length > 0) {
        try {
          const record = await getRecordByUri(this.section.records[0]);
        if (record && record.value && record.value.$type) {
          infoBox.textContent = record.value.$type;
        } else {
          infoBox.textContent = 'Record';
        }
      } catch (error) {
        console.error('Failed to load record type:', error);
        infoBox.textContent = 'Record';
      }
    }
  }

  async editBlock() {
    // Get or create the create-content modal
    let modal = document.querySelector('create-content') as any;
    if (!modal) {
      modal = document.createElement('create-content');
      document.body.appendChild(modal);
    }

    // Load existing block data
    const ownerDid = getSiteOwnerDid();
    const parsed = this.section.ref ? parseAtUri(this.section.ref) : null;
    const collection = parsed?.collection || this.section.collection;
    const rkey = parsed?.rkey || this.section.rkey;

    if (isContentTextCollection(collection) && rkey && ownerDid) {
      try {
        const record = await getRecord(ownerDid, collection, rkey);
        if (record && record.value) {
          modal.editContent({
            rkey,
            sectionId: this.section.id,
            title: record.value.title || this.section.title || '',
            content: record.value.content || '',
            format: record.value.format || this.section.format || 'markdown'
          });
        }
      } catch (error) {
        console.error('Failed to load content for editing:', error);
        alert('Failed to load content for editing');
        return;
      }
    } else {
      // Fallback for inline content
      modal.editContent({
        sectionId: this.section.id,
        title: this.section.title || '',
        content: this.section.content || '',
        format: this.section.format || 'text'
      });
    }

    modal.setOnClose(() => {
      this.render();
      window.dispatchEvent(new CustomEvent('config-updated'));
    });

    modal.show();
  }

  async editProfile() {
    // Get or create the create-profile modal
    let modal = document.querySelector('create-profile') as any;
    if (!modal) {
      modal = document.createElement('create-profile');
      document.body.appendChild(modal);
    }

    // Load existing profile data
    const ownerDid = getSiteOwnerDid();
    const parsedRef = this.section.ref ? parseAtUri(this.section.ref) : null;
    const profileCollection = parsedRef?.collection || this.section.collection;
    const profileRkey = parsedRef?.rkey || this.section.rkey || (isProfileCollection(profileCollection) ? 'self' : undefined);
    if (isProfileCollection(profileCollection) && profileRkey && ownerDid) {
      try {
        const record = await getRecord(ownerDid, profileCollection, profileRkey);
        if (record && record.value) {
          modal.editProfile({
            rkey: profileRkey,
            sectionId: this.section.id,
            displayName: record.value.displayName || '',
            pronouns: record.value.pronouns || '',
            description: record.value.description || '',
            avatar: record.value.avatar || '',
            banner: record.value.banner || ''
          });
        } else {
          // No record found, create new one
          modal.editProfile({
            sectionId: this.section.id,
            displayName: '',
            pronouns: '',
            description: '',
            avatar: '',
            banner: ''
          });
        }
      } catch (error) {
        console.error('Failed to load profile for editing:', error);
        // If record doesn't exist, allow creating new one
        modal.editProfile({
          sectionId: this.section.id,
          displayName: '',
          pronouns: '',
          description: '',
          avatar: '',
          banner: ''
        });
      }
    } else {
      // No rkey - create new profile record
      modal.editProfile({
        sectionId: this.section.id,
        displayName: '',
        pronouns: '',
        description: '',
        avatar: '',
        banner: ''
      });
    }

    modal.setOnClose(() => {
      this.render();
      window.dispatchEvent(new CustomEvent('config-updated'));
    });

    modal.show();
  }

  async editRecords() {
    if (!this.section.records || this.section.records.length === 0) {
      return;
    }

    let collection = this.section.collection as string | undefined;
    let rkey = this.section.rkey as string | undefined;

    if ((!collection || !rkey) && this.section.records?.[0]) {
      const uri = this.section.records[0];
      const parts = uri.split('/');
      if (parts.length >= 5) {
        collection = parts[3];
        rkey = parts[4];
      }
    }

    if (!isContentImageCollection(collection) || !rkey) {
      return;
    }

    const ownerDid = getSiteOwnerDid();
    if (!ownerDid) {
      return;
    }

    let modal = document.querySelector('create-image') as any;
    if (!modal) {
      modal = document.createElement('create-image');
      document.body.appendChild(modal);
    }

    try {
      const record = await getRecord(ownerDid, collection, rkey);
      if (record && record.value) {
        let imageUrl = null;
        if (record.value.image && (record.value.image.ref || record.value.image.$link)) {
          imageUrl = await getBlobUrl(ownerDid, record.value.image);
        }

        modal.editImage({
          rkey,
          sectionId: this.section.id,
          title: record.value.title || this.section.title || '',
          imageUrl,
          imageBlob: record.value.image || null,
          createdAt: record.value.createdAt || null
        });
      }
    } catch (error) {
      console.error('Failed to load image record for editing:', error);
      alert('Failed to load image record for editing');
      return;
    }

    modal.setOnClose(() => {
      this.render();
      window.dispatchEvent(new CustomEvent('config-updated'));
    });

    modal.show();
  }

  async renderProfile(container) {
    const ownerDid = getSiteOwnerDid();
    if (!ownerDid) {
      container.innerHTML = '<p>Log in to create your garden</p>';
      return;
    }

    // Show loading state
    const loadingEl = createLoadingSpinner('Loading profile...');
    container.innerHTML = '';
    container.appendChild(loadingEl);

    try {
      let profileData = null;
      const parsedProfileRef = this.section.ref ? parseAtUri(this.section.ref) : null;
      let collectionToFetch = parsedProfileRef?.collection || this.section.collection;
      let rkeyToFetch = parsedProfileRef?.rkey || this.section.rkey;

      // Profile records are singletons at rkey 'self'
      if (isProfileCollection(collectionToFetch) && !rkeyToFetch) {
        rkeyToFetch = 'self';
      }

      if (isProfileCollection(collectionToFetch) && rkeyToFetch) {
        try {
          const record = await getRecord(ownerDid, collectionToFetch, rkeyToFetch);
          if (record && record.value) {
            let avatarUrl = null;
            let bannerUrl = null;

            if (record.value.avatar && (record.value.avatar.ref || record.value.avatar.$link)) {
              avatarUrl = await getBlobUrl(ownerDid, record.value.avatar);
            }
            if (record.value.banner && (record.value.banner.ref || record.value.banner.$link)) {
              bannerUrl = await getBlobUrl(ownerDid, record.value.banner);
            }

            profileData = {
              displayName: record.value.displayName,
              pronouns: record.value.pronouns,
              description: record.value.description,
              avatar: avatarUrl,
              banner: bannerUrl
            };
          }
        } catch (error) {
          console.warn(`Failed to load custom profile from ${collectionToFetch}/${rkeyToFetch}, falling back to Bluesky profile:`, error);
        }
      }

      // If no profileData yet, or if explicitly configured to use Bluesky profile, fetch Bluesky profile
      if (!profileData || collectionToFetch === 'app.bsky.actor.profile') {
        const profile = await getProfile(ownerDid);
        if (!profile) {
          throw new Error('Could not load profile');
        }
        profileData = {
          displayName: profile.displayName,
          pronouns: (profile as any).pronouns,
          description: profile.description,
          avatar: profile.avatar,
          banner: profile.banner
        };
      }

      // Convert profile to record format for layout
      const record = {
        value: {
          title: profileData.displayName,
          pronouns: profileData.pronouns,
          content: profileData.description,
          image: profileData.avatar,
          banner: profileData.banner
        }
      };

      const rendered = await renderRecord(record, this.section.layout || 'profile');
      rendered.classList.add('content-enter');
      container.innerHTML = '';
      container.appendChild(rendered);
    } catch (error) {
      console.error('Failed to render profile:', error);
      const errorEl = createErrorMessage(
        'Failed to load profile',
        async () => {
          await this.renderProfile(container);
        },
        error instanceof Error ? error.message : String(error)
      );
      container.innerHTML = '';
      container.appendChild(errorEl);
    }
  }

  async renderRecords(container) {
    const uris = this.section.records || [];

    if (uris.length === 0) {
      container.innerHTML = '<p class="empty">No records selected</p>';
      return;
    }

    // Show loading state
    const loadingEl = createLoadingSpinner('Loading records...');
    container.innerHTML = '';
    container.appendChild(loadingEl);

    try {
      const records = await getRecordsByUris(uris);

      if (records.length === 0) {
        container.innerHTML = '<p class="empty">Could not load selected records</p>';
        return;
      }

      const grid = document.createElement('div');
      grid.className = 'record-grid content-enter';

      for (const record of records) {
        try {
          const rendered = await renderRecord(record, this.section.layout || 'card');
          grid.appendChild(rendered);
        } catch (error) {
          console.error('Failed to render record:', error);
          // Create error placeholder for this specific record
          const errorPlaceholder = document.createElement('div');
          errorPlaceholder.className = 'record-error';
          const errorMsg = createErrorMessage(
            'Failed to render record',
            async () => {
              try {
                const rendered = await renderRecord(record, this.section.layout || 'card');
                errorPlaceholder.replaceWith(rendered);
              } catch (retryError) {
                console.error('Retry failed:', retryError);
              }
            },
            error instanceof Error ? error.message : String(error)
          );
          errorPlaceholder.appendChild(errorMsg);
          grid.appendChild(errorPlaceholder);
        }
      }

      container.innerHTML = '';
      container.appendChild(grid);
    } catch (error) {
      console.error('Failed to load records:', error);
      const errorEl = createErrorMessage(
        'Failed to load records',
        async () => {
          await this.renderRecords(container);
        },
        error instanceof Error ? error.message : String(error)
      );
      container.innerHTML = '';
      container.appendChild(errorEl);
    }
  }

  async renderBlock(container) {
    const ownerDid = getSiteOwnerDid();
    let content = '';
    let format = 'text';

    // If section references a content record, load it from PDS
    const parsedBlockRef = this.section.ref ? parseAtUri(this.section.ref) : null;
    const blockCollection = parsedBlockRef?.collection || this.section.collection;
    const blockRkey = parsedBlockRef?.rkey || this.section.rkey;

    if (isContentTextCollection(blockCollection) && blockRkey && ownerDid) {
      // Show loading state
      const loadingEl = createLoadingSpinner('Loading content...');
      container.innerHTML = '';
      container.appendChild(loadingEl);

      try {
        const record = await getRecord(ownerDid, blockCollection, blockRkey);
        if (record && record.value) {
          content = record.value.content || '';
          format = record.value.format || this.section.format || 'markdown';
        } else {
          throw new Error('Content record not found');
        }
      } catch (error) {
        console.error('Failed to load content record:', error);
        const errorEl = createErrorMessage(
          'Failed to load content',
          async () => {
            await this.renderBlock(container);
          },
          error instanceof Error ? error.message : String(error)
        );
        container.innerHTML = '';
        container.appendChild(errorEl);
        return;
      }
    } else {
      // Fall back to inline content (for backwards compatibility)
      content = this.section.content || '';
      format = this.section.format || 'text';
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content content-enter';

    try {
      if (format === 'html') {
        // Legacy support: existing HTML blocks still render, but sanitized.
        contentDiv.innerHTML = sanitizeHtml(content);
      } else if (format === 'markdown') {
        contentDiv.innerHTML = renderMarkdown(content);
      } else {
        contentDiv.textContent = content;
      }

      container.innerHTML = '';
      container.appendChild(contentDiv);

      // In edit mode, make it editable (only for inline content, not records)
      if (this.editMode && !this.section.ref && !this.section.rkey) {
        contentDiv.contentEditable = 'true';
        contentDiv.addEventListener('blur', () => {
          updateSection(this.section.id, { content: contentDiv.innerText });
        });
      }
    } catch (error) {
      console.error('Failed to render content:', error);
      const errorEl = createErrorMessage(
        'Failed to render content',
        async () => {
          await this.renderBlock(container);
        },
        error instanceof Error ? error.message : String(error)
      );
      container.innerHTML = '';
      container.appendChild(errorEl);
    }
  }

  async renderShareToBluesky(container) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'share-to-bluesky-section';
    buttonContainer.style.display = 'flex';
    buttonContainer.style.justifyContent = 'center';
    buttonContainer.style.padding = '1rem';

    const button = document.createElement('button');
    button.className = 'button button-primary';
    button.textContent = 'Share on Bluesky';
    button.setAttribute('aria-label', 'Share your garden to Bluesky');

    // Dispatch custom event that site-app can listen for
    button.addEventListener('click', () => {
      const event = new CustomEvent('share-to-bluesky', {
        bubbles: true,
        cancelable: true
      });
      this.dispatchEvent(event);
    });

    buttonContainer.appendChild(button);
    container.appendChild(buttonContainer);
  }

  async renderWebTile(container) {
    const tileUri = this.section.tileUri || this.section.ref;
    if (!tileUri) {
      container.innerHTML = '<p>No tile URI configured</p>';
      return;
    }

    const parsed = parseAtUri(tileUri);
    if (!parsed) {
      container.innerHTML = '<p>Invalid tile URI</p>';
      return;
    }

    if (parsed.collection !== 'ing.dasl.masl') {
      container.innerHTML = '<p>Invalid tile: unexpected record type</p>';
      return;
    }

    try {
      const record = await getRecord(parsed.did, parsed.collection, parsed.rkey);
      const tile = record?.value?.tile ?? record?.value;
      const root = tile?.resources?.['/'];
      if (!root?.src) {
        container.innerHTML = '<p>Tile record missing resources</p>';
        return;
      }

      const contentType = (root['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (contentType !== 'text/html') {
        container.innerHTML = '<p>Tile resource is not an HTML document</p>';
        return;
      }

      const blobUrl = await getBlobUrl(parsed.did, root.src);
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error(`Blob fetch failed: ${response.status}`);
      }
      const html = await response.text();

      const sizing = tile.sizing || { width: 300, height: 300 };

      const iframe = document.createElement('iframe');
      iframe.srcdoc = html;
      iframe.sandbox.add('allow-scripts');
      iframe.style.width = `${sizing.width}px`;
      iframe.style.height = `${sizing.height}px`;
      iframe.style.maxWidth = '100%';
      iframe.style.border = 'none';
      iframe.style.borderRadius = '12px';
      iframe.style.display = 'block';
      iframe.style.margin = '0 auto';
      iframe.title = tile.name || 'Web Tile';

      container.appendChild(iframe);
    } catch (error) {
      console.error('Failed to render web tile:', error);
      container.innerHTML = '<p>Failed to load tile</p>';
    }
  }

}

customElements.define('section-block', SectionBlock);
