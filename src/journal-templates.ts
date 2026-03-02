// journal-templates.ts — Academic journal formatting presets
//
// Pre-configured document formatting profiles for common journal styles:
// IEEE, APA, Nature, arXiv, General Academic.
// Applied during the document wrapping step (step 11 in converter.ts).

import { CitationStyle, JournalTemplateName } from './types';

// ---- Types ----

export interface JournalTemplate {
    name: string;
    description: string;
    // Structural rules
    twoColumn: boolean;
    doubleSpaced: boolean;
    numberedSections: boolean;
    citationStyleOverride: CitationStyle | null;  // null = use user setting
    // CSS that gets injected into the document
    css: string;
}

// ---- Template Definitions ----

const TEMPLATES: Record<Exclude<JournalTemplateName, 'none'>, JournalTemplate> = {
    ieee: {
        name: 'IEEE',
        description: 'Two-column, numbered sections, Times font, [1] citations',
        twoColumn: true,
        doubleSpaced: false,
        numberedSections: true,
        citationStyleOverride: 'numbered',
        css: `
            body {
                font-family: 'Times New Roman', Times, serif !important;
                font-size: 10pt !important;
                line-height: 1.2 !important;
                column-count: 2;
                column-gap: 24px;
                max-width: none !important;
                margin: 0 auto !important;
                padding: 0 16px !important;
            }
            h1 {
                column-span: all;
                text-align: center !important;
                font-size: 24pt !important;
                font-weight: normal !important;
                margin-bottom: 8px !important;
            }
            h2 {
                font-size: 10pt !important;
                text-transform: uppercase;
                text-align: center;
                margin-top: 12px !important;
                margin-bottom: 4px !important;
            }
            h2::before {
                counter-increment: section;
                content: counter(section, upper-roman) ". ";
            }
            h3 {
                font-size: 10pt !important;
                font-style: italic;
                margin-top: 8px !important;
                margin-bottom: 2px !important;
            }
            p { text-align: justify; text-indent: 1em; margin: 2px 0; }
            p:first-of-type { text-indent: 0; }
            figure { break-inside: avoid; column-span: all; }
            table { font-size: 9pt; break-inside: avoid; }
            pre { font-size: 8pt !important; }
            body { counter-reset: section; }
        `,
    },

    apa: {
        name: 'APA 7th Edition',
        description: 'Double-spaced, running header, author-year citations, 12pt serif',
        twoColumn: false,
        doubleSpaced: true,
        numberedSections: false,
        citationStyleOverride: 'author-year',
        css: `
            body {
                font-family: 'Times New Roman', Times, serif !important;
                font-size: 12pt !important;
                line-height: 2.0 !important;
                max-width: 6.5in !important;
                margin: 1in auto !important;
            }
            h1 {
                text-align: center !important;
                font-size: 12pt !important;
                font-weight: bold !important;
            }
            h2 {
                text-align: center !important;
                font-size: 12pt !important;
                font-weight: bold !important;
            }
            h3 {
                text-align: left !important;
                font-size: 12pt !important;
                font-weight: bold !important;
                font-style: italic;
            }
            p { text-indent: 0.5in; margin: 0; }
            blockquote {
                margin-left: 0.5in !important;
                text-indent: 0 !important;
            }
            figure figcaption { font-style: italic; }
        `,
    },

    nature: {
        name: 'Nature',
        description: 'Single column, compact, numbered citations, sans-serif',
        twoColumn: false,
        doubleSpaced: false,
        numberedSections: false,
        citationStyleOverride: 'numbered',
        css: `
            body {
                font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif !important;
                font-size: 11pt !important;
                line-height: 1.4 !important;
                max-width: 7in !important;
                margin: 0 auto !important;
            }
            h1 {
                font-size: 18pt !important;
                font-weight: bold !important;
                margin-bottom: 4px !important;
            }
            h2 {
                font-size: 13pt !important;
                font-weight: bold !important;
                margin-top: 16px !important;
                margin-bottom: 4px !important;
            }
            h3 {
                font-size: 11pt !important;
                font-weight: bold !important;
            }
            p { margin: 4px 0; }
            figure { text-align: center; margin: 16px 0; }
            figure figcaption {
                text-align: left;
                font-size: 10pt;
                color: #333;
            }
            pre { font-size: 9pt !important; background: #f5f5f5 !important; }
        `,
    },

    arxiv: {
        name: 'arXiv',
        description: 'Single column, Computer Modern-style, author-year citations',
        twoColumn: false,
        doubleSpaced: false,
        numberedSections: true,
        citationStyleOverride: 'author-year',
        css: `
            body {
                font-family: 'Computer Modern', 'Latin Modern', 'CMU Serif', Georgia, serif !important;
                font-size: 11pt !important;
                line-height: 1.5 !important;
                max-width: 6in !important;
                margin: 0 auto !important;
            }
            h1 {
                text-align: center !important;
                font-size: 17pt !important;
                font-weight: bold !important;
                margin-bottom: 16px !important;
            }
            h2 {
                font-size: 13pt !important;
                font-weight: bold !important;
                margin-top: 20px !important;
            }
            h2::before {
                counter-increment: section;
                content: counter(section) ". ";
            }
            h3 {
                font-size: 11pt !important;
                font-weight: bold !important;
            }
            p { text-align: justify; margin: 4px 0; }
            body { counter-reset: section; }
            pre {
                font-family: 'Courier New', monospace !important;
                font-size: 9pt !important;
            }
        `,
    },

    academic: {
        name: 'General Academic',
        description: 'Single column, double-spaced, numbered sections, 12pt serif',
        twoColumn: false,
        doubleSpaced: true,
        numberedSections: true,
        citationStyleOverride: null,  // use user's preference
        css: `
            body {
                font-family: 'Times New Roman', Times, serif !important;
                font-size: 12pt !important;
                line-height: 2.0 !important;
                max-width: 6.5in !important;
                margin: 1in auto !important;
            }
            h1 {
                text-align: center !important;
                font-size: 16pt !important;
                font-weight: bold !important;
                margin-bottom: 24px !important;
            }
            h2 {
                font-size: 14pt !important;
                font-weight: bold !important;
                margin-top: 24px !important;
            }
            h2::before {
                counter-increment: section;
                content: counter(section) ". ";
            }
            h3 {
                font-size: 12pt !important;
                font-weight: bold !important;
                font-style: italic;
            }
            p { text-indent: 0.5in; margin: 0; }
            body { counter-reset: section; }
            figure { text-align: center; margin: 24px 0; }
            table { margin: 24px auto; }
        `,
    },
};

