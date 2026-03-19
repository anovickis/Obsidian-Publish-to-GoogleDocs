// converter.ts — Markdown-to-HTML conversion pipeline
//
// Pipeline: raw markdown → strip frontmatter → protect code blocks →
//           extract LaTeX → extract images → restore code blocks →
//           render via Obsidian → restore LaTeX → upload & restore images →
//           clean HTML → wrap in document
//
// We pre-extract LaTeX and images from the raw markdown BEFORE rendering.
// This avoids two fundamental problems with post-render extraction:
//   1. MathJax CHTML output doesn't expose original TeX source
//   2. Obsidian renders images with absolute app:// paths + cache-busting
//      query strings that can't be resolved back to vault files

import {
    App,
    Component,
    MarkdownRenderer,
    TFile,
} from 'obsidian';
import { ConvertOptions, DEFAULT_CONVERT_OPTIONS, TargetFormat } from './types';
import { getTheme, Theme } from './themes';
import { addTableOfContents } from './toc';
import { renderLatexToImage } from './math-renderer';
import { resolveEmbeds } from './embed-resolver';
import { isMermaidBlock, extractMermaidSource, renderMermaidToImage } from './mermaid-renderer';
import { extractFootnotes, restoreFootnotesInHtml, FootnoteExtraction } from './footnote-handler';
import { autoNumberFiguresAndTables } from './numbering';
import { resolveWikilinksInHtml } from './wikilink-resolver';
import { highlightCodeBlocks, highlightFencedBlock } from './syntax-highlighter';
import { loadBibFile, processCitations, CitationResult } from './citation-processor';
import { extractLabelMarkers, resolveReferences, RefRegistry } from './cross-references';
import { optimizeImage } from './image-optimizer';
import { applyWatermark } from './watermark';
import { getJournalTemplateCss, getTemplateCitationStyle } from './journal-templates';

// ============================================================
// Types
// ============================================================

interface Extraction {
    placeholder: string;
    original: string;
}

interface MathExtraction extends Extraction {
    isDisplay: boolean;
    latex: string; // content without $ delimiters
}

interface ImageExtraction extends Extraction {
    vaultPath: string;
    alt: string;
    width: string | null;
    isSvg: boolean;
}

// ============================================================
// STEP 1: Strip YAML Frontmatter
// ============================================================

function stripFrontmatter(markdown: string): string {
    const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? markdown.slice(match[0].length) : markdown;
}

// ============================================================
// STEP 2: Extract code blocks (protect from math/image regex)
// ============================================================

