/**
 * Shared Type Definitions for spores.garden
 */

// ============================================
// Site Configuration Types
// ============================================

export interface SiteConfig {
  $type: string;
  title: string;
  subtitle?: string;
  theme?: ThemeConfig;
}

export interface Section {
  id: string;
  type: 'profile' | 'records' | 'content' | 'block' | 'share-to-bluesky' | 'collected-flowers';
  layout?: string;
  title?: string;
  ref?: string;
  collection?: string;
  rkey?: string;
  records?: string[];
  content?: string;
  format?: 'text' | 'markdown' | 'html';
  hideHeader?: boolean;
}

export interface ThemeConfig {
  preset?: string;
  colors?: Record<string, string>;
  fonts?: Record<string, string>;
}

// ============================================
// AT Protocol Types
// ============================================

export interface ATRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}

export interface ExtractedFields {
  title?: string;
  content?: string;
  url?: string;
  image?: string;
  images?: string[];
  date?: Date;
  author?: string;
  tags?: string[];
  items?: unknown[];
  $type?: string;
  uri?: string;
  cid?: string;
  $raw?: unknown;
}

export interface BacklinkRecord {
  did: string;
  collection: string;
  rkey: string;
}

export interface BacklinksResponse {
  records: BacklinkRecord[];
  cursor?: string;
}

// ============================================
// OAuth Types
// ============================================

export interface OAuthConfig {
  oauth: {
    clientId: string;
    redirectUri: string;
    scope?: string;
  };
}

export interface OAuthSession {
  info: {
    sub: string;
  };
}

/**
 * Options for AT Protocol client initialization.
 * Uses 'any' for handler to avoid strict type incompatibility with atcute internals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ATClientOptions = { handler: any; serviceUrl?: string };

// ============================================
// Component Types
// ============================================

export type WelcomeAction = 'load-records' | 'create-content' | 'select-bsky-posts';

export interface WelcomeModalElement extends HTMLElement {
  setOnClose: (callback: () => void) => void;
  setOnBack: (callback: () => void) => void;
  triggerAction: (action: WelcomeAction) => void;
}

export interface CreateContentElement extends HTMLElement {
  setOnClose: (callback: () => void) => void;
  show: () => void;
}

// ============================================
// Record Query Options
// ============================================

export interface GetRecordOptions {
  useSlingshot?: boolean;
}

export interface ListRecordsOptions {
  limit?: number;
  cursor?: string;
  reverse?: boolean;
}