// ---- Public API ----

/**
 * Get a journal template by name. Returns null for 'none'.
 */
export function getJournalTemplate(name: JournalTemplateName): JournalTemplate | null {
    if (name === 'none') return null;
    return TEMPLATES[name] || null;
}

/**
 * Get the CSS for a journal template (for injection into the document).
 */
export function getJournalTemplateCss(name: JournalTemplateName): string {
    const template = getJournalTemplate(name);
    return template ? template.css : '';
}

/**
 * Get the citation style override from a journal template.
 * Returns null if the template doesn't override the user's setting.
 */
export function getTemplateCitationStyle(name: JournalTemplateName): CitationStyle | null {
    const template = getJournalTemplate(name);
    return template?.citationStyleOverride ?? null;
}

/**
 * Get display options for the settings dropdown.
 */
export function getJournalTemplateOptions(): Array<{ value: string; label: string; description: string }> {
    return [
        { value: 'none', label: 'None', description: 'Use default theme styling' },
        { value: 'ieee', label: 'IEEE', description: 'Two-column, numbered, Times' },
        { value: 'apa', label: 'APA 7th', description: 'Double-spaced, author-year' },
        { value: 'nature', label: 'Nature', description: 'Compact, numbered, sans-serif' },
        { value: 'arxiv', label: 'arXiv', description: 'CM font, generous margins' },
        { value: 'academic', label: 'General Academic', description: 'Double-spaced, numbered' },
    ];
}