function extractCodeBlocks(markdown: string): { cleaned: string; blocks: Extraction[] } {
    const blocks: Extraction[] = [];

    // Fenced code blocks: ```...```
    let cleaned = markdown.replace(/```[\s\S]*?```/g, (match) => {
        const placeholder = `GDOCS_CB${blocks.length}`;
        blocks.push({ placeholder, original: match });
        return placeholder;
    });

    // Inline code: `...` (single backtick, not empty)
    cleaned = cleaned.replace(/`[^`\n]+`/g, (match) => {
        const placeholder = `GDOCS_CI${blocks.length}`;
        blocks.push({ placeholder, original: match });
        return placeholder;
    });

    return { cleaned, blocks };
}

function restoreExtractions(text: string, extractions: Extraction[]): string {
    let result = text;
    // Restore in reverse order for safety with nested placeholders
    for (let i = extractions.length - 1; i >= 0; i--) {
        result = result.split(extractions[i].placeholder).join(extractions[i].original);
    }
    return result;
}

// ============================================================
// STEP 3: Extract LaTeX math
// ============================================================

function extractMath(markdown: string): { cleaned: string; math: MathExtraction[] } {
    const math: MathExtraction[] = [];

    // Display math: $$...$$ (can span multiple lines)
    let cleaned = markdown.replace(/\$\$([\s\S]+?)\$\$/g, (match, latex) => {
        const placeholder = `GDOCS_MD${math.length}`;
        math.push({ placeholder, original: match, isDisplay: true, latex: latex.trim() });
        return placeholder;
    });

    // Inline math: $...$ (single line, not preceded/followed by $$)
    // Requires non-space after opening $ and before closing $ to avoid
    // false matches on currency like "costs $5 or $10".
    // Only rejects $$ (display math delimiter), not single $ (adjacent inline math).
    // Display math is already extracted above, so $$ should not appear here.
    cleaned = cleaned.replace(/(?<!\$)\$(?!\$\$|\s)([^$\n]+?)(?<!\s)\$(?!\$\$)/g, (match, latex) => {
        const placeholder = `GDOCS_MI${math.length}`;
        math.push({ placeholder, original: match, isDisplay: false, latex: latex.trim() });
        return placeholder;
    });

    return { cleaned, math };
}

// ============================================================
// STEP 4: Extract image embeds
// ============================================================

function extractImageEmbeds(markdown: string): { cleaned: string; images: ImageExtraction[] } {
    const images: ImageExtraction[] = [];

    // Obsidian wikilink images: ![[path]] or ![[path|widthOrAlt]]
    let cleaned = markdown.replace(/!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (match, path, sizeOrAlt) => {
        const placeholder = `GDOCS_IM${images.length}`;
        const vaultPath = path.trim();
        const isSvg = vaultPath.toLowerCase().endsWith('.svg');

        let width: string | null = null;
        let alt = '';
        if (sizeOrAlt) {
            // Obsidian: |number for width, |NxN for dimensions, |text for alt
            if (/^\d+(?:x\d+)?$/.test(sizeOrAlt.trim())) {
                width = sizeOrAlt.trim().split('x')[0];
            } else {
                alt = sizeOrAlt.trim();
            }
        }

        images.push({ placeholder, original: match, vaultPath, alt, width, isSvg });
        return placeholder;
    });

    // Standard markdown images: ![alt](path)
    cleaned = cleaned.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, path) => {
        const placeholder = `GDOCS_IM${images.length}`;
        const vaultPath = decodeURIComponent(path.trim());
        const isSvg = vaultPath.toLowerCase().endsWith('.svg');

        images.push({ placeholder, original: match, vaultPath, alt: alt || '', width: null, isSvg });
        return placeholder;
    });

    return { cleaned, images };
}

// ============================================================
// STEP 5: Render Markdown to HTML via Obsidian
// ============================================================

async function renderMarkdownToHtml(
    app: App,
    markdown: string,
    sourcePath: string,
): Promise<string> {
    const container = document.createElement('div');
    const component = new Component();
    component.load();

    try {
        await MarkdownRenderer.render(app, markdown, container, sourcePath, component);
        return container.innerHTML;
    } finally {
        component.unload();
    }
}

// ============================================================
// STEP 6: Restore LaTeX in HTML
// ============================================================

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Sanitize LaTeX for the Auto-LaTeX Equations Google Docs add-on.
 * The add-on's parser can't handle Unicode characters inside \text{} —
 * replace them with LaTeX equivalents that render identically.
 */
function sanitizeLatexForGoogleDocs(latex: string): string {
    return latex
        // \text{–} (en-dash U+2013) → \text{--}  (LaTeX renders -- as en-dash)
        .replace(/\u2013/g, '--')
        // \text{—} (em-dash U+2014) → \text{---}
        .replace(/\u2014/g, '---')
        // ° (degree U+00B0) outside math → ^\circ
        .replace(/°/g, '^{\\circ}')
        // × (multiplication U+00D7) → \times
        .replace(/×/g, '\\times')
        // ± (plus-minus U+00B1) → \pm
        .replace(/\u00B1/g, '\\pm')
        // ≈ (approx U+2248) → \approx  (in case literal Unicode was used)
        .replace(/\u2248/g, '\\approx')
        // ≤ ≥ (U+2264, U+2265) → \leq \geq
        .replace(/\u2264/g, '\\leq')
        .replace(/\u2265/g, '\\geq');
}

function restoreMathInHtml(
    html: string,
    math: MathExtraction[],
    targetFormat: TargetFormat,
): string {
    let result = html;
    for (const m of math) {
        let latexContent = m.latex;
        let restored: string;
        if (targetFormat === 'google-docs') {
            // Sanitize Unicode that the Auto-LaTeX add-on can't parse
            latexContent = sanitizeLatexForGoogleDocs(latexContent);
            const latexHtml = escapeHtml(latexContent);
            // Use $$...$$ for both inline and display math.
            // Auto-LaTeX Equations add-on only reliably recognizes $$ delimiters.
            restored = `$$${latexHtml}$$`;
        } else {
            const latexHtml = escapeHtml(latexContent);
            // For DOCX/local export: keep \(...\) and \[...\] which the
            // docx-builder parses to render math as images.
            restored = m.isDisplay ? `\\[${latexHtml}\\]` : `\\(${latexHtml}\\)`;
        }
        result = result.split(m.placeholder).join(restored);
    }
    return result;
}

/**
 * Replace math placeholders with rendered PNG images (for Medium, LinkedIn).
 * Each LaTeX expression is rendered via MathJax and rasterized to an inline image.
 */
async function restoreMathAsImages(
    html: string,
    math: MathExtraction[],
): Promise<string> {
    let result = html;
    for (const m of math) {
        try {
            const svgResult = await renderLatexToImage(m.latex, m.isDisplay);
            // Rasterize SVG to PNG for platform compatibility
            // (Google Docs doesn't support SVG in HTML import, DOCX needs PNG)
            const pngData = await rasterizeSvgToPng(svgResult.data);
            const bytes = new Uint8Array(pngData);
            let binary = '';
            for (let j = 0; j < bytes.length; j++) {
                binary += String.fromCharCode(bytes[j]);
            }
            const pngDataUri = `data:image/png;base64,${btoa(binary)}`;

            const altText = escapeHtml(m.latex);
            const style = m.isDisplay
                ? 'display:block;margin:12px auto;'
                : 'display:inline;vertical-align:middle;height:1.2em;';
            const tag = `<img src="${pngDataUri}" alt="${altText}" style="${style}" width="${svgResult.width}" height="${svgResult.height}">`;
            result = result.split(m.placeholder).join(tag);
        } catch (err) {
            console.warn(`Failed to render LaTeX as image: ${m.latex}`, err);
            // Fallback: insert the LaTeX source as italic text
            const fallback = `<em>${escapeHtml(m.latex)}</em>`;
            result = result.split(m.placeholder).join(fallback);
        }
    }
    return result;
}

// ============================================================
// STEP 7: Upload images and restore in HTML
// ============================================================

async function processAndRestoreImages(
    html: string,
    imageExtractions: ImageExtraction[],
    app: App,
    file: TFile,
    uploadImageFn: ((data: ArrayBuffer, name: string, mimeType: string) => Promise<string>) | null,
    imageMode: 'upload' | 'embed' = 'upload',
    imageOptimization?: { enabled: boolean; maxWidth: number; quality: number },
): Promise<string> {
    let result = html;

    // Process in batches of 5
    for (let i = 0; i < imageExtractions.length; i += 5) {
        const batch = imageExtractions.slice(i, i + 5);
        const processedResults = await Promise.all(
            batch.map(async (img) => {
                try {
                    const imageFile = app.metadataCache.getFirstLinkpathDest(
                        img.vaultPath,
                        file.path,
                    );

                    if (!imageFile) {
                        console.warn(`Image not found in vault: ${img.vaultPath}`);
                        return { img, tag: `<em>[Image not found: ${img.vaultPath}]</em>` };
                    }

                    let imageData = await app.vault.readBinary(imageFile);
                    let mimeType = img.isSvg ? 'image/png' : `image/${imageFile.extension}`;
                    let fileName = imageFile.name;

                    // SVGs must be rasterized (Google Docs doesn't support inline SVG)
                    if (img.isSvg) {
                        imageData = await rasterizeSvgToPng(imageData);
                        fileName = fileName.replace(/\.svg$/i, '.png');
                    }

                    if (mimeType === 'image/jpg') mimeType = 'image/jpeg';

                    // Image optimization (resize/compress)
                    if (imageOptimization?.enabled && !img.isSvg) {
                        try {
                            const optimized = await optimizeImage(imageData, mimeType, {
                                maxWidth: imageOptimization.maxWidth,
                                quality: imageOptimization.quality,
                            });
                            imageData = optimized.data;
                            mimeType = optimized.mimeType;
                            if (mimeType === 'image/jpeg' && !fileName.match(/\.jpe?g$/i)) {
                                fileName = fileName.replace(/\.\w+$/, '.jpg');
                            }
                        } catch (optErr) {
                            console.warn(`Image optimization failed for ${img.vaultPath}, using original:`, optErr);
                        }
                    }

                    let src: string;
                    if (imageMode === 'embed') {
                        // Embed as base64 data URI (for DOCX/PDF export — no network needed)
                        const bytes = new Uint8Array(imageData);
                        let binary = '';
                        for (let j = 0; j < bytes.length; j++) {
                            binary += String.fromCharCode(bytes[j]);
                        }
                        const base64 = btoa(binary);
                        src = `data:${mimeType};base64,${base64}`;
                    } else {
                        // Upload to Google Drive and use the public URL
                        if (!uploadImageFn) {
                            throw new Error('uploadImageFn required for upload mode');
                        }
                        src = await uploadImageFn(imageData, fileName, mimeType);
                    }

                    let tag = `<img src="${src}" alt="${escapeHtml(img.alt || imageFile.basename)}"`;
                    if (img.width) tag += ` width="${img.width}"`;
                    tag += ` style="max-width:100%;">`;

                    return { img, tag };
                } catch (err) {
                    console.error(`Failed to process image ${img.vaultPath}:`, err);
                    return { img, tag: `<em>[Failed to process: ${img.vaultPath}]</em>` };
                }
            }),
        );

        for (const r of processedResults) {
            // Placeholder may be wrapped in <p> tags (block-level image on its own line)
            const blockPattern = `<p>${r.img.placeholder}</p>`;
            if (result.includes(blockPattern)) {
                result = result.split(blockPattern).join(r.tag);
            } else {
                result = result.split(r.img.placeholder).join(r.tag);
            }
        }
    }

    return result;
}

// ============================================================
// SVG → PNG Rasterization
// ============================================================

/**
 * Rasterize an SVG to PNG using the Electron Canvas API.
 * Returns the PNG data as an ArrayBuffer.
 */
async function rasterizeSvgToPng(svgData: ArrayBuffer): Promise<ArrayBuffer> {
    const svgString = new TextDecoder().decode(svgData);

    // Parse dimensions from the SVG
    let width = 800;
    let height = 600;

    const viewBoxMatch = svgString.match(/viewBox="([^"]+)"/);
    if (viewBoxMatch) {
        const parts = viewBoxMatch[1].split(/[\s,]+/).map(Number);
        if (parts.length >= 4) {
            width = parts[2];
            height = parts[3];
        }
    }

    // Explicit width/height override viewBox
    const widthMatch = svgString.match(/width="(\d+(?:\.\d+)?)(?:px)?"/);
    const heightMatch = svgString.match(/height="(\d+(?:\.\d+)?)(?:px)?"/);
    if (widthMatch) width = parseFloat(widthMatch[1]);
    if (heightMatch) height = parseFloat(heightMatch[1]);

    // 2x scale for crisp rendering
    const scale = 2;
    const canvasWidth = Math.round(width * scale);
    const canvasHeight = Math.round(height * scale);

    return new Promise((resolve, reject) => {
        const img = new Image();
        const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Failed to get canvas 2d context'));
                    return;
                }

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);
                ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

                canvas.toBlob((pngBlob) => {
                    if (!pngBlob) {
                        reject(new Error('Canvas toBlob returned null'));
                        return;
                    }
                    pngBlob.arrayBuffer().then(resolve).catch(reject);
                }, 'image/png');
            } finally {
                URL.revokeObjectURL(url);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load SVG into Image element'));
        };

        img.src = url;
    });
}

// ============================================================
// HTML Cleanup for Google Docs
// ============================================================

const CALLOUT_COLORS: Record<string, string> = {
    note: '#448aff',
    abstract: '#00bcd4',
    summary: '#00bcd4',
    info: '#2196f3',
    tip: '#00bfa5',
    hint: '#00bfa5',
    success: '#00c853',
    check: '#00c853',
    question: '#ff9800',
    help: '#ff9800',
    warning: '#ff9100',
    caution: '#ff9100',
    failure: '#ff5252',
    danger: '#ff5252',
    error: '#ff5252',
    bug: '#ff5252',
    example: '#7c4dff',
    quote: '#9e9e9e',
    cite: '#9e9e9e',
};

function cleanHtmlForGoogleDocs(html: string, theme?: Theme): string {
    // Use default theme values if not provided (matches v1 output exactly)
    const t = theme || getTheme('default');
    let result = html;

    // Convert callout divs to styled tables
    // Obsidian callout HTML: <div data-callout="type" class="callout">
    //   <div class="callout-title"><div class="callout-icon">…</div><div class="callout-title-inner">Title</div></div>
    //   <div class="callout-content"><p>Content</p></div>
    // </div>
    result = result.replace(
        /<div[^>]*data-callout="([^"]*)"[^>]*>[\s\S]*?<div[^>]*callout-title-inner[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*callout-content[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
        (_, type, title, content) => {
            const color = CALLOUT_COLORS[type.toLowerCase()] || '#448aff';
            return `<table style="border-left:4px solid ${color};background:${t.calloutBackground};width:100%;margin:12px 0;">
                <tr><td style="padding:12px;"><b>${title.trim()}</b><br/>${content.trim()}</td></tr></table>`;
        },
    );

    // Convert wikilinks to bold text
    result = result.replace(
        /<a[^>]*class="[^"]*internal-link[^"]*"[^>]*>(.*?)<\/a>/gi,
        '<b>$1</b>',
    );

    // Inline styles for code blocks (themed)
    result = result.replace(
        /<pre>/gi,
        `<pre style="background:${t.codeBlockBackground};padding:${t.codeBlockPadding};border-radius:4px;font-family:${t.codeFontFamily};white-space:pre;overflow-x:auto;font-size:${t.codeFontSize};">`,
    );
    result = result.replace(
        /<code>/gi,
        `<code style="background:${t.codeBackground};padding:2px 4px;border-radius:3px;font-family:${t.codeFontFamily};font-size:${t.codeFontSize};">`,
    );

    // Inline styles for blockquotes (themed)
    result = result.replace(
        /<blockquote>/gi,
        `<blockquote style="border-left:4px solid ${t.blockquoteBorderColor};padding-left:16px;margin-left:0;color:${t.blockquoteTextColor};">`,
    );

    // Inline styles for tables (themed, only those without existing style)
    result = result.replace(
        /<table(?![^>]*style)/gi,
        `<table style="border-collapse:collapse;width:100%;margin:12px 0;"`,
    );
    result = result.replace(
        /<th(?![^>]*style)/gi,
        `<th style="border:1px solid ${t.tableBorderColor};padding:8px;background:${t.tableHeaderBackground};text-align:left;"`,
    );
    result = result.replace(
        /<td(?![^>]*style)/gi,
        `<td style="border:1px solid ${t.tableBorderColor};padding:8px;"`,
    );

    // Strip Obsidian-specific class and data attributes
    result = result.replace(/\s+class="[^"]*"/gi, '');
    result = result.replace(/\s+data-[a-z-]+="[^"]*"/gi, '');

    // Clean up empty paragraphs
    result = result.replace(/<p>\s*<\/p>/gi, '');

    // Remove any leftover MathJax containers the renderer may have produced
    // (their content is already handled by our pre-extraction)
    result = result.replace(/<mjx-container[^>]*>[\s\S]*?<\/mjx-container>/gi, '');

    return result;
}

// ============================================================
// Platform-Specific HTML Cleanup (Medium, LinkedIn)
// ============================================================

/**
 * Clean HTML for Medium compatibility.
 * Medium supports: bold, italic, H1/H2, blockquotes, lists, code blocks, images, links.
 * Medium does NOT support: tables, H3-H6, callouts, inline styles (stripped on paste).
 */
function cleanHtmlForMedium(html: string): string {
    let result = html;

    // Convert callout divs to blockquotes (Medium doesn't support callouts)
    result = result.replace(
        /<div[^>]*data-callout="([^"]*)"[^>]*>[\s\S]*?<div[^>]*callout-title-inner[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*callout-content[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
        (_, _type, title, content) => {
            return `<blockquote><b>${title.trim()}</b><br/>${content.trim()}</blockquote>`;
        },
    );

    // Demote H3-H6 to H2 (Medium only supports H1 and H2)
    result = result.replace(/<h[3-6]([^>]*)>/gi, '<h2$1>');
    result = result.replace(/<\/h[3-6]>/gi, '</h2>');

    // Convert tables to structured text (Medium doesn't support tables)
    result = result.replace(
        /<table[^>]*>([\s\S]*?)<\/table>/gi,
        (_, tableContent) => {
            // Extract rows and convert to a readable format
            const rows: string[] = [];
            const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let rowMatch: RegExpExecArray | null;
            while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
                const cells: string[] = [];
                const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
                let cellMatch: RegExpExecArray | null;
                while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                    cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
                }
                if (cells.length > 0) {
                    rows.push(cells.join(' | '));
                }
            }
            return `<p>${rows.join('<br>')}</p>`;
        },
    );

    // Convert wikilinks to bold text
    result = result.replace(
        /<a[^>]*class="[^"]*internal-link[^"]*"[^>]*>(.*?)<\/a>/gi,
        '<b>$1</b>',
    );

    // Strip Obsidian-specific class and data attributes
    result = result.replace(/\s+class="[^"]*"/gi, '');
    result = result.replace(/\s+data-[a-z-]+="[^"]*"/gi, '');

    // Clean up empty paragraphs
    result = result.replace(/<p>\s*<\/p>/gi, '');

    // Remove leftover MathJax containers
    result = result.replace(/<mjx-container[^>]*>[\s\S]*?<\/mjx-container>/gi, '');

    return result;
}

/**
 * Clean HTML for LinkedIn compatibility.
 * LinkedIn articles support: bold, italic, underline, H1/H2, blockquotes,
 * lists, code snippets, images, links.
 * LinkedIn does NOT support: tables, H3-H6, callouts, complex styling.
 */
function cleanHtmlForLinkedIn(html: string): string {
    let result = html;

    // Convert callout divs to blockquotes
    result = result.replace(
        /<div[^>]*data-callout="([^"]*)"[^>]*>[\s\S]*?<div[^>]*callout-title-inner[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div[^>]*callout-content[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi,
        (_, _type, title, content) => {
            return `<blockquote><b>${title.trim()}</b><br/>${content.trim()}</blockquote>`;
        },
    );

    // Demote H3-H6 to H2
    result = result.replace(/<h[3-6]([^>]*)>/gi, '<h2$1>');
    result = result.replace(/<\/h[3-6]>/gi, '</h2>');

    // Remove tables entirely (LinkedIn doesn't support them at all)
    // Replace with a simple paragraph listing cell contents
    result = result.replace(
        /<table[^>]*>([\s\S]*?)<\/table>/gi,
        (_, tableContent) => {
            const rows: string[] = [];
            const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
            let rowMatch: RegExpExecArray | null;
            while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
                const cells: string[] = [];
                const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
                let cellMatch: RegExpExecArray | null;
                while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                    cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
                }
                if (cells.length > 0) {
                    rows.push(cells.join(' — '));
                }
            }
            return `<p>${rows.join('<br>')}</p>`;
        },
    );

    // Convert wikilinks to bold text
    result = result.replace(
        /<a[^>]*class="[^"]*internal-link[^"]*"[^>]*>(.*?)<\/a>/gi,
        '<b>$1</b>',
    );

    // Strip all inline styles (LinkedIn strips them anyway)
    result = result.replace(/\s+style="[^"]*"/gi, '');

    // Strip Obsidian-specific class and data attributes
    result = result.replace(/\s+class="[^"]*"/gi, '');
    result = result.replace(/\s+data-[a-z-]+="[^"]*"/gi, '');

    // Clean up empty paragraphs
    result = result.replace(/<p>\s*<\/p>/gi, '');

    // Remove leftover MathJax containers
    result = result.replace(/<mjx-container[^>]*>[\s\S]*?<\/mjx-container>/gi, '');

    return result;
}

// ============================================================
// Full Pipeline
// ============================================================

/**
 * Convert an Obsidian note to clean HTML ready for Google Docs or local export.
 *
 * @param app - Obsidian App instance
 * @param file - The markdown file to convert
 * @param uploadImageFn - Callback to upload an image and return its public URL (null for embed mode)
 * @param options - Conversion options (theme, TOC, imageMode, header/footer)
 * @returns Complete HTML document string
 */
export async function convertNoteToHtml(
    app: App,
    file: TFile,
    uploadImageFn: ((data: ArrayBuffer, name: string, mimeType: string) => Promise<string>) | null,
    options?: Partial<ConvertOptions>,
    markdownOverride?: string,
): Promise<string> {
    const opts: ConvertOptions = { ...DEFAULT_CONVERT_OPTIONS, ...options };
    const theme = getTheme(opts.theme);

    // Determine effective citation style (journal template may override)
    const templateCitStyle = getTemplateCitationStyle(opts.journalTemplate);
    const effectiveCitationStyle = templateCitStyle || opts.citationStyle;

    // 1. Read and strip frontmatter (or use markdownOverride for project compilation)
    let markdown: string;
    if (markdownOverride !== undefined) {
        markdown = markdownOverride;
    } else {
        const rawMarkdown = await app.vault.read(file);
        markdown = stripFrontmatter(rawMarkdown);
    }

    // 1.5. Resolve ![[note]] transclusion embeds (before any extraction)
    if (opts.resolveEmbeds) {
        markdown = await resolveEmbeds(markdown, app, file);
    }

    // 1.6. Process citations from .bib file (before rendering)
    // Priority: explicit bibFilePath setting > .bib file in same folder as source .md
    let citationResult: CitationResult | null = null;
    let effectiveBibPath = opts.bibFilePath || '';
    if (!effectiveBibPath) {
        // Auto-discover: look for .bib files in the same folder as the source file
        const sourceFolder = file.parent;
        if (sourceFolder) {
            const bibFile = sourceFolder.children.find(
                (f): f is TFile => f instanceof TFile && f.extension === 'bib',
            );
            if (bibFile) {
                effectiveBibPath = bibFile.path;
                console.log(`Auto-discovered .bib file: ${effectiveBibPath}`);
            }
        }
    }
    if (effectiveBibPath) {
        try {
            const bibEntries = await loadBibFile(app, effectiveBibPath);
            if (bibEntries.size > 0) {
                citationResult = processCitations(markdown, bibEntries, effectiveCitationStyle);
                markdown = citationResult.processed;
            }
        } catch (err) {
            console.warn('Citation processing failed:', err);
        }
    }

    // 1.65. Extract cross-reference label markers (before rendering)
    if (opts.resolveCrossRefs) {
        const labelResult = extractLabelMarkers(markdown);
        markdown = labelResult.cleaned;
    }

    // 1.7. Extract footnotes from raw markdown (before rendering)
    let footnoteExtractions: FootnoteExtraction[] = [];
    if (opts.handleFootnotes) {
        const fnResult = extractFootnotes(markdown);
        markdown = fnResult.cleaned;
        footnoteExtractions = fnResult.footnotes;
    }

    // 2. Protect code blocks from regex (temporary extraction)
    const { cleaned: noCodeMd, blocks: codeBlocks } = extractCodeBlocks(markdown);

    // 2.5. Process Mermaid diagrams among extracted code blocks
    if (opts.renderMermaid) {
        for (let i = 0; i < codeBlocks.length; i++) {
            const block = codeBlocks[i];
            if (isMermaidBlock(block.original)) {
                try {
                    const mermaidSource = extractMermaidSource(block.original);
                    const mermaidImg = await renderMermaidToImage(mermaidSource, app);
                    // Replace the code block with an inline image
                    block.original = `<img src="${mermaidImg.dataUri}" alt="Mermaid diagram" ` +
                        `style="display:block;margin:12px auto;max-width:100%;" ` +
                        `width="${mermaidImg.width}" height="${mermaidImg.height}">`;
                } catch (err) {
                    console.warn('Failed to render Mermaid diagram:', err);
                    // Leave original code block as-is on failure
                }
            }
        }
    }

    // 2.7. Pre-highlight code blocks (before Obsidian renders)
    //      Converts fenced code blocks to <pre><code> HTML with inline color spans.
    //      Obsidian's MarkdownRenderer passes raw HTML through, so these survive rendering.
    if (opts.syntaxHighlighting) {
        console.log(`[converter] Step 2.7: Syntax highlighting ${codeBlocks.length} code blocks`);
        for (const block of codeBlocks) {
            // Only fenced code blocks (GDOCS_CB), not inline code (GDOCS_CI)
            if (!block.placeholder.startsWith('GDOCS_CB')) continue;
            console.log(`[converter] Processing block: ${block.placeholder}, original starts with: ${block.original.substring(0, 40)}`);
            const highlighted = highlightFencedBlock(block.original);
            if (highlighted) {
                block.original = highlighted;
                console.log(`[converter] Highlighted ${block.placeholder} successfully`);
            } else {
                console.log(`[converter] Could not highlight ${block.placeholder}`);
            }
        }
    }

    // 3. Extract LaTeX math → placeholders
    const { cleaned: noMathMd, math: mathExtractions } = extractMath(noCodeMd);

    // 4. Extract image embeds → placeholders
    const { cleaned: noImgMd, images: imageExtractions } = extractImageEmbeds(noMathMd);

    // 5. Restore code blocks (Obsidian needs them for syntax highlighting)
    //    Mermaid blocks are now replaced with <img> tags — Obsidian will pass them through.
    const renderMd = restoreExtractions(noImgMd, codeBlocks);

    console.log(`convertNoteToHtml: extracted ${mathExtractions.length} math, ${imageExtractions.length} images, ${footnoteExtractions.length} footnotes`);

    // 6. Render markdown to HTML via Obsidian
    //    Math placeholders become plain text; image placeholders become plain text.
    //    No MathJax rendering (no $ delimiters), no image loading (no ![[]] syntax).
    let html = await renderMarkdownToHtml(app, renderMd, file.path);

    // 6.5. Resolve wikilinks to Google Docs hyperlinks (before cleanup strips classes)
    if (opts.resolveWikilinks) {
        html = resolveWikilinksInHtml(html, app, file);
    }

    // 7. Restore LaTeX based on target format
    if (opts.targetFormat === 'medium' || opts.targetFormat === 'linkedin' || opts.mathAsImages) {
        // Render ALL math as inline PNG images (platforms without LaTeX, or user preference)
        html = await restoreMathAsImages(html, mathExtractions);
    } else {
        // Google Docs / DOCX: restore as text delimiters
        html = restoreMathInHtml(html, mathExtractions, opts.targetFormat);
    }

    // 8. Process images: either upload to Drive or embed as base64
    //    For Medium/LinkedIn clipboard copy, always embed as base64
    const effectiveImageMode = (opts.targetFormat === 'medium' || opts.targetFormat === 'linkedin')
        ? 'embed' : opts.imageMode;
    html = await processAndRestoreImages(
        html, imageExtractions, app, file, uploadImageFn, effectiveImageMode,
        opts.optimizeImages ? {
            enabled: true,
            maxWidth: opts.maxImageWidth,
            quality: opts.imageQuality,
        } : undefined,
    );

    // 9. Clean HTML for target platform
    if (opts.targetFormat === 'medium') {
        html = cleanHtmlForMedium(html);
    } else if (opts.targetFormat === 'linkedin') {
        html = cleanHtmlForLinkedIn(html);
    } else {
        html = cleanHtmlForGoogleDocs(html, theme);
    }

    // 9.3. Auto-number figures and tables (also builds label registry for cross-refs)
    let refRegistry: RefRegistry = new Map();
    if (opts.autoNumberFigures) {
        const numberingResult = autoNumberFiguresAndTables(html);
        html = numberingResult.html;
        refRegistry = numberingResult.registry;
    }

    // 9.4. Resolve cross-references (@fig:label, @tab:label, @eq:label)
    if (opts.resolveCrossRefs && refRegistry.size > 0) {
        html = resolveReferences(html, refRegistry);
    }

    // 9.5. Restore footnotes as endnotes section
    if (opts.handleFootnotes && footnoteExtractions.length > 0) {
        html = restoreFootnotesInHtml(html, footnoteExtractions);
    }

    // 10. Add table of contents if requested
    if (opts.includeToc) {
        html = addTableOfContents(html);
    }

    // 11. Wrap in a complete HTML document
    const title = file.basename;

    // Optional header
    const headerHtml = opts.headerText
        ? `<p style="color:#888;font-size:12px;margin-bottom:4px;">${escapeHtml(opts.headerText)}</p>`
        : '';

    // Optional footer
    const footerHtml = opts.footerText
        ? `<hr style="border:none;border-top:1px solid #ddd;margin-top:40px;"><p style="color:#888;font-size:12px;">${escapeHtml(opts.footerText)}</p>`
        : '';

    // Bibliography section (from citation processing)
    const bibliographyHtml = citationResult?.bibliographyHtml || '';

    // Custom CSS + journal template CSS
    const journalCss = getJournalTemplateCss(opts.journalTemplate);
    const allCss = [journalCss, opts.customCss || ''].filter(Boolean).join('\n');
    const customStyleTag = allCss ? `<style>${allCss}</style>` : '';

    let finalHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
${customStyleTag}
</head>
<body style="font-family:${theme.fontFamily};max-width:${theme.maxWidth};margin:auto;line-height:${theme.lineHeight};font-size:${theme.fontSize};color:${theme.textColor};">
${headerHtml}
<h1 style="font-family:${theme.headingFontFamily};color:${theme.headingColor};font-size:${theme.h1Size};">${title}</h1>
${html}
${bibliographyHtml}
${footerHtml}
</body>
</html>`;

    // 11.5. Apply watermark if configured
    if (opts.watermarkText) {
        finalHtml = await applyWatermark(finalHtml, {
            text: opts.watermarkText,
            opacity: opts.watermarkOpacity,
            forGoogleDocs: opts.targetFormat === 'google-docs',
        });
    }

    return finalHtml;
}

// Re-export rasterizeSvgToPng for use by docx-builder and other exporters
export { rasterizeSvgToPng };
