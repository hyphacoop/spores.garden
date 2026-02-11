import { getConfig, saveConfig, getSiteOwnerDid, setSiteOwnerDid } from '../config';
import { getCurrentDid, putRecord, uploadBlob, createRecord, post, isLoggedIn } from '../oauth';
import { getRecord, getProfile, buildAtUri } from '../at-client';
import { setCachedActivity } from './recent-gardens';
import { escapeHtml } from '../utils/sanitize';
import { SiteRouter } from './site-router';
import './create-content';

/**
 * Manages edit mode, section addition workflows, and content creation.
 */
export class SiteEditor {
  public editMode = false;
  private renderCallback: () => void;
  private showNotification: (msg: string, type?: 'success' | 'error') => void;

  constructor(
    renderCallback: () => void,
    showNotification: (msg: string, type?: 'success' | 'error') => void
  ) {
    this.renderCallback = renderCallback;
    this.showNotification = showNotification;
  }

  toggleEditMode() {
    this.editMode = !this.editMode;
    this.renderCallback();
  }

  async saveAndExitEdit() {
    try {
      await saveConfig();

      // Record local activity
      const currentDid = getCurrentDid();
      if (currentDid) {
        setCachedActivity(currentDid, 'edit', new Date());
      }

      this.editMode = false;
      this.showNotification('Changes saved!', 'success');
      this.renderCallback();
    } catch (error) {
      console.error('Failed to save:', error);
      this.showNotification(`Failed to save: ${error.message}`, 'error');
    }
  }

