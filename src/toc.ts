// toc.ts — Table of Contents generator
//
// Parses heading tags from HTML and generates a nested TOC list.
// Adds id attributes to headings for internal anchor links.
// Works with Google Docs imported HTML (anchor links become bookmarks).

// ---- Types ----

interface TocEntry {
    level: number;   // 1-6
    text: string;    // heading text content
    id: string;      // anchor id for linking
}

// ---- Heading Parser ----

/**
 * Extract headings from HTML string.
 * Returns heading entries with level, text, and generated id.
 */
function parseHeadings(html: string): TocEntry[] {
    const entries: TocEntry[] = [];
    // Match <h1>...<h6> tags, capturing level and inner content
    const headingRegex = /<h([1-6])(?:[^>]*)>([\s\S]*?)<\/h\1>/gi;
    let match;
    let counter = 0;

    while ((match = headingRegex.exec(html)) !== null) {
        const level = parseInt(match[1], 10);
        // Strip HTML tags from heading content to get plain text
        const text = match[2].replace(/<[^>]*>/g, '').trim();
        if (!text) continue;

        counter++;
        // Generate a URL-safe id from the heading text
        const id = 'toc-' + counter + '-' + text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 50);

        entries.push({ level, text, id });
    }

    return entries;
}

// ---- TOC Builder ----

/**
 * Build a nested HTML list from TOC entries.
 * Uses <ul> with indentation to represent heading hierarchy.
 */
function buildTocHtml(entries: TocEntry[]): string {
    if (entries.length === 0) return '';

    const lines: string[] = [];
    lines.push('<div style="margin:20px 0;padding:16px;background:#f8f9fa;border-radius:4px;">');
    lines.push('<p style="margin:0 0 8px 0;font-weight:bold;">Table of Contents</p>');
    lines.push('<ul style="list-style-type:none;padding-left:0;margin:0;">');

    // Find the minimum heading level to use as base indentation
    const minLevel = Math.min(...entries.map(e => e.level));

    for (const entry of entries) {
        const indent = (entry.level - minLevel) * 20;
        lines.push(
            `<li style="padding-left:${indent}px;margin:4px 0;">` +
            `<a href="#${entry.id}" style="text-decoration:none;color:#1a73e8;">` +
            `${entry.text}</a></li>`,
        );
    }

    lines.push('</ul>');
    lines.push('</div>');

    return lines.join('\n');
}

// ---- Public API ----

/**
 * Add a table of contents to the HTML document.
 * Adds id attributes to all headings and inserts a TOC block after the first <h1>.
 *
 * @param html - The HTML content (after cleanHtmlForGoogleDocs)
 * @returns HTML with TOC inserted and heading ids added
 */
export function addTableOfContents(html: string): string {
    const entries = parseHeadings(html);
    if (entries.length === 0) return html;

    // Add id attributes to headings in the HTML
    let result = html;
    let entryIndex = 0;
    result = result.replace(/<h([1-6])(?:[^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, content) => {
        const text = content.replace(/<[^>]*>/g, '').trim();
        if (!text || entryIndex >= entries.length) return match;

        const entry = entries[entryIndex];
        entryIndex++;
        return `<h${level} id="${entry.id}">${content}</h${level}>`;
    });

    // Build the TOC HTML
    const tocHtml = buildTocHtml(entries);

    // Insert TOC after the first <h1> (the document title)
    const h1EndIndex = result.indexOf('</h1>');
    if (h1EndIndex !== -1) {
        const insertAt = h1EndIndex + '</h1>'.length;
        result = result.slice(0, insertAt) + '\n' + tocHtml + '\n' + result.slice(insertAt);
    } else {
        // No h1 found — insert at the beginning
        result = tocHtml + '\n' + result;
    }

    return result;
}
