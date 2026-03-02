// footnote-handler.ts — Obsidian footnote extraction and rendering
//
// Handles two phases:
//   1. Extraction: pulls [^id] references and [^id]: definitions from raw markdown,
//      replacing references with placeholders (before Obsidian rendering)
//   2. Restoration: replaces placeholders in HTML with superscript numbers and
//      appends a "Notes" section at the end of the document
//
// Supports both numbered ([^1]) and named ([^note]) footnotes.
// Multi-line footnote definitions are supported (indented continuation lines).

// ---- Types ----

export interface FootnoteExtraction {
    id: string;          // The footnote identifier ("1", "myNote", etc.)
    placeholder: string; // Replacement token in the markdown (e.g., "GDOCS_FN0")
    definition: string;  // The footnote content text
}

// ---- Extraction (pre-rendering) ----

/**
 * Extract footnote definitions and references from markdown.
 *
 * Definitions: [^id]: content (possibly multi-line with indentation)
 * References: [^id] in the body text
 *
 * Returns cleaned markdown (definitions removed, references replaced with
 * placeholders) and the list of footnote extractions.
 */
export function extractFootnotes(markdown: string): {
    cleaned: string;
    footnotes: FootnoteExtraction[];
} {
    const definitionMap: Record<string, string> = {};

    // Phase 1: Extract all footnote definitions
    // Matches [^id]: content, including multi-line definitions where
    // continuation lines are indented with spaces/tabs
    let cleaned = markdown.replace(
        /^\[\^([^\]]+)\]:\s*(.*(?:\n(?:[ \t]+.+))*)/gm,
        (_match, id: string, content: string) => {
            // Clean up the definition: join continuation lines, trim
            const cleanContent = content
                .split('\n')
                .map((line: string) => line.trim())
                .join(' ')
                .trim();
            definitionMap[id] = cleanContent;
            return ''; // Remove the definition from the body
        },
    );

    // Phase 2: Extract inline references and assign sequential numbers
    const footnotes: FootnoteExtraction[] = [];
    const seenIds: Record<string, FootnoteExtraction> = {};

    cleaned = cleaned.replace(/\[\^([^\]]+)\]/g, (_match, id: string) => {
        // Reuse existing extraction for repeated references to the same footnote
        if (seenIds[id]) {
            return seenIds[id].placeholder;
        }

        const extraction: FootnoteExtraction = {
            id,
            placeholder: `GDOCS_FN${footnotes.length}`,
            definition: definitionMap[id] || `[Footnote "${id}" not defined]`,
        };

        footnotes.push(extraction);
        seenIds[id] = extraction;
        return extraction.placeholder;
    });

    return { cleaned, footnotes };
}

// ---- Restoration (post-rendering) ----

/**
 * Replace footnote placeholders in HTML with superscript numbers and
 * append a "Notes" endnotes section at the bottom.
 */
export function restoreFootnotesInHtml(
    html: string,
    footnotes: FootnoteExtraction[],
): string {
    if (footnotes.length === 0) return html;

    let result = html;

    // Replace each placeholder with a styled superscript number
    for (let i = 0; i < footnotes.length; i++) {
        const fn = footnotes[i];
        const num = i + 1;
        // The placeholder may appear inside <p> tags or other HTML elements
        const superscript =
            `<sup style="color:#448aff;font-size:11px;font-weight:bold;` +
            `cursor:default;vertical-align:super;">[${num}]</sup>`;
        result = result.split(fn.placeholder).join(superscript);
    }

    // Build the endnotes section
    const noteItems = footnotes.map((fn, i) => {
        const num = i + 1;
        return (
            `<p style="font-size:13px;color:#444;margin:6px 0;line-height:1.5;">` +
            `<sup style="color:#448aff;font-weight:bold;">[${num}]</sup> ` +
            `${escapeHtml(fn.definition)}</p>`
        );
    });

    const notesSection =
        `\n<hr style="border:none;border-top:1px solid #ddd;margin-top:32px;">` +
        `\n<h3 style="font-size:16px;margin-bottom:8px;">Notes</h3>` +
        `\n${noteItems.join('\n')}`;

    // Insert before the closing </body> or at the end
    if (result.includes('</body>')) {
        result = result.replace('</body>', `${notesSection}\n</body>`);
    } else {
        result += notesSection;
    }

    return result;
}

// ---- Utility ----

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
