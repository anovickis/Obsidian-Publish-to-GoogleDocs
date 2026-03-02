// numbering.ts — Auto-number figures, tables, and equations in exported HTML
//
// Post-processes the final HTML to add sequential numbering:
//   - Block-level images → "Figure N: [alt text]" captions
//   - Tables → "Table N" labels
//   - Equations with \tag{N} are preserved (not renumbered)
//
// This runs after all other HTML processing, just before the final wrap.

/**
 * Auto-number figures and tables in the HTML output.
 *
 * Figures: Block-level images (sole content of a <p> tag or standalone <img>)
 * get wrapped in <figure> with a <figcaption>. The alt text becomes the caption.
 *
 * Tables: Each <table> gets a preceding "Table N" label.
 *
 * Equations: \tag{} numbering is preserved as-is from the source LaTeX.
 * No renumbering is applied to equations.
 */
export function autoNumberFiguresAndTables(html: string): string {
    let figureCount = 0;
    let tableCount = 0;
    let result = html;

    // ---- Figure numbering ----
    // Match block-level images: <img> that is the sole content of a <p> tag
    // (This is how Obsidian renders images on their own line)
    result = result.replace(
        /<p>\s*(<img\s[^>]*>)\s*<\/p>/gi,
        (_match, imgTag: string) => {
            figureCount++;

            // Extract alt text for the caption
            const altMatch = imgTag.match(/alt="([^"]*)"/);
            const altText = altMatch?.[1] || '';

            // Build caption: "Figure N: description" or just "Figure N"
            const captionText = altText
                ? `Figure ${figureCount}: ${altText}`
                : `Figure ${figureCount}`;

            return (
                `<figure style="text-align:center;margin:20px 0;">` +
                imgTag +
                `<figcaption style="font-size:13px;color:#555;margin-top:8px;` +
                `font-style:italic;text-align:center;">${captionText}</figcaption>` +
                `</figure>`
            );
        },
    );

    // Also catch <img> tags wrapped in <figure> that already exist
    // (from the image pipeline or restoreMathAsImages with display:block)
    // Skip these — they're already handled

    // ---- Table numbering ----
    // Insert "Table N" label before each <table> tag
    // Only number tables that don't already have a caption or are callout tables
    // (Callout tables have style with border-left, which is distinctive)
    result = result.replace(
        /<table([^>]*)>/gi,
        (_match, attrs: string) => {
            // Skip callout tables (they have border-left styling from callout conversion)
            if (attrs.includes('border-left')) {
                return `<table${attrs}>`;
            }

            tableCount++;
            return (
                `<p style="font-size:13px;color:#555;font-style:italic;` +
                `margin-bottom:4px;text-align:center;">Table ${tableCount}</p>` +
                `<table${attrs}>`
            );
        },
    );

    return result;
}

/**
 * Add figure and table counts to the document metadata.
 * Useful for generating a "List of Figures" or "List of Tables" in the future.
 */
export function countFiguresAndTables(html: string): { figures: number; tables: number } {
    const figures = (html.match(/<figure[\s>]/gi) || []).length;
    // Count tables but exclude callout tables
    const allTables = (html.match(/<table[\s>]/gi) || []).length;
    const calloutTables = (html.match(/<table[^>]*border-left/gi) || []).length;
    const tables = allTables - calloutTables;

    return { figures, tables };
}
