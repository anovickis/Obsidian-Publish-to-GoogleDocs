// themes.ts — Document style presets for exported HTML
//
// Each theme defines inline CSS values applied during cleanHtmlForGoogleDocs().
// Themes control fonts, heading styles, code block appearance, callout colors,
// and overall document feel. The 'default' theme matches the v1.0.1 output exactly.

import { ThemeName } from './types';

// ---- Theme Definition ----

export interface Theme {
    name: string;
    description: string;

    // Body
    fontFamily: string;
    fontSize: string;
    lineHeight: string;
    maxWidth: string;
    textColor: string;

    // Headings
    headingFontFamily: string;
    headingColor: string;
    h1Size: string;
    h2Size: string;
    h3Size: string;

    // Code
    codeFontFamily: string;
    codeFontSize: string;
    codeBackground: string;
    codeBlockBackground: string;
    codeBlockPadding: string;

    // Blockquote
    blockquoteBorderColor: string;
    blockquoteTextColor: string;

    // Table
    tableBorderColor: string;
    tableHeaderBackground: string;

    // Callout overrides (null = use default CALLOUT_COLORS)
    calloutBackground: string;

    // Links
    linkColor: string;
}

// ---- Theme Presets ----

const DEFAULT_THEME: Theme = {
    name: 'Default',
    description: 'Clean sans-serif, matches v1 output',
    fontFamily: 'Arial, sans-serif',
    fontSize: '14px',
    lineHeight: '1.6',
    maxWidth: '800px',
    textColor: '#000000',
    headingFontFamily: 'Arial, sans-serif',
    headingColor: '#000000',
    h1Size: '2em',
    h2Size: '1.5em',
    h3Size: '1.17em',
    codeFontFamily: "'Courier New', monospace",
    codeFontSize: '13px',
    codeBackground: '#f5f5f5',
    codeBlockBackground: '#f5f5f5',
    codeBlockPadding: '16px',
    blockquoteBorderColor: '#ccc',
    blockquoteTextColor: '#666',
    tableBorderColor: '#ddd',
    tableHeaderBackground: '#f5f5f5',
    calloutBackground: '#f8f9fa',
    linkColor: '#1a73e8',
};

const ACADEMIC_THEME: Theme = {
    name: 'Academic',
    description: 'Serif fonts, conservative styling for papers',
    fontFamily: "'Times New Roman', Georgia, serif",
    fontSize: '12pt',
    lineHeight: '1.8',
    maxWidth: '750px',
    textColor: '#1a1a1a',
    headingFontFamily: "'Times New Roman', Georgia, serif",
    headingColor: '#1a1a1a',
    h1Size: '18pt',
    h2Size: '14pt',
    h3Size: '12pt',
    codeFontFamily: "'Courier New', monospace",
    codeFontSize: '10pt',
    codeBackground: '#f0f0f0',
    codeBlockBackground: '#f0f0f0',
    codeBlockPadding: '12px',
    blockquoteBorderColor: '#999',
    blockquoteTextColor: '#333',
    tableBorderColor: '#000',
    tableHeaderBackground: '#e8e8e8',
    calloutBackground: '#f5f5f5',
    linkColor: '#0000cc',
};

const BUSINESS_THEME: Theme = {
    name: 'Business',
    description: 'Professional, clean, blue accents',
    fontFamily: "'Segoe UI', Calibri, Arial, sans-serif",
    fontSize: '11pt',
    lineHeight: '1.5',
    maxWidth: '800px',
    textColor: '#333333',
    headingFontFamily: "'Segoe UI', Calibri, Arial, sans-serif",
    headingColor: '#1b3a5c',
    h1Size: '22pt',
    h2Size: '16pt',
    h3Size: '13pt',
    codeFontFamily: "Consolas, 'Courier New', monospace",
    codeFontSize: '10pt',
    codeBackground: '#eef2f7',
    codeBlockBackground: '#eef2f7',
    codeBlockPadding: '14px',
    blockquoteBorderColor: '#1b3a5c',
    blockquoteTextColor: '#555',
    tableBorderColor: '#b0c4de',
    tableHeaderBackground: '#1b3a5c',
    calloutBackground: '#f0f4f8',
    linkColor: '#1b3a5c',
};

const MINIMAL_THEME: Theme = {
    name: 'Minimal',
    description: 'Sparse, lots of whitespace, subtle styling',
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: '15px',
    lineHeight: '1.75',
    maxWidth: '680px',
    textColor: '#222',
    headingFontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    headingColor: '#222',
    h1Size: '1.8em',
    h2Size: '1.3em',
    h3Size: '1.1em',
    codeFontFamily: "'SF Mono', Menlo, monospace",
    codeFontSize: '13px',
    codeBackground: '#fafafa',
    codeBlockBackground: '#fafafa',
    codeBlockPadding: '20px',
    blockquoteBorderColor: '#e0e0e0',
    blockquoteTextColor: '#888',
    tableBorderColor: '#eee',
    tableHeaderBackground: '#fafafa',
    calloutBackground: '#fafafa',
    linkColor: '#555',
};

const COLORFUL_THEME: Theme = {
    name: 'Colorful',
    description: 'Vibrant colors, playful feel',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
    fontSize: '14px',
    lineHeight: '1.65',
    maxWidth: '800px',
    textColor: '#2d3436',
    headingFontFamily: "'Inter', 'Segoe UI', sans-serif",
    headingColor: '#6c5ce7',
    h1Size: '2em',
    h2Size: '1.5em',
    h3Size: '1.2em',
    codeFontFamily: "'Fira Code', 'Courier New', monospace",
    codeFontSize: '13px',
    codeBackground: '#ffeaa7',
    codeBlockBackground: '#2d3436',
    codeBlockPadding: '16px',
    blockquoteBorderColor: '#00cec9',
    blockquoteTextColor: '#636e72',
    tableBorderColor: '#dfe6e9',
    tableHeaderBackground: '#6c5ce7',
    calloutBackground: '#f8f9fa',
    linkColor: '#e17055',
};

// ---- Theme Registry ----

export const THEMES: Record<ThemeName, Theme> = {
    default: DEFAULT_THEME,
    academic: ACADEMIC_THEME,
    business: BUSINESS_THEME,
    minimal: MINIMAL_THEME,
    colorful: COLORFUL_THEME,
};

/**
 * Get a theme by name, falling back to default if not found.
 */
export function getTheme(name: ThemeName): Theme {
    return THEMES[name] || THEMES['default'];
}

/**
 * Get all theme names and descriptions for settings dropdown.
 */
export function getThemeOptions(): { value: ThemeName; label: string; description: string }[] {
    return (Object.keys(THEMES) as ThemeName[]).map((key) => ({
        value: key,
        label: THEMES[key].name,
        description: THEMES[key].description,
    }));
}
