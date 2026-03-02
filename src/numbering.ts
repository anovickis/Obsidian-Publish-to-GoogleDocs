// numbering.ts — Auto-number figures, tables, and equations in exported HTML
//
// Post-processes the final HTML to add sequential numbering:
//   - Block-level images → "Figure N: [alt text]" captions
//   - Tables → "Table N" labels
//   - Equations with \tag{N} are preserved (not renumbered)
//
// Also builds a label registry for cross-references when markers like
// {#fig:label}, {#tab:label}, {#eq:label} are present.
//
// This runs after all other HTML processing, just before the final wrap.

import { RefRegistry } from './cross-references';

// ---- Types ----

export interface NumberingResult {
    html: string;
    registry: RefRegistry;
}

/**
 * Auto-number figures and tables in the HTML output.
 * Also builds a label registry for cross-reference resolution.
 *
 * Figures: Block-level images (sole content of a <p> tag or standalone <img>)
 * get wrapped in <figure> with a <figcaption>. The alt text becomes the caption.
 *
 * Tables: Each <table> gets a preceding "Table N" label.
 *
 * Labels: <!--XREF:type:label--> comments left by extractLabelMarkers are
 * detected and registered with their assigned number.
 *
 * Equations: \tag{} numbering is preserved as-is from the source LaTeX.
 * No renumbering is applied to equations.
 */
export function autoNumberFiguresAndTables(html: string): NumberingResult {
    const registry: RefRegistry = new Map();
    let figureCount = 0;
    let tableCount = 0;
    let eqCount = 0;
    let result = html;

    // ---- Figure numbering ----
    // Match block-level images: <img> that is the sole content of a <p> tag
    // (This is how Obsidian renders images on their own line)
    // Also detect <!--XREF:fig:label--> markers adjacent to the image
    result = result.replace(
        /(?:<!--XREF:(fig:[\w-]+)-->\s*)?<p>\s*(<img\s[^>]*>)\s*<\/p>(?:\s*<!--XREF:(fig:[\w-]+)-->)?/gi,
        (_match, preLabel: string | undefined, imgTag: string, postLabel: string | undefined) => {
            figureCount++;

            // Register label if present
            const label = preLabel || postLabel;
            if (label) {
                const anchorId = label.replace(':', '-');
                registry.set(label, { type: 'fig', number: figureCount, anchorId });
            }

            // Extract alt text for the caption
            const altMatch = imgTag.match(/alt="([^"]*)"/);
            const altText = altMatch?.[1] || '';

            // Build caption: "Figure N: description" or just "Figure N"
            const captionText = altText
                ? `Figure ${figureCount}: ${altText}`
                : `Figure ${figureCount}`;

            const idAttr = label ? ` id="${label.replace(':', '-')}"` : '';

            return (
                `<figure${idAttr} style="text-align:center;margin:20px 0;">` +
                imgTag +
                `<figcaption style="font-size:13px;color:#555;margin-top:8px;` +
                `font-style:italic;text-align:center;">${captionText}</figcaption>` +
                `</figure>`
            );
        },
    );

    // ---- Table numbering ----
    // Insert "Table N" label before each <table> tag
    // Also detect <!--XREF:tab:label--> markers adjacent to the table
    result = result.replace(
        /(?:<!--XREF:(tab:[\w-]+)-->\s*)?<table([^>]*)>(?:\s*<!--XREF:(tab:[\w-]+)-->)?/gi,
        (_match, preLabel: string | undefined, attrs: string, postLabel: string | undefined) => {
            // Skip callout tables (border-left) and code block tables (border:none)
            if (attrs.includes('border-left') || attrs.includes('border:none')) {
                return `<table${attrs}>`;
            }

            tableCount++;

            // Register label if present
            const label = preLabel || postLabel;
            if (label) {
                const anchorId = label.replace(':', '-');
                registry.set(label, { type: 'tab', number: tableCount, anchorId });
            }

            const idAttr = label ? ` id="${label.replace(':', '-')}"` : '';

            return (
                `<p${idAttr} style="font-size:13px;color:#555;font-style:italic;` +
                `margin-bottom:4px;text-align:center;">Table ${tableCount}</p>` +
                `<table${attrs}>`
            );
        },
    );

    // ---- Equation label extraction ----
    // Detect <!--XREF:eq:label--> markers near equations
    // Also extract \tag{N} from display math for the equation number
    const eqMarkerRegex = /<!--XREF:(eq:[\w-]+)-->/g;
    let eqMatch: RegExpExecArray | null;
    while ((eqMatch = eqMarkerRegex.exec(result)) !== null) {
        eqCount++;
        const label = eqMatch[1];
        const anchorId = label.replace(':', '-');

        // Try to find \tag{N} near this marker for the equation number
        const nearbyHtml = result.slice(Math.max(0, eqMatch.index - 200), eqMatch.index + 200);
        const tagMatch = nearbyHtml.match(/\\tag\{([^}]+)\}/);
        const eqNumber = tagMatch ? parseInt(tagMatch[1], 10) || eqCount : eqCount;

        registry.set(label, { type: 'eq', number: eqNumber, anchorId });
    }

    // Clean up remaining XREF comments that weren't consumed
    result = result.replace(/<!--XREF:[\w:-]+-->/g, '');

    return { html: result, registry };
}

/**
 * Add figure and table counts to the document metadata.
 * Useful for generating a "List of Figures" or "List of Tables" in the future.
 */
export function countFiguresAndTables(html: string): { figures: number; tables: number } {
    const figures = (html.match(/<figure[\s>]/gi) || []).length;
    // Count tables but exclude callout tables and code block tables
    const allTables = (html.match(/<table[\s>]/gi) || []).length;
    const calloutTables = (html.match(/<table[^>]*border-left/gi) || []).length;
    const codeBlockTables = (html.match(/<table[^>]*border:none/gi) || []).length;
    const tables = allTables - calloutTables - codeBlockTables;

    return { figures, tables };
}
