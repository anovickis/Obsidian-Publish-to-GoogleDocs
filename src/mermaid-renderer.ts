// mermaid-renderer.ts — Render Mermaid diagrams to PNG images
//
// Extracts ```mermaid code blocks, renders them to SVG using Obsidian's
// built-in MarkdownRenderer (which includes Mermaid support), then
// rasterizes to PNG using the existing canvas pipeline.
//
// Pipeline integration: called between code block extraction and math extraction.
// Mermaid blocks are identified among extracted code blocks, rendered to images,
// and their placeholders are updated to image tags.

import { App, Component, MarkdownRenderer } from 'obsidian';
import { rasterizeSvgToPng } from './converter';

interface MermaidImage {
    dataUri: string;
    width: number;
    height: number;
}

/**
 * Check if an extracted code block is a Mermaid diagram.
 * Mermaid blocks start with ```mermaid (case-insensitive).
 */
export function isMermaidBlock(codeBlock: string): boolean {
    return /^```mermaid\b/i.test(codeBlock.trim());
}

/**
 * Extract the Mermaid source code from a fenced code block.
 */
export function extractMermaidSource(codeBlock: string): string {
    return codeBlock
        .replace(/^```mermaid\b[^\n]*/i, '')
        .replace(/```\s*$/, '')
        .trim();
}

/**
 * Render a Mermaid diagram to a PNG image.
 *
 * Uses Obsidian's MarkdownRenderer which has built-in Mermaid support.
 * The renderer produces an SVG element which we then rasterize to PNG.
 *
 * @param mermaidSource - The raw Mermaid diagram code (without fences)
 * @param app - Obsidian App instance
 * @returns PNG image as a data URI with dimensions
 */
export async function renderMermaidToImage(
    mermaidSource: string,
    app: App,
): Promise<MermaidImage> {
    // Create a hidden container for Obsidian's renderer
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;background:white;';
    document.body.appendChild(container);

    const component = new Component();
    component.load();

    try {
        // Render the mermaid block via Obsidian's MarkdownRenderer
        const markdown = '```mermaid\n' + mermaidSource + '\n```';
        await MarkdownRenderer.render(app, markdown, container, '', component);

        // Mermaid rendering is async — wait for the SVG to appear
        // Poll briefly (up to 2 seconds) for the SVG to be generated
        let svgEl: SVGSVGElement | null = null;
        for (let i = 0; i < 20; i++) {
            svgEl = container.querySelector('svg');
            if (svgEl) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        if (!svgEl) {
            throw new Error('Mermaid rendering did not produce an SVG element');
        }

        // Get dimensions from the rendered SVG
        const bbox = svgEl.getBoundingClientRect();
        const width = Math.ceil(bbox.width) || 600;
        const height = Math.ceil(bbox.height) || 400;

        // Clone and prepare SVG for standalone rendering
        const svgClone = svgEl.cloneNode(true) as SVGSVGElement;
        svgClone.setAttribute('width', `${width}`);
        svgClone.setAttribute('height', `${height}`);
        if (!svgClone.getAttribute('xmlns')) {
            svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }

        // Inline critical styles from the document into the SVG
        // (Mermaid uses CSS classes that won't survive serialization)
        inlineMermaidStyles(svgClone);

        // Serialize to string
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgClone);

        // Rasterize to PNG
        const svgData = new TextEncoder().encode(svgString).buffer;
        const pngData = await rasterizeSvgToPng(svgData);

        // Build data URI
        const bytes = new Uint8Array(pngData);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const dataUri = `data:image/png;base64,${btoa(binary)}`;

        return { dataUri, width, height };

    } finally {
        component.unload();
        document.body.removeChild(container);
    }
}

/**
 * Inline computed styles for key Mermaid elements.
 * Mermaid diagrams rely on CSS classes (e.g., .node rect, .edgePath path)
 * that won't be available when the SVG is serialized standalone.
 */
function inlineMermaidStyles(svg: SVGSVGElement): void {
    // Process all elements and inline their computed styles for key properties
    const importantProps = [
        'fill', 'stroke', 'stroke-width', 'font-family', 'font-size',
        'font-weight', 'text-anchor', 'dominant-baseline', 'opacity',
    ];

    const elements = svg.querySelectorAll('*');
    for (const el of Array.from(elements)) {
        if (!(el instanceof SVGElement) && !(el instanceof HTMLElement)) continue;

        const computed = window.getComputedStyle(el);
        const inlineStyles: string[] = [];

        for (const prop of importantProps) {
            const value = computed.getPropertyValue(prop);
            if (value && value !== 'none' && value !== '' && value !== 'normal') {
                inlineStyles.push(`${prop}:${value}`);
            }
        }

        if (inlineStyles.length > 0) {
            const existing = el.getAttribute('style') || '';
            el.setAttribute('style', existing + ';' + inlineStyles.join(';'));
        }
    }
}
