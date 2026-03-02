// math-renderer.ts — Render LaTeX expressions to PNG images
//
// Uses Obsidian's built-in MathJax (via renderMath / finishRenderMath)
// to produce SVG, then rasterizes to PNG via the existing canvas pipeline.
// This provides real rendered math for platforms that don't support LaTeX
// (Medium, LinkedIn) and fixes the broken plaintext fallback in DOCX export.

import { renderMath, finishRenderMath } from 'obsidian';

// ---- Types ----

export interface MathImage {
    data: ArrayBuffer;   // raw SVG bytes
    dataUri: string;     // data:image/svg+xml;base64,...
    width: number;       // CSS pixel width
    height: number;      // CSS pixel height
}

// ---- Core Rendering ----

/**
 * Render a single LaTeX expression to an SVG image.
 *
 * Pipeline: LaTeX → Obsidian renderMath → MathJax SVG → data URI
 *
 * Uses SVG directly (no PNG rasterization) because Google Docs supports
 * SVG in HTML import and it preserves vector quality.
 *
 * @param latex - The LaTeX source (without $ delimiters)
 * @param isDisplay - true for display math (centered block), false for inline
 * @returns SVG image data, data URI, and dimensions
 */
export async function renderLatexToImage(
    latex: string,
    isDisplay: boolean,
): Promise<MathImage> {
    // 1. Use Obsidian's renderMath to create a MathJax DOM element
    //    renderMath returns an <mjx-container> element with MathJax output inside
    const mathEl = renderMath(latex, isDisplay);

    // 2. Append to a hidden container so MathJax can measure and layout
    const container = document.createElement('div');
    container.style.cssText = 'position:absolute;left:-9999px;top:0;background:transparent;';
    container.appendChild(mathEl);
    document.body.appendChild(container);

    try {
        // 3. Trigger MathJax typesetting for any pending elements
        await finishRenderMath();

        // 4. Extract the SVG element from the MathJax output
        //    Obsidian's MathJax 3 produces SVG output with <path> elements
        //    (self-contained, no external font dependencies)
        const svgEl = mathEl.querySelector('svg');
        if (!svgEl) {
            // Fallback: if MathJax produces CHTML instead of SVG,
            // create a simple text-based SVG as a last resort
            return renderLatexFallback(latex, isDisplay);
        }

        // 5. Ensure proper SVG attributes for standalone rendering
        const svgClone = svgEl.cloneNode(true) as SVGSVGElement;

        // Get computed dimensions from the laid-out element
        const bbox = svgEl.getBoundingClientRect();
        const width = Math.ceil(bbox.width) || 100;
        const height = Math.ceil(bbox.height) || 40;

        // Set explicit pixel dimensions and viewBox for standalone SVG
        if (!svgClone.getAttribute('viewBox')) {
            svgClone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }
        svgClone.setAttribute('width', `${width}`);
        svgClone.setAttribute('height', `${height}`);

        // Ensure xmlns is present (required for standalone SVG)
        if (!svgClone.getAttribute('xmlns')) {
            svgClone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }

        // 6. Serialize SVG to string and build data URI directly
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svgClone);
        const svgData = new TextEncoder().encode(svgString).buffer;
        const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;

        return { data: svgData, dataUri, width, height };

    } finally {
        document.body.removeChild(container);
    }
}

/**
 * Render multiple LaTeX expressions in a batch.
 * Processes sequentially to avoid overwhelming MathJax's typesetter.
 */
export async function renderLatexBatch(
    expressions: { latex: string; isDisplay: boolean }[],
): Promise<MathImage[]> {
    const results: MathImage[] = [];
    for (const expr of expressions) {
        try {
            results.push(await renderLatexToImage(expr.latex, expr.isDisplay));
        } catch (err) {
            console.warn(`Failed to render LaTeX: ${expr.latex}`, err);
            results.push(renderLatexFallback(expr.latex, expr.isDisplay));
        }
    }
    return results;
}

// ---- Fallback Renderer ----

/**
 * Fallback: render LaTeX as styled text in an SVG when MathJax SVG is unavailable.
 * Produces a readable but non-typeset result.
 */
function renderLatexFallback(latex: string, isDisplay: boolean): MathImage {
    const fontSize = isDisplay ? 18 : 14;
    const padding = isDisplay ? 16 : 4;

    // Estimate dimensions from text length
    const charWidth = fontSize * 0.6;
    const width = Math.max(Math.ceil(latex.length * charWidth + padding * 2), 40);
    const height = Math.ceil(fontSize * 1.5 + padding * 2);

    // Escape XML special characters for SVG text content
    const escaped = latex
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <rect width="100%" height="100%" fill="white"/>
        <text x="${padding}" y="${height / 2 + fontSize * 0.35}" font-family="serif" font-style="italic" font-size="${fontSize}" fill="#333">${escaped}</text>
    </svg>`;

    // Synchronous fallback — build the data URI directly from SVG
    // (We skip rasterizeSvgToPng here to keep it synchronous)
    const svgBase64 = btoa(unescape(encodeURIComponent(svgString)));
    const dataUri = `data:image/svg+xml;base64,${svgBase64}`;

    // Return SVG data URI (not PNG) as a fallback
    const data = new TextEncoder().encode(svgString).buffer;
    return { data, dataUri, width, height };
}

