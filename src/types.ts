// types.ts — Shared interfaces and constants for Publish to Google Docs plugin

// ---- Plugin Settings ----

export interface PluginSettings {
    clientId: string;
    clientSecret: string;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: number;       // epoch ms when access token expires
    userEmail: string;         // email of the authenticated Google account
    defaultFolderId: string;   // Google Drive folder ID for new docs (optional)
}

export const DEFAULT_SETTINGS: PluginSettings = {
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    tokenExpiry: 0,
    userEmail: '',
    defaultFolderId: '',
};

// ---- Google API Endpoints ----

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';

// Narrowest scope: only access files this app created
export const SCOPES = 'https://www.googleapis.com/auth/drive.file';

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
