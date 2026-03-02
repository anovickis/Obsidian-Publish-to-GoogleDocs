// citation-processor.ts — BibTeX parser and citation formatter
//
// Parses .bib files, processes [@citekey] Pandoc-style citations in markdown,
// and generates formatted bibliography sections. Supports three styles:
// numbered [1], author-year Smith (2024), author-year-paren (Smith, 2024).

import { App, TFile } from 'obsidian';
import { CitationStyle } from './types';

// ---- BibTeX Types ----

export interface BibEntry {
    key: string;
    type: string;       // article, book, inproceedings, misc, phdthesis, etc.
    fields: Record<string, string>;
    // Convenience accessors (populated after parsing)
    author: string;
    title: string;
    year: string;
    journal?: string;
    volume?: string;
    pages?: string;
    publisher?: string;
    booktitle?: string;
    doi?: string;
    url?: string;
}

export interface CitationResult {
    processed: string;           // markdown with citations replaced
    usedEntries: BibEntry[];     // entries referenced, in order of first appearance
    bibliographyHtml: string;    // formatted bibliography section HTML
}

// ---- BibTeX Parser ----

/**
 * Parse a BibTeX file into a map of citekey → BibEntry.
 * Handles basic BibTeX: @type{key, field = {value}, field = "value", field = number}
 */
export function parseBibFile(content: string): Map<string, BibEntry> {
    const entries = new Map<string, BibEntry>();

    // Match @type{key, ... } blocks
    const entryRegex = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?:\n\s*\})/g;
    let match: RegExpExecArray | null;

    while ((match = entryRegex.exec(content)) !== null) {
        const type = match[1].toLowerCase();
        const key = match[2].trim();
        const body = match[3];

        // Skip @comment, @preamble, @string
        if (type === 'comment' || type === 'preamble' || type === 'string') continue;

        const fields: Record<string, string> = {};

        // Parse field = {value} or field = "value" or field = number
        const fieldRegex = /(\w+)\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))/g;
        let fieldMatch: RegExpExecArray | null;

        while ((fieldMatch = fieldRegex.exec(body)) !== null) {
            const fieldName = fieldMatch[1].toLowerCase();
            const value = (fieldMatch[2] ?? fieldMatch[3] ?? fieldMatch[4] ?? '').trim();
            fields[fieldName] = cleanBibValue(value);
        }

        entries.set(key, {
            key,
            type,
            fields,
            author: fields.author || '',
            title: fields.title || '',
            year: fields.year || '',
            journal: fields.journal,
            volume: fields.volume,
            pages: fields.pages,
            publisher: fields.publisher,
            booktitle: fields.booktitle,
            doi: fields.doi,
            url: fields.url,
        });
    }

    return entries;
}

/** Clean BibTeX field values: remove LaTeX commands, extra braces */
function cleanBibValue(value: string): string {
    return value
        .replace(/\{([^{}]*)\}/g, '$1')  // remove braces
        .replace(/\\textit\{([^}]*)\}/g, '$1')
        .replace(/\\textbf\{([^}]*)\}/g, '$1')
        .replace(/\\emph\{([^}]*)\}/g, '$1')
        .replace(/~/g, ' ')
        .replace(/\\\&/g, '&')
        .replace(/--/g, '–')
        .trim();
}

// ---- Author Formatting ----

/** Parse "Last, First and Last, First" into formatted author strings */
function formatAuthors(authorField: string, style: CitationStyle): string {
    if (!authorField) return 'Unknown';

    const authors = authorField.split(/\s+and\s+/i).map((a) => a.trim());
    const formatted = authors.map((a) => {
        // "Last, First" → "Last"
        const parts = a.split(',');
        if (parts.length >= 2) {
            return parts[0].trim();
        }
        // "First Last" → "Last"
        const words = a.split(/\s+/);
        return words[words.length - 1];
    });

    if (formatted.length === 1) return formatted[0];
    if (formatted.length === 2) {
        const sep = style === 'author-year-paren' ? ' & ' : ' and ';
        return formatted[0] + sep + formatted[1];
    }
    return formatted[0] + ' et al.';
}

