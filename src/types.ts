// types.ts — Shared interfaces and constants for Publish to Google Docs plugin

// ---- License Tiers & Features ----

export type LicenseTier = 'free' | 'pro' | 'premium';

export type Feature =
    | 'docx-export'
    | 'pdf-export'
    | 'batch-publish'
    | 'custom-themes'
    | 'toc'
    | 'wikilink-resolve'
    | 'header-footer'
    | 'mermaid'
    | 'true-update'
    | 'auto-publish'
    | 'history'
    | 'team';

export type ThemeName = 'default' | 'academic' | 'business' | 'minimal' | 'colorful';

// ---- Plugin Settings ----

export interface PluginSettings {
    // Google OAuth
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: number;       // epoch ms when access token expires
    userEmail: string;         // email of the authenticated Google account
    defaultFolderId: string;   // Google Drive folder ID for new docs (optional)

    // License
    licenseKey: string;
    licenseType: LicenseTier;
    licenseValidatedAt: number;   // epoch ms of last successful validation
    licenseEmail: string;         // email from Gumroad purchase
    licenseExpiresAt: number | null;  // null = lifetime, epoch ms for gift/sub

    // Pro settings
    theme: ThemeName;
    includeToc: boolean;
    customHeaderText: string;
    customFooterText: string;
    resolveWikilinks: boolean;

    // Premium settings
    autoPublishOnSave: boolean;

    // Internal
    lastShownVersion: string;  // for "What's New" modal
}

export const DEFAULT_SETTINGS: PluginSettings = {
    // Google OAuth
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    tokenExpiry: 0,
    userEmail: '',
    defaultFolderId: '',

    // License
    licenseKey: '',
    licenseType: 'free',
    licenseValidatedAt: 0,
    licenseEmail: '',
    licenseExpiresAt: null,

    // Pro settings
    theme: 'default',
    includeToc: false,
    customHeaderText: '',
    customFooterText: '',
    resolveWikilinks: false,

    // Premium settings
    autoPublishOnSave: false,

    // Internal
    lastShownVersion: '',
};

// ---- Google API Endpoints ----

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

// Narrowest scope: only access files this app created
export const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// ---- Gumroad License Validation ----

export const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

// Product permalinks on Gumroad — set these after creating your products
// These are NOT secrets, they're public product identifiers
export const GUMROAD_PRO_PERMALINK = 'svsnaw';
export const GUMROAD_PREMIUM_PERMALINK = 'publish-gdocs-premium';

// ---- Conversion Options ----

export type ImageMode = 'upload' | 'embed';

export interface ConvertOptions {
    imageMode: ImageMode;      // 'upload' = Drive URLs, 'embed' = base64 data URIs
    theme: ThemeName;          // style preset for HTML output
    includeToc: boolean;       // auto-generate table of contents from headings
    headerText?: string;       // custom header text above title
    footerText?: string;       // custom footer text at document end
}

export const DEFAULT_CONVERT_OPTIONS: ConvertOptions = {
    imageMode: 'upload',
    theme: 'default',
    includeToc: false,
};

// ---- Conversion Types ----

export interface ExtractedMath {
    placeholder: string;   // e.g., %%MATH_0%%
    raw: string;           // original LaTeX including delimiters ($...$ or $$...$$)
    display: boolean;      // true for $$...$$, false for $...$
}

export interface LocalImage {
    imgTag: string;        // the full <img ...> tag in HTML
    src: string;           // the src attribute value
    vaultPath: string;     // resolved vault-relative path
    isSvg: boolean;        // whether the source is an SVG
}

// ---- Google API Response Types ----

export interface DriveFileResponse {
    id: string;
    name: string;
    webViewLink: string;
    mimeType: string;
}
