// embed-resolver.ts — Resolve Obsidian transclusion embeds before conversion
//
// Handles: ![[note]], ![[note#section]], ![[note#^blockid]], ![[note|display]]
// Skips image embeds (![[image.png]]) which are handled by the image pipeline.
// Recursive with configurable depth limit to prevent infinite loops.

import { App, TFile } from 'obsidian';

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|bmp|webp|tiff?|ico|avif)$/i;
const MAX_EMBED_DEPTH = 5;

/**
 * Resolve all ![[note]] transclusion embeds in the markdown by inlining
 * the referenced content. Processes recursively up to MAX_EMBED_DEPTH levels.
 *
 * @param markdown - The raw markdown with embed syntax
 * @param app - Obsidian App instance (for vault access and link resolution)
 * @param sourceFile - The file being converted (for resolving relative links)
 * @returns Markdown with embeds replaced by their content
 */
export async function resolveEmbeds(
    markdown: string,
    app: App,
    sourceFile: TFile,
    depth: number = 0,
): Promise<string> {
    if (depth >= MAX_EMBED_DEPTH) return markdown;

    // Match ![[path]] and ![[path|display]] but NOT image files
    // The image pipeline handles image embeds separately
    const embedRegex = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
    const matches = [...markdown.matchAll(embedRegex)];

    if (matches.length === 0) return markdown;

    let result = markdown;

    for (const match of matches) {
        const fullMatch = match[0];
        const linkPath = match[1].trim();

        // Skip image embeds — handled by extractImageEmbeds in converter.ts
        if (IMAGE_EXTENSIONS.test(linkPath)) continue;

        // Parse optional section or block anchor
        const hashIndex = linkPath.indexOf('#');
        const filePart = hashIndex >= 0 ? linkPath.slice(0, hashIndex) : linkPath;
        const anchor = hashIndex >= 0 ? linkPath.slice(hashIndex + 1) : null;

        // Resolve the target file in the vault
        const targetFile = app.metadataCache.getFirstLinkpathDest(
            filePart || sourceFile.basename,
            sourceFile.path,
        );

        if (!targetFile || !(targetFile instanceof TFile)) {
            // File not found — leave a visible placeholder
            const replacement = `> [!warning] Embed not found: ${linkPath}`;
            result = result.replace(fullMatch, replacement);
            continue;
        }

        // Skip non-markdown files
        if (targetFile.extension !== 'md') continue;

        // Read the target file
        let content = await app.vault.read(targetFile);

        // Strip frontmatter from embedded content (don't want nested YAML)
        content = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

        // Extract specific section or block if anchored
        if (anchor) {
            if (anchor.startsWith('^')) {
                // Block reference: ^blockid
                content = extractBlock(content, anchor.slice(1));
            } else {
                // Section reference: #heading
                content = extractSection(content, anchor);
            }
        }

        // Recursively resolve embeds in the inlined content
        content = await resolveEmbeds(content, app, targetFile, depth + 1);

        // Replace the embed with the resolved content
        result = result.replace(fullMatch, content);
    }

    return result;
}

/**
 * Extract a specific section from markdown, starting at the given heading
 * and ending at the next heading of the same or higher level.
 */
function extractSection(markdown: string, heading: string): string {
    const lines = markdown.split('\n');
    // Normalize the heading for comparison (Obsidian links use dash-separated words)
    const normalized = heading.toLowerCase().replace(/-/g, ' ').trim();

    let inSection = false;
    let sectionLevel = 0;
    const sectionLines: string[] = [];

    for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

        if (headingMatch) {
            const level = headingMatch[1].length;
            const text = headingMatch[2].trim().toLowerCase();

            if (!inSection && text === normalized) {
                inSection = true;
                sectionLevel = level;
                sectionLines.push(line);
                continue;
            }

            // Stop at the next heading of same or higher level
            if (inSection && level <= sectionLevel) {
                break;
            }
        }

        if (inSection) {
            sectionLines.push(line);
        }
    }

    if (sectionLines.length === 0) {
        return `*[Section "${heading}" not found]*`;
    }

    return sectionLines.join('\n');
}

/**
 * Extract a specific block by its ^blockid.
 * In Obsidian, a block ID is appended to the end of a paragraph, list item,
 * or other block element: "Some text ^blockid"
 */
function extractBlock(markdown: string, blockId: string): string {
    const lines = markdown.split('\n');

    for (const line of lines) {
        // Match lines ending with ^blockId (possibly followed by whitespace)
        const pattern = new RegExp(`\\^${escapeRegExp(blockId)}\\s*$`);
        if (pattern.test(line)) {
            // Return the line content without the block ID
            return line.replace(pattern, '').trim();
        }
    }

    return `*[Block ^${blockId} not found]*`;
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