/** Format full author list for bibliography */
function formatFullAuthors(authorField: string): string {
    if (!authorField) return 'Unknown';
    const authors = authorField.split(/\s+and\s+/i).map((a) => a.trim());

    const formatted = authors.map((a) => {
        const parts = a.split(',');
        if (parts.length >= 2) {
            const last = parts[0].trim();
            const first = parts.slice(1).join(',').trim();
            // Get initials
            const initials = first.split(/\s+/).map((w) => w[0] + '.').join(' ');
            return `${last}, ${initials}`;
        }
        return a;
    });

    if (formatted.length <= 2) return formatted.join(' and ');
    return formatted.slice(0, -1).join(', ') + ', and ' + formatted[formatted.length - 1];
}

// ---- Citation Processing ----

/**
 * Process citations in markdown text.
 *
 * Supported syntax:
 *   [@key]              → single citation
 *   [@key1; @key2]      → multiple citations
 *   [@key, p. 45]       → with locator
 *   [-@key]             → suppress author (year only)
 */
export function processCitations(
    markdown: string,
    bibEntries: Map<string, BibEntry>,
    style: CitationStyle,
): CitationResult {
    const usedKeys: string[] = [];
    const usedSet = new Set<string>();

    // Track citation number for numbered style
    const keyToNumber = new Map<string, number>();
    let nextNumber = 1;

    function getNumber(key: string): number {
        if (!keyToNumber.has(key)) {
            keyToNumber.set(key, nextNumber++);
        }
        return keyToNumber.get(key)!;
    }

    // Match citation groups: [...]
    // Pattern: \[(@-?@\w[\w:./-]*(?:\s*,\s*[^;@\]]*)?(?:\s*;\s*-?@\w[\w:./-]*(?:\s*,\s*[^;@\]]*)?)*)\]
    const citationGroupRegex = /\[((?:-?@[\w:./-]+(?:\s*,\s*[^;@\]]*)?(?:\s*;\s*-?@[\w:./-]+(?:\s*,\s*[^;@\]]*)?)*))\]/g;

    const processed = markdown.replace(citationGroupRegex, (_match, group: string) => {
        // Split on semicolons to get individual citations
        const citations = group.split(';').map((c) => c.trim());
        const parts: string[] = [];

        for (const cite of citations) {
            // Parse: [-]@key[, locator]
            const citeMatch = cite.match(/^(-?)@([\w:./-]+)(?:\s*,\s*(.+))?$/);
            if (!citeMatch) continue;

            const suppressAuthor = citeMatch[1] === '-';
            const key = citeMatch[2];
            const locator = citeMatch[3]?.trim();

            const entry = bibEntries.get(key);
            if (!entry) {
                parts.push(`[?${key}]`);
                continue;
            }

            // Track usage
            if (!usedSet.has(key)) {
                usedSet.add(key);
                usedKeys.push(key);
            }

            let citText: string;
            switch (style) {
                case 'numbered': {
                    const num = getNumber(key);
                    citText = `${num}`;
                    if (locator) citText += `, ${locator}`;
                    break;
                }
                case 'author-year': {
                    const author = formatAuthors(entry.author, style);
                    if (suppressAuthor) {
                        citText = `(${entry.year}${locator ? ', ' + locator : ''})`;
                    } else {
                        citText = `${author} (${entry.year}${locator ? ', ' + locator : ''})`;
                    }
                    break;
                }
                case 'author-year-paren': {
                    const author = formatAuthors(entry.author, style);
                    if (suppressAuthor) {
                        citText = `${entry.year}${locator ? ', ' + locator : ''}`;
                    } else {
                        citText = `${author}, ${entry.year}${locator ? ', ' + locator : ''}`;
                    }
                    break;
                }
            }

            parts.push(citText);
        }

        if (parts.length === 0) return _match;

        // Format the group
        if (style === 'numbered') {
            return `[${parts.join(', ')}]`;
        } else if (style === 'author-year') {
            return parts.join('; ');
        } else {
            // author-year-paren: wrap everything in parens
            return `(${parts.join('; ')})`;
        }
    });

    // Collect used entries in order
    const usedEntries = usedKeys
        .map((k) => bibEntries.get(k))
        .filter((e): e is BibEntry => e !== undefined);

    const bibliographyHtml = formatBibliography(usedEntries, style);

    return { processed, usedEntries, bibliographyHtml };
}