  showAddSectionModal(preferredType?: string) {
    // If a type is preferred, skip the modal and add directly
    if (preferredType) {
      this.addSection(preferredType);
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Add Section</h2>
        <div class="section-types">
          <button data-type="profile" class="section-type">
            <span class="icon">👤</span>
            <span>Profile</span>
          </button>
          <button data-action="select-bsky-posts" class="section-type">
            <span class="icon">🦋</span>
            <span>Bluesky Posts</span>
          </button>
          <button data-type="content" class="section-type">
            <span class="icon">📝</span>
            <span>Custom Content</span>
          </button>
          <button data-type="image" class="section-type">
            <span class="icon">🖼️</span>
            <span>Image</span>
          </button>
          <button data-type="smoke-signal" class="section-type">
            <span class="icon">💨</span>
            <span>Smoke Signal Event</span>
          </button>
          <button data-type="leaflet" class="section-type">
            <span class="icon">📄</span>
            <span>leaflet.pub Article</span>
          </button>
          <button data-type="collected-flowers" class="section-type">
            <span class="icon">🌼</span>
            <span>Collected Flowers</span>
          </button>
          <button data-action="load-records" class="section-type">
            <span class="icon">📚</span>
            <span>Load Records</span>
          </button>
        </div>
        <button class="button button-secondary modal-close">Cancel</button>
      </div>
    `;

    modal.querySelectorAll('.section-type').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.type;
        const action = (btn as HTMLElement).dataset.action;

        modal.remove();

        // Route actions to dedicated methods
        if (action === 'select-bsky-posts') {
          this.showBskyPostSelector();
        } else if (action === 'load-records') {
          this.showRecordsLoader();
        } else if (type) {
          this.addSection(type);
        }
      });
    });

    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  addSection(type: string) {
    // If it's content, show the content creation modal
    if (type === 'content' || type === 'block') {
      this.showCreateContentModal();
      return;
    }

    // If it's image, show the create image modal
    if (type === 'image') {
      this.showCreateImageModal();
      return;
    }

    // If it's smoke-signal, show the smoke signal selection flow
    if (type === 'smoke-signal') {
      this.showSmokeSignalSelector();
      return;
    }

    // If it's leaflet, create a records section with leaflet layout
    if (type === 'leaflet') {
      this.showLeafletSelector();
      return;
    }

    // If it's profile, check for existing or clone from Bluesky
    if (type === 'profile') {
      this.addProfileSection();
      return;
    }

    const config = getConfig();
    const id = `section-${Date.now()}`;

    const section = {
      id,
      type,
      layout: type === 'profile' ? 'profile' : type === 'collected-flowers' ? 'collected-flowers' : 'card',
      title: type === 'collected-flowers' ? 'Collected Flowers' : ''
    };

    config.sections = [...(config.sections || []), section];
    this.renderCallback();
  }

  async addProfileSection() {
    const ownerDid = getSiteOwnerDid();
    if (!ownerDid) {
      this.showNotification('You must be logged in to add a profile.', 'error');
      return;
    }

    this.showNotification('Checking for existing profile...', 'success');

    try {
      // 1. Check if profile record already exists
      try {
        const existing = await getRecord(ownerDid, 'garden.spores.site.profile', 'self');
        if (existing && existing.value) {
          this.showNotification('Found existing profile.', 'success');
          this.addSectionToConfig({
            type: 'profile',
            collection: 'garden.spores.site.profile',
            rkey: 'self'
          });
          return;
        }
      } catch (e) {
        // Ignore error, proceed to creation
      }

      // 2. Clone from Bluesky
      this.showNotification('Importing profile from Bluesky...', 'success');
      const bskyProfile = await getProfile(ownerDid);

      if (!bskyProfile) {
        throw new Error('Could not fetch Bluesky profile');
      }

      const record: any = {
        $type: 'garden.spores.site.profile',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        displayName: bskyProfile.displayName,
        description: bskyProfile.description
      };

      // Handle Avatar (clone blob)
      if (bskyProfile.avatar) {
        try {
          const response = await fetch(bskyProfile.avatar);
          if (response.ok) {
            const blob = await response.blob();
            const upload = await uploadBlob(blob, blob.type);
            if (upload && upload.data && upload.data.blob) {
              record.avatar = upload.data.blob;
            }
          }
        } catch (e) {
          console.warn('Failed to clone avatar:', e);
        }
      }

      // Handle Banner (clone blob)
      if (bskyProfile.banner) {
        try {
          const response = await fetch(bskyProfile.banner);
          if (response.ok) {
            const blob = await response.blob();
            const upload = await uploadBlob(blob, blob.type);
            if (upload && upload.data && upload.data.blob) {
              record.banner = upload.data.blob;
            }
          }
        } catch (e) {
          console.warn('Failed to clone banner:', e);
        }
      }

      // 3. Create the record
      await putRecord('garden.spores.site.profile', 'self', record);

      this.showNotification('Profile imported successfully!', 'success');

      // 4. Add the section
      this.addSectionToConfig({
        type: 'profile',
        collection: 'garden.spores.site.profile',
        rkey: 'self'
      });

    } catch (error) {
      console.error('Failed to add profile section:', error);
      this.showNotification('Failed to import profile. Using default view.', 'error');

      // Fallback: Add section without specific record binding
      this.addSectionToConfig({
        type: 'profile'
      });
    }
  }

  addSectionToConfig(params: { type: string, collection?: string, rkey?: string, title?: string }) {
    const config = getConfig();
    const id = `section-${Date.now()}`;

    const section: any = {
      id,
      type: params.type,
      layout: params.type === 'profile' ? 'profile' : 'card',
    };

    if (params.type === 'collected-flowers') {
      section.layout = 'collected-flowers';
      section.title = 'Collected Flowers';
    }

    if (params.collection) section.collection = params.collection;
    if (params.rkey) section.rkey = params.rkey;
    if (params.collection && params.rkey) {
      const did = getCurrentDid();
      if (did) {
        section.ref = buildAtUri(did, params.collection, params.rkey);
      }
    }
    if (params.title) section.title = params.title;

    config.sections = [...(config.sections || []), section];
    this.renderCallback();
  }

  async showBskyPostSelector() {
    const did = getCurrentDid();
    if (!did) return;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="welcome-loading"><div class="spinner"></div><p>Loading your Bluesky posts...</p></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    try {
      const { getCollectionRecords } = await import('../records/loader');
      const posts = await getCollectionRecords(did, 'app.bsky.feed.post', { limit: 50 });

      if (posts.length === 0) {
        modal.querySelector('.modal-content')!.innerHTML = `
          <p>No posts found in your Bluesky feed.</p>
          <button class="button modal-close">Close</button>
        `;
        modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        return;
      }

      this.renderPostSelector(modal, posts, closeModal);
    } catch (error) {
      modal.querySelector('.modal-content')!.innerHTML = `
        <p>Failed to load posts. Please try again.</p>
        <button class="button modal-close">Close</button>
      `;
      modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
    }
  }

  private renderPostSelector(modal: HTMLElement, posts: any[], closeModal: () => void) {
    modal.querySelector('.modal-content')!.innerHTML = `
      <div class="welcome-selector">
        <h2>Select Bluesky Post</h2>
        <p>Choose a post to add to your garden</p>
        <div class="post-list">
          ${posts.map((post) => {
      const uri = post.uri || '';
      const val = post.value as any;
      const text = val?.text?.slice(0, 200) || 'Post';
      const createdAt = val?.createdAt ? new Date(val.createdAt).toLocaleDateString() : '';
      return `
              <button class="post-item-selectable" data-uri="${uri}">
                <div class="post-content">
                  <p class="post-text">${escapeHtml(text)}${text.length >= 200 ? '...' : ''}</p>
                  ${createdAt ? `<time class="post-date">${createdAt}</time>` : ''}
                </div>
              </button>
            `;
    }).join('')}
        </div>
        <button class="button button-secondary modal-close">Cancel</button>
      </div>
    `;

    modal.querySelectorAll('.post-item-selectable').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uri = btn.getAttribute('data-uri');
        if (uri) {
          const config = getConfig();
          const id = `section-${Date.now()}`;
          const section = {
            id,
            type: 'records',
            layout: 'post',
            records: [uri]
          };
          config.sections = [...(config.sections || []), section];
          this.renderCallback();

          closeModal();
        }
      });
    });

    modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
  }

  async showRecordsLoader() {
    const did = getCurrentDid();
    if (!did) return;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="welcome-loading"><div class="spinner"></div><p>Loading your collections...</p></div>
      </div>
    `;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    try {
      const { getCollections } = await import('../records/loader');
      const collections = await getCollections(did);

      if (collections.length === 0) {
        modal.querySelector('.modal-content')!.innerHTML = `
          <p>No collections found in your repository.</p>
          <button class="button modal-close">Close</button>
        `;
        modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        return;
      }

      this.renderCollectionSelector(modal, collections, did, closeModal);
    } catch (error) {
      modal.querySelector('.modal-content')!.innerHTML = `
        <p>Failed to load collections. Please try again.</p>
        <button class="button modal-close">Close</button>
      `;
      modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
    }
  }

  private renderCollectionSelector(modal: HTMLElement, collections: string[], did: string, closeModal: () => void) {
    modal.querySelector('.modal-content')!.innerHTML = `
      <div class="welcome-selector">
        <h2>Select Collection</h2>
        <p>Choose a collection to load records from</p>
        <div class="collection-list">
          ${collections.map(coll => `
            <button class="collection-item" data-collection="${coll}">
              <span class="collection-name">${coll}</span>
              <span class="collection-arrow">→</span>
            </button>
          `).join('')}
        </div>
        <button class="button button-secondary modal-close">Cancel</button>
      </div>
    `;

    modal.querySelectorAll('.collection-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        const collection = btn.getAttribute('data-collection');
        if (!collection) return;

        modal.querySelector('.modal-content')!.innerHTML = `
          <div class="welcome-loading"><div class="spinner"></div><p>Loading records from ${collection}...</p></div>
        `;

        try {
          const { getCollectionRecords } = await import('../records/loader');
          const records = await getCollectionRecords(did, collection, { limit: 20 });

          if (records.length === 0) {
            modal.querySelector('.modal-content')!.innerHTML = `
              <p>No records found in ${collection}.</p>
              <button class="button modal-close">Close</button>
            `;
            modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
            return;
          }

          this.renderRecordSelector(modal, collection, records, closeModal);
        } catch (error) {
          modal.querySelector('.modal-content')!.innerHTML = `
            <p>Failed to load records from ${collection}. Please try again.</p>
            <button class="button modal-close">Close</button>
          `;
          modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
        }
      });
    });

    modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
  }

  private renderRecordSelector(modal: HTMLElement, collection: string, records: any[], closeModal: () => void) {
    modal.querySelector('.modal-content')!.innerHTML = `
      <div class="welcome-selector">
        <h2>Select Records to Add</h2>
        <p>Choose records from ${collection} to add to your site</p>
        <div class="record-list">
          ${records.map((record, idx) => {
      const rkey = record.uri?.split('/').pop() || idx.toString();
      const val = record.value as any;
      const title = val?.text?.slice(0, 50) ||
        val?.title ||
        val?.name ||
        rkey;
      return `
              <label class="record-item">
                <input type="checkbox" value="${rkey}" data-uri="${record.uri || ''}">
                <span class="record-title">${escapeHtml(title)}</span>
              </label>
            `;
    }).join('')}
        </div>
        <div class="selector-actions">
          <button class="button" data-action="add-records">Add Selected</button>
          <button class="button button-secondary modal-close">Cancel</button>
        </div>
      </div>
    `;

    modal.querySelector('[data-action="add-records"]')?.addEventListener('click', async () => {
      const selected = Array.from(modal.querySelectorAll<HTMLInputElement>('.record-item input:checked'));

      if (selected.length === 0) {
        alert('Please select at least one record.');
        return;
      }

      // Add selected records to config
      const config = getConfig();
      for (const input of selected) {
        const uri = input.getAttribute('data-uri');
        if (!uri) continue;

        const id = `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const section = {
          id,
          type: 'records',
          records: [uri],
          layout: 'card'
        };
        config.sections = [...(config.sections || []), section];
      }

      this.renderCallback();
      closeModal();
    });

    modal.querySelector('.modal-close')?.addEventListener('click', closeModal);
  }

  async showSmokeSignalSelector() {
    const currentDid = getCurrentDid();
    if (!currentDid) {
      alert('Please log in to add Smoke Signal events.');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Add Smoke Signal Events</h2>
        <p>What type of events would you like to display?</p>
        <div class="smoke-signal-type-selector" style="display: flex; flex-direction: row; gap: 1rem; margin: 1.5rem 0;">
          <button data-event-type="organizing" class="section-type" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem 1rem; min-height: 100px;">
            <span class="icon" style="font-size: 2rem; margin-bottom: 0.5rem;">📅</span>
            <span style="font-weight: 500;">Organizing</span>
            <span style="font-size: 0.85em; color: var(--text-muted); margin-top: 0.25rem;">Events I'm hosting</span>
          </button>
          <button data-event-type="attending" class="section-type" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 1.5rem 1rem; min-height: 100px;">
            <span class="icon" style="font-size: 2rem; margin-bottom: 0.5rem;">🎟️</span>
            <span style="font-weight: 500;">Attending</span>
            <span style="font-size: 0.85em; color: var(--text-muted); margin-top: 0.25rem;">Events I've RSVP'd to</span>
          </button>
        </div>
        <button class="button button-secondary modal-close" style="width: 100%;">Cancel</button>
      </div>
    `;

    modal.querySelectorAll('[data-event-type]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const eventType = (btn as HTMLElement).dataset.eventType;
        modal.remove();

        if (eventType === 'organizing') {
          await this.loadSmokeSignalRecords('community.lexicon.calendar.event', "Events I'm Organizing");
        } else if (eventType === 'attending') {
          await this.loadSmokeSignalRecords('community.lexicon.calendar.rsvp', "Events I'm Attending");
        }
      });
    });

    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  async loadSmokeSignalRecords(collection: string, sectionTitle: string) {
    const currentDid = getCurrentDid();
    if (!currentDid) return;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="welcome-loading">
          <div class="spinner"></div>
          <p>Loading ${collection === 'community.lexicon.calendar.event' ? 'events' : 'RSVPs'}...</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    try {
      const { getCollectionRecords, getRecordByUri } = await import('../records/loader');
      const records = await getCollectionRecords(currentDid, collection, { limit: 50 });

      if (records.length === 0) {
        modal.innerHTML = `
          <div class="modal-content">
            <h2>No Records Found</h2>
            <p>You don't have any ${collection === 'community.lexicon.calendar.event' ? 'events' : 'RSVPs'} in your repository.</p>
            <p style="font-size: 0.9em; color: var(--text-muted);">
              Collection: <code>${collection}</code>
            </p>
            <button class="button button-secondary modal-close">Close</button>
          </div>
        `;
        modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
        return;
      }

      const isRsvp = collection === 'community.lexicon.calendar.rsvp';
      let enrichedRecords = records;

      if (isRsvp) {
        modal.innerHTML = `
          <div class="modal-content">
            <div class="welcome-loading">
              <div class="spinner"></div>
              <p>Loading event details...</p>
            </div>
          </div>
        `;

        enrichedRecords = await Promise.all(records.map(async (record) => {
          const subjectUri = record.value?.subject?.uri;
          if (subjectUri) {
            try {
              const eventRecord = await getRecordByUri(subjectUri);
              return {
                ...record,
                _eventDetails: eventRecord?.value || null
              };
            } catch (e) {
              console.warn('Failed to fetch event for RSVP:', subjectUri, e);
              return { ...record, _eventDetails: null };
            }
          }
          return { ...record, _eventDetails: null };
        }));
      }

      this.showSmokeSignalRecordSelector(modal, enrichedRecords, collection, sectionTitle);
    } catch (error) {
      console.error('Failed to load smoke signal records:', error);
      modal.innerHTML = `
        <div class="modal-content">
          <h2>Error</h2>
          <p>Failed to load records: ${error instanceof Error ? error.message : 'Unknown error'}</p>
          <button class="button button-secondary modal-close">Close</button>
        </div>
      `;
      modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    }
  }

  showSmokeSignalRecordSelector(modal: HTMLElement, records: any[], collection: string, sectionTitle: string) {
    const isEvent = collection === 'community.lexicon.calendar.event';

    modal.innerHTML = `
      <div class="modal-content">
        <h2>Select ${isEvent ? 'Events' : 'RSVPs'}</h2>
        <p>Choose which ${isEvent ? 'events' : 'RSVPs'} to display on your garden</p>
        <div class="record-list" style="max-height: 400px; overflow-y: auto; margin: 1rem 0;">
          ${records.map((record, idx) => {
      const rkey = record.uri?.split('/').pop() || idx.toString();
      const value = record.value || {};

      let title = '';
      let subtitle = '';

      if (isEvent) {
        title = value.name || 'Untitled Event';
        if (value.startsAt) {
          try {
            subtitle = new Date(value.startsAt).toLocaleDateString();
          } catch {
            subtitle = value.startsAt;
          }
        }
      } else {
        const eventDetails = record._eventDetails;
        const eventName = eventDetails?.name || 'Unknown Event';

        const status = value.status || 'going';
        const statusLabel = status.includes('#') ? status.split('#').pop() : status;
        const statusEmoji = statusLabel === 'going' ? '✓' : statusLabel === 'interested' ? '?' : '✗';

        title = eventName;
        subtitle = `${statusEmoji} ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}`;

        if (eventDetails?.startsAt) {
          try {
            subtitle += ` · ${new Date(eventDetails.startsAt).toLocaleDateString()}`;
          } catch {
            // ignore
          }
        }
      }

      return `
              <label class="record-item" style="display: flex; align-items: center; padding: 0.75rem; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 0.5rem; cursor: pointer;">
                <input type="checkbox" value="${rkey}" data-uri="${record.uri || ''}" style="margin-right: 0.75rem;">
                <div>
                  <div style="font-weight: 500;">${escapeHtml(title)}</div>
                  ${subtitle ? `<div style="font-size: 0.85em; color: var(--text-muted);">${escapeHtml(subtitle)}</div>` : ''}
                </div>
              </label>
            `;
    }).join('')}
        </div>
        <div class="modal-actions" style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="button button-primary" data-action="add-selected">Add Selected</button>
          <button class="button button-secondary modal-close">Cancel</button>
        </div>
      </div>
    `;

    modal.querySelector('[data-action="add-selected"]')?.addEventListener('click', () => {
      const selected = Array.from(modal.querySelectorAll<HTMLInputElement>('.record-item input:checked'));

      if (selected.length === 0) {
        alert('Please select at least one record.');
        return;
      }

      const uris = selected.map(input => input.getAttribute('data-uri')).filter(Boolean) as string[];

      const config = getConfig();
      const id = `section-${Date.now()}`;
      const section = {
        id,
        type: 'records',
        layout: 'smoke-signal',
        title: sectionTitle,
        records: uris
      };
      config.sections = [...(config.sections || []), section];

      modal.remove();
      this.renderCallback();
    });

    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  async showLeafletSelector() {
    const currentDid = getCurrentDid();
    if (!currentDid) return;

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="welcome-loading">
          <div class="spinner"></div>
          <p>Loading leaflet publications...</p>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    try {
      const { getCollectionRecords } = await import('../records/loader');
      const collections = ['site.standard.document', 'pub.leaflet.document'];

      const recordSets = await Promise.all(collections.map(async (collection) => {
        try {
          const records = await getCollectionRecords(currentDid, collection, { limit: 50 });
          return records.map(record => ({ ...record, _collection: collection }));
        } catch (error) {
          console.warn(`Failed to load ${collection} records:`, error);
          return [];
        }
      }));

      const records = recordSets.flat();
      const seen = new Set<string>();
      const uniqueRecords = records.filter(record => {
        const key = record.uri || `${record._collection}:${record.cid || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (uniqueRecords.length === 0) {
        modal.innerHTML = `
          <div class="modal-content">
            <h2>No Publications Found</h2>
            <p>You don't have any leaflet publications yet.</p>
            <p style="font-size: 0.9em; color: var(--text-muted);">
              Collections checked: <code>site.standard.document</code>, <code>pub.leaflet.document</code>
            </p>
            <button class="button button-secondary modal-close">Close</button>
          </div>
        `;
        modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
        return;
      }

      this.showLeafletRecordSelector(modal, uniqueRecords);
    } catch (error) {
      console.error('Failed to load leaflet records:', error);
      modal.innerHTML = `
        <div class="modal-content">
          <h2>Error</h2>
          <p>Failed to load leaflet records: ${error instanceof Error ? error.message : 'Unknown error'}</p>
          <button class="button button-secondary modal-close">Close</button>
        </div>
      `;
      modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    }
  }

  showLeafletRecordSelector(modal: HTMLElement, records: any[]) {
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Select Leaflet Publications</h2>
        <p>Choose which leaflet.pub articles to display on your garden</p>
        <div class="record-list" style="max-height: 400px; overflow-y: auto; margin: 1rem 0;">
          ${records.map((record, idx) => {
      const rkey = record.uri?.split('/').pop() || idx.toString();
      const value = record.value || {};
      const title = value.title || 'Untitled Article';
      let subtitle = '';
      if (value.publishedAt) {
        try {
          subtitle = new Date(value.publishedAt).toLocaleDateString();
        } catch {
          subtitle = value.publishedAt;
        }
      }
      return `
              <label class="record-item" style="display: flex; align-items: center; padding: 0.75rem; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 0.5rem; cursor: pointer;">
                <input type="checkbox" value="${rkey}" data-uri="${record.uri || ''}" style="margin-right: 0.75rem;">
                <div>
                  <div style="font-weight: 500;">${escapeHtml(title)}</div>
                  ${subtitle ? `<div style="font-size: 0.85em; color: var(--text-muted);">${escapeHtml(subtitle)}</div>` : ''}
                </div>
              </label>
            `;
    }).join('')}
        </div>
        <div class="modal-actions" style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button class="button button-primary" data-action="add-selected">Add Selected</button>
          <button class="button button-secondary modal-close">Cancel</button>
        </div>
      </div>
    `;

    modal.querySelector('[data-action="add-selected"]')?.addEventListener('click', () => {
      const selected = Array.from(modal.querySelectorAll<HTMLInputElement>('.record-item input:checked'));

      if (selected.length === 0) {
        alert('Please select at least one publication.');
        return;
      }

      const uris = selected.map(input => input.getAttribute('data-uri')).filter(Boolean) as string[];

      const config = getConfig();
      const id = `section-${Date.now()}`;
      const section = {
        id,
        type: 'records',
        layout: 'leaflet',
        title: 'Leaflet Posts',
        records: uris
      };
      config.sections = [...(config.sections || []), section];

      modal.remove();
      this.renderCallback();
    });

    modal.querySelector('.modal-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  showCreateImageModal() {
    let modal = document.querySelector('create-image') as HTMLElement & { setOnClose: (cb: () => void) => void; show: () => void };

    if (!modal) {
      modal = document.createElement('create-image') as any;
      document.body.appendChild(modal);
    }

    modal.setOnClose(() => {
      this.renderCallback();
    });

    modal.show();
  }

  showCreateContentModal() {
    let modal = document.querySelector('create-content') as HTMLElement & { setOnClose: (cb: () => void) => void; show: () => void };

    if (!modal) {
      modal = document.createElement('create-content') as any;
      document.body.appendChild(modal);
    }

    modal.setOnClose(() => {
      this.renderCallback();
    });

    modal.show();
  }
}
