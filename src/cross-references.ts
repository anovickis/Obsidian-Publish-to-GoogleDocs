// cross-references.ts — Resolve @fig:, @tab:, @eq: references in HTML
//
// Works with the label registry built by numbering.ts during auto-numbering.
// Labels are declared in the source using {#fig:label}, {#tab:label}, {#eq:label}
// and referenced with @fig:label, @tab:label, @eq:label.

// ---- Types ----

export interface RefEntry {
    type: 'fig' | 'tab' | 'eq';
    number: number;
    anchorId: string;   // HTML id attribute for linking
}

export type RefRegistry = Map<string, RefEntry>;

// ---- Reference Resolution ----

/**
 * Resolve @fig:label, @tab:label, @eq:label references in HTML
 * using the label registry built during auto-numbering.
 *
 * Replaces text references with clickable links:
 *   @fig:test → <a href="#fig-test">Figure 3</a>
 *   @tab:results → <a href="#tab-results">Table 1</a>
 *   @eq:energy → <a href="#eq-energy">Equation (2)</a>
 */
export function resolveReferences(html: string, registry: RefRegistry): string {
    if (registry.size === 0) return html;

    // Match @fig:label, @tab:label, @eq:label (label = alphanumeric + hyphens + underscores)
    return html.replace(/@(fig|tab|eq):([\w-]+)/g, (_match, type: string, label: string) => {
        const key = `${type}:${label}`;
        const entry = registry.get(key);

        if (!entry) {
            // Unresolved reference — leave as bold red text
            return `<b style="color:#ff5252;">[?${key}]</b>`;
        }

        const displayText = formatRefText(entry.type, entry.number);
        return `<a href="#${entry.anchorId}" style="color:#448aff;text-decoration:none;">${displayText}</a>`;
    });
}

/** Format reference display text based on type */
function formatRefText(type: 'fig' | 'tab' | 'eq', number: number): string {
    switch (type) {
        case 'fig': return `Figure ${number}`;
        case 'tab': return `Table ${number}`;
        case 'eq': return `Equation (${number})`;
    }
}

// ---- Label Extraction from Markdown ----

/**
 * Extract {#type:label} markers from markdown and remove them.
 * Returns cleaned markdown and a map of markers found.
 *
 * Called before rendering so that markers don't appear in HTML output.
 * The actual numbering + registry building happens in numbering.ts.
 */
export function extractLabelMarkers(markdown: string): {
    cleaned: string;
    markers: Map<string, string>;  // e.g., "fig:architecture" → attached to the preceding element
} {
    const markers = new Map<string, string>();

    // Remove {#type:label} markers and record them
    // They appear after images, tables, or equations
    const cleaned = markdown.replace(/\{#(fig|tab|eq):([\w-]+)\}/g, (_match, type, label) => {
        const key = `${type}:${label}`;
        markers.set(key, key);
        return `<!--XREF:${key}-->`;  // Leave an HTML comment as anchor
    });

    return { cleaned, markers };
}