// ---- Bibliography Formatting ----

/**
 * Format a bibliography section as HTML.
 */
function formatBibliography(entries: BibEntry[], style: CitationStyle): string {
    if (entries.length === 0) return '';

    const items = entries.map((entry, index) => {
        const num = index + 1;
        const authors = formatFullAuthors(entry.author);
        const title = entry.title;
        const year = entry.year;

        let details = '';
        if (entry.type === 'article') {
            details = formatArticle(entry);
        } else if (entry.type === 'book') {
            details = formatBook(entry);
        } else if (entry.type === 'inproceedings' || entry.type === 'conference') {
            details = formatInProceedings(entry);
        } else if (entry.type === 'phdthesis' || entry.type === 'mastersthesis') {
            details = formatThesis(entry);
        } else {
            details = formatMisc(entry);
        }

        const prefix = style === 'numbered'
            ? `<span style="margin-right:8px;">[${num}]</span>`
            : '';

        const doiLink = entry.doi
            ? ` <a href="https://doi.org/${entry.doi}" style="color:#448aff;">doi:${entry.doi}</a>`
            : '';

        return (
            `<p style="margin:4px 0;padding-left:${style === 'numbered' ? '36px' : '24px'};` +
            `text-indent:-${style === 'numbered' ? '36px' : '24px'};font-size:13px;">` +
            `${prefix}${authors} (${year}). <em>${title}</em>. ${details}${doiLink}</p>`
        );
    });

    return (
        `<hr style="border:none;border-top:1px solid #ddd;margin-top:32px;">` +
        `<h2 style="font-size:18px;margin-top:16px;">References</h2>` +
        items.join('\n')
    );
}

function formatArticle(e: BibEntry): string {
    let s = '';
    if (e.journal) s += `<em>${e.journal}</em>`;
    if (e.volume) s += `, ${e.volume}`;
    if (e.pages) s += `, ${e.pages}`;
    return s;
}

function formatBook(e: BibEntry): string {
    let s = '';
    if (e.publisher) s += `${e.publisher}`;
    return s;
}

function formatInProceedings(e: BibEntry): string {
    let s = '';
    if (e.booktitle) s += `In <em>${e.booktitle}</em>`;
    if (e.pages) s += `, pp. ${e.pages}`;
    return s;
}

function formatThesis(e: BibEntry): string {
    const thesisType = e.type === 'phdthesis' ? 'PhD thesis' : "Master's thesis";
    return `${thesisType}. ${e.fields.school || ''}`;
}

function formatMisc(e: BibEntry): string {
    const note = e.fields.note || e.fields.howpublished || '';
    return note;
}

// ---- Load BibTeX from Vault ----

/**
 * Load and parse a .bib file from the vault.
 */
export async function loadBibFile(
    app: App,
    bibPath: string,
): Promise<Map<string, BibEntry>> {
    if (!bibPath) return new Map();

    const file = app.vault.getAbstractFileByPath(bibPath);
    if (!file || !(file instanceof TFile)) {
        console.warn(`BibTeX file not found: ${bibPath}`);
        return new Map();
    }

    const content = await app.vault.read(file);
    return parseBibFile(content);
}
