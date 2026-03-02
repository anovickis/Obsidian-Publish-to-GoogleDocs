// wikilink-resolver.ts — Resolve [[wikilinks]] to Google Docs hyperlinks
//
// After Obsidian renders markdown to HTML, internal links appear as:
//   <a class="internal-link" data-href="NoteName" ...>display text</a>
//
// This module resolves them:
//   - If the linked note has a `google_doc` URL in frontmatter → real hyperlink
//   - Otherwise → bold text (matching previous behavior)
//
// Runs after step 6 (render) and before step 9 (cleanup) in the pipeline.

import { App, TFile } from 'obsidian';

/**
 * Resolve Obsidian internal links in rendered HTML to Google Docs hyperlinks.
 *
 * For each `<a class="internal-link">` found in the HTML:
 * 1. Look up the linked file in the vault
 * 2. Check its frontmatter for a `google_doc` URL
 * 3. If found, replace with a clickable hyperlink to the Google Doc
 * 4. If not found, replace with bold text
 *
 * @param html - Rendered HTML containing internal links
 * @param app - Obsidian App instance (for vault + metadata access)
 * @param sourceFile - The source file (for resolving relative links)
 * @returns HTML with resolved links
 */
export function resolveWikilinksInHtml(
    html: string,
    app: App,
    sourceFile: TFile,
): string {
    // Match Obsidian's rendered internal links
    // Pattern: <a data-href="..." class="internal-link" ...>text</a>
    // Note: data-href and class can appear in any order
    return html.replace(
        /<a\s[^>]*class="[^"]*internal-link[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
        (match, displayText: string) => {
            // Extract the data-href attribute (the link target)
            const hrefMatch = match.match(/data-href="([^"]*)"/);
            if (!hrefMatch) {
                return `<b>${displayText}</b>`;
            }

            const linkTarget = hrefMatch[1];

            // Resolve the linked file in the vault
            const linkedFile = app.metadataCache.getFirstLinkpathDest(
                linkTarget,
                sourceFile.path,
            );

            if (!linkedFile || !(linkedFile instanceof TFile)) {
                return `<b>${displayText}</b>`;
            }

            // Check frontmatter for google_doc URL
            const cache = app.metadataCache.getFileCache(linkedFile);
            const googleDocUrl = cache?.frontmatter?.google_doc;

            if (googleDocUrl && typeof googleDocUrl === 'string') {
                // Create a real hyperlink to the published Google Doc
                return `<a href="${escapeAttr(googleDocUrl)}" target="_blank" ` +
                    `style="color:#1a73e8;text-decoration:underline;">${displayText}</a>`;
            }

            // No Google Doc URL — fall back to bold text
            return `<b>${displayText}</b>`;
        },
    );
}

function escapeAttr(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
