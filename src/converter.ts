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
import { ConvertOptions, DEFAULT_CONVERT_OPTIONS } from './types';
import { getTheme, Theme } from './themes';
import { addTableOfContents } from './toc';

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

    // Inline math: $...$ (single line, not preceded/followed by $)
    // Requires non-space after opening $ and before closing $ to avoid
    // false matches on currency like "costs $5 or $10"
    cleaned = cleaned.replace(/(?<!\$)\$(?!\$|\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (match, latex) => {
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

function restoreMathInHtml(html: string, math: MathExtraction[]): string {
    let result = html;
    for (const m of math) {
        const latexHtml = escapeHtml(m.latex);
        // Use \(...\) and \[...\] delimiters instead of $...$ and $$...$$
        // These are unambiguous two-character sequences that won't be confused
        // with each other or with parentheses, currency, etc.
        // The Auto-LaTeX Equations add-on supports both delimiter styles.
        const restored = m.isDisplay ? `\\[${latexHtml}\\]` : `\\(${latexHtml}\\)`;
        result = result.split(m.placeholder).join(restored);
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
    result = result.replace(
        /<div[^>]*data-callout="([^"]*)"[^>]*class="[^"]*callout[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi,
        (_, type, content) => {
            const color = CALLOUT_COLORS[type.toLowerCase()] || '#448aff';
            const cleanContent = content
                .replace(/<div[^>]*class="[^"]*callout-title[^"]*"[^>]*>/gi, '<b>')
                .replace(/<div[^>]*class="[^"]*callout-content[^"]*"[^>]*>/gi, '')
                .replace(/<\/div>/gi, '</b><br/>');
            return `<table style="border-left:4px solid ${color};background:${t.calloutBackground};width:100%;margin:12px 0;">
                <tr><td style="padding:12px;">${cleanContent}</td></tr></table>`;
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
): Promise<string> {
    const opts: ConvertOptions = { ...DEFAULT_CONVERT_OPTIONS, ...options };
    const theme = getTheme(opts.theme);

    // 1. Read and strip frontmatter
    const rawMarkdown = await app.vault.read(file);
    const markdown = stripFrontmatter(rawMarkdown);

    // 2. Protect code blocks from regex (temporary extraction)
    const { cleaned: noCodeMd, blocks: codeBlocks } = extractCodeBlocks(markdown);

    // 3. Extract LaTeX math → placeholders
    const { cleaned: noMathMd, math: mathExtractions } = extractMath(noCodeMd);

    // 4. Extract image embeds → placeholders
    const { cleaned: noImgMd, images: imageExtractions } = extractImageEmbeds(noMathMd);

    // 5. Restore code blocks (Obsidian needs them for syntax highlighting)
    const renderMd = restoreExtractions(noImgMd, codeBlocks);

    console.log(`convertNoteToHtml: extracted ${mathExtractions.length} math, ${imageExtractions.length} images`);

    // 6. Render markdown to HTML via Obsidian
    //    Math placeholders become plain text; image placeholders become plain text.
    //    No MathJax rendering (no $ delimiters), no image loading (no ![[]] syntax).
    let html = await renderMarkdownToHtml(app, renderMd, file.path);

    // 7. Restore LaTeX (placeholders → raw $LaTeX$ / $$LaTeX$$ text)
    html = restoreMathInHtml(html, mathExtractions);

    // 8. Process images: either upload to Drive or embed as base64
    html = await processAndRestoreImages(
        html, imageExtractions, app, file, uploadImageFn, opts.imageMode,
    );

    // 9. Clean HTML for Google Docs compatibility (themed)
    html = cleanHtmlForGoogleDocs(html, theme);

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

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body style="font-family:${theme.fontFamily};max-width:${theme.maxWidth};margin:auto;line-height:${theme.lineHeight};font-size:${theme.fontSize};color:${theme.textColor};">
${headerHtml}
<h1 style="font-family:${theme.headingFontFamily};color:${theme.headingColor};font-size:${theme.h1Size};">${title}</h1>
${html}
${footerHtml}
</body>
</html>`;
}

// Re-export rasterizeSvgToPng for use by docx-builder and other exporters
export { rasterizeSvgToPng };
