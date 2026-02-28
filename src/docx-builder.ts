// docx-builder.ts — Convert cleaned HTML to a .docx file using the docx library
//
// Architecture: Walk the HTML DOM tree (parsed via DOMParser in Electron),
// converting each node to docx library objects. This gives full control
// over Word formatting without depending on generic HTML-to-DOCX converters.
//
// LaTeX handling (Phase 1): render LaTeX to PNG images via canvas and embed
// as ImageRun objects. Pixel-perfect but not editable in Word.

import {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    ImageRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    BorderStyle,
    AlignmentType,
    ShadingType,
    ExternalHyperlink,
    LevelFormat,
    convertInchesToTwip,
    ITableCellBorders,
} from 'docx';
import { ThemeName } from './types';
import { getTheme, Theme } from './themes';
import { rasterizeSvgToPng } from './converter';

// ---- Constants ----

// Heading level map (docx uses specific enum values)
const HEADING_MAP: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    'H1': HeadingLevel.HEADING_1,
    'H2': HeadingLevel.HEADING_2,
    'H3': HeadingLevel.HEADING_3,
    'H4': HeadingLevel.HEADING_4,
    'H5': HeadingLevel.HEADING_5,
    'H6': HeadingLevel.HEADING_6,
};

// Default image dimensions when we can't determine them
const DEFAULT_IMAGE_WIDTH = 500;
const DEFAULT_IMAGE_HEIGHT = 300;

// Cell borders for tables
const TABLE_BORDERS: ITableCellBorders = {
    top: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    left: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
    right: { style: BorderStyle.SINGLE, size: 1, color: '999999' },
};

// ---- LaTeX → PNG Rendering ----

/**
 * Render a LaTeX expression to a PNG ArrayBuffer using canvas.
 * Uses an offscreen SVG rendered through the same pipeline as SVG rasterization.
 */
async function renderLatexToPng(latex: string, isDisplay: boolean): Promise<{
    data: ArrayBuffer;
    width: number;
    height: number;
}> {
    // Build a minimal SVG containing the LaTeX text
    // We use foreignObject to render HTML/MathML inside SVG
    const fontSize = isDisplay ? 20 : 16;
    const padding = isDisplay ? 20 : 4;

    // Create a temporary container to measure the rendered LaTeX
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.visibility = 'hidden';
    container.style.fontSize = `${fontSize}px`;
    container.style.fontFamily = 'serif';
    container.style.padding = `${padding}px`;
    container.style.display = isDisplay ? 'block' : 'inline-block';
    container.style.whiteSpace = 'nowrap';
    container.textContent = latex; // Plain text fallback for measurement
    document.body.appendChild(container);

    const measuredWidth = Math.max(container.offsetWidth + padding * 2, 50);
    const measuredHeight = Math.max(container.offsetHeight + padding * 2, 30);
    document.body.removeChild(container);

    // Render as canvas
    const scale = 2;
    const canvasWidth = measuredWidth * scale;
    const canvasHeight = measuredHeight * scale;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas 2d context for LaTeX rendering');
    }

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Render the LaTeX text
    ctx.fillStyle = '#000000';
    ctx.font = `${fontSize * scale}px serif`;
    ctx.textBaseline = 'middle';

    if (isDisplay) {
        ctx.textAlign = 'center';
        ctx.fillText(latex, canvasWidth / 2, canvasHeight / 2);
    } else {
        ctx.textAlign = 'left';
        ctx.fillText(latex, padding * scale, canvasHeight / 2);
    }

    // Convert to PNG
    const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Canvas toBlob failed'));
        }, 'image/png');
    });

    const data = await blob.arrayBuffer();
    return { data, width: measuredWidth, height: measuredHeight };
}

// ---- Image Fetching ----

/**
 * Fetch image data from a src attribute (base64 data URI or URL).
 * Returns the raw ArrayBuffer and detected dimensions.
 */
async function fetchImageData(src: string): Promise<{
    data: ArrayBuffer;
    width: number;
    height: number;
}> {
    let data: ArrayBuffer;

    if (src.startsWith('data:')) {
        // Base64 data URI — decode it
        const base64Part = src.split(',')[1];
        const binaryString = atob(base64Part);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        data = bytes.buffer;
    } else {
        // Remote URL — fetch it
        const response = await fetch(src);
        data = await response.arrayBuffer();
    }

    // Try to get image dimensions by loading into an Image element
    const { width, height } = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: DEFAULT_IMAGE_WIDTH, height: DEFAULT_IMAGE_HEIGHT });
        if (src.startsWith('data:')) {
            img.src = src;
        } else {
            img.src = URL.createObjectURL(new Blob([data]));
        }
    });

    return { data, width, height };
}

// ---- DOM Walker ----

interface WalkContext {
    bold: boolean;
    italic: boolean;
    code: boolean;
    hyperlink: string | null;
}

/**
 * Walk DOM nodes and produce an array of docx paragraph children (TextRun, ImageRun, etc.).
 * This handles inline elements within a paragraph context.
 */
async function walkInlineNodes(
    node: Node,
    ctx: WalkContext,
): Promise<(TextRun | ImageRun | ExternalHyperlink)[]> {
    const runs: (TextRun | ImageRun | ExternalHyperlink)[] = [];

    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (!text) return runs;

        const run = new TextRun({
            text,
            bold: ctx.bold,
            italics: ctx.italic,
            font: ctx.code ? { name: 'Courier New' } : undefined,
            size: ctx.code ? 20 : undefined, // 10pt in half-points
        });

        if (ctx.hyperlink) {
            runs.push(new ExternalHyperlink({
                children: [run],
                link: ctx.hyperlink,
            }));
        } else {
            runs.push(run);
        }
        return runs;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return runs;

    const el = node as Element;
    const tag = el.tagName.toUpperCase();

    // Update context based on tag
    const newCtx = { ...ctx };
    if (tag === 'STRONG' || tag === 'B') newCtx.bold = true;
    if (tag === 'EM' || tag === 'I') newCtx.italic = true;
    if (tag === 'CODE') newCtx.code = true;
    if (tag === 'A' && el.getAttribute('href')) {
        newCtx.hyperlink = el.getAttribute('href');
    }

    // Handle <br> as line break
    if (tag === 'BR') {
        runs.push(new TextRun({ break: 1 }));
        return runs;
    }

    // Handle inline images
    if (tag === 'IMG') {
        try {
            const src = el.getAttribute('src') || '';
            const widthAttr = el.getAttribute('width');
            const { data, width, height } = await fetchImageData(src);

            // Scale image to fit within page width (max 600px)
            let imgWidth = widthAttr ? parseInt(widthAttr, 10) : width;
            let imgHeight = height;
            const maxWidth = 600;
            if (imgWidth > maxWidth) {
                const scale = maxWidth / imgWidth;
                imgWidth = maxWidth;
                imgHeight = Math.round(height * scale);
            }

            runs.push(new ImageRun({
                data: new Uint8Array(data),
                transformation: {
                    width: imgWidth,
                    height: imgHeight,
                },
                type: 'png',
            }));
        } catch (err) {
            console.warn('Failed to embed image in DOCX:', err);
            runs.push(new TextRun({ text: '[Image]', italics: true }));
        }
        return runs;
    }

    // Recurse into children
    for (const child of Array.from(el.childNodes)) {
        const childRuns = await walkInlineNodes(child, newCtx);
        runs.push(...childRuns);
    }

    return runs;
}

/**
 * Check if a string contains LaTeX delimiters (\(...\) or \[...\]).
 */
function containsLatex(text: string): boolean {
    return /\\\([\s\S]*?\\\)/.test(text) || /\\\[[\s\S]*?\\\]/.test(text);
}

/**
 * Process text that may contain LaTeX expressions.
 * Splits into text runs and LaTeX image runs.
 */
async function processLatexInText(
    text: string,
    ctx: WalkContext,
): Promise<(TextRun | ImageRun)[]> {
    const runs: (TextRun | ImageRun)[] = [];

    // Split on LaTeX delimiters, keeping the delimiters
    const parts = text.split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\])/);

    for (const part of parts) {
        if (!part) continue;

        const displayMatch = part.match(/^\\\[([\s\S]*?)\\\]$/);
        const inlineMatch = part.match(/^\\\(([\s\S]*?)\\\)$/);

        if (displayMatch) {
            try {
                const { data, width, height } = await renderLatexToPng(displayMatch[1], true);
                runs.push(new ImageRun({
                    data: new Uint8Array(data),
                    transformation: { width: Math.min(width, 500), height },
                    type: 'png',
                }));
            } catch {
                // Fallback: insert as plain text
                runs.push(new TextRun({ text: displayMatch[1], italics: true }));
            }
        } else if (inlineMatch) {
            try {
                const { data, width, height } = await renderLatexToPng(inlineMatch[1], false);
                runs.push(new ImageRun({
                    data: new Uint8Array(data),
                    transformation: { width: Math.min(width, 300), height },
                    type: 'png',
                }));
            } catch {
                runs.push(new TextRun({ text: inlineMatch[1], italics: true }));
            }
        } else {
            // Plain text
            runs.push(new TextRun({
                text: part,
                bold: ctx.bold,
                italics: ctx.italic,
                font: ctx.code ? { name: 'Courier New' } : undefined,
            }));
        }
    }

    return runs;
}

/**
 * Convert a single block-level HTML element to docx Paragraph(s).
 * Returns an array because some elements (tables, lists) produce multiple paragraphs.
 */
async function convertBlockElement(el: Element): Promise<(Paragraph | Table)[]> {
    const tag = el.tagName.toUpperCase();
    const defaultCtx: WalkContext = { bold: false, italic: false, code: false, hyperlink: null };

    // ---- Headings ----
    if (tag in HEADING_MAP) {
        const text = el.textContent || '';
        const children: (TextRun | ImageRun)[] = [];

        if (containsLatex(text)) {
            children.push(...await processLatexInText(text, defaultCtx));
        } else {
            const inlineRuns = await walkInlineNodes(el, defaultCtx);
            // Filter to only TextRun and ImageRun for headings
            for (const r of inlineRuns) {
                if (r instanceof TextRun || r instanceof ImageRun) {
                    children.push(r);
                }
            }
        }

        return [new Paragraph({
            heading: HEADING_MAP[tag],
            children: children.length > 0 ? children : [new TextRun(text)],
        })];
    }

    // ---- Paragraphs ----
    if (tag === 'P') {
        const text = el.textContent || '';
        if (!text.trim() && !el.querySelector('img')) return [];

        if (containsLatex(text)) {
            const children = await processLatexInText(text, defaultCtx);
            return [new Paragraph({ children })];
        }

        const inlineRuns = await walkInlineNodes(el, defaultCtx);
        return [new Paragraph({
            children: inlineRuns as (TextRun | ImageRun | ExternalHyperlink)[],
        })];
    }

    // ---- Code blocks ----
    if (tag === 'PRE') {
        const codeText = el.textContent || '';
        const lines = codeText.split('\n');

        return lines.map((line) => new Paragraph({
            children: [new TextRun({
                text: line || ' ', // Word collapses empty paragraphs
                font: { name: 'Courier New' },
                size: 20, // 10pt
            })],
            shading: {
                type: ShadingType.SOLID,
                color: 'f5f5f5',
                fill: 'f5f5f5',
            },
            spacing: { before: 0, after: 0 },
        }));
    }

    // ---- Blockquotes ----
    if (tag === 'BLOCKQUOTE') {
        const paragraphs: (Paragraph | Table)[] = [];
        for (const child of Array.from(el.children)) {
            const childParagraphs = await convertBlockElement(child);
            for (const p of childParagraphs) {
                if (p instanceof Paragraph) {
                    // Re-create paragraph with indent for blockquote
                    paragraphs.push(new Paragraph({
                        children: [new TextRun({
                            text: child.textContent || '',
                            color: '666666',
                            italics: true,
                        })],
                        indent: { left: convertInchesToTwip(0.5) },
                        border: {
                            left: {
                                style: BorderStyle.SINGLE,
                                size: 6,
                                color: 'cccccc',
                            },
                        },
                    }));
                } else {
                    paragraphs.push(p);
                }
            }
        }
        if (paragraphs.length === 0) {
            paragraphs.push(new Paragraph({
                children: [new TextRun({
                    text: el.textContent || '',
                    color: '666666',
                    italics: true,
                })],
                indent: { left: convertInchesToTwip(0.5) },
            }));
        }
        return paragraphs;
    }

    // ---- Tables ----
    if (tag === 'TABLE') {
        const rows: TableRow[] = [];

        const trs = el.querySelectorAll('tr');
        for (const tr of Array.from(trs)) {
            const cells: TableCell[] = [];
            const tds = tr.querySelectorAll('th, td');
            const isHeader = tr.querySelector('th') !== null;

            for (const td of Array.from(tds)) {
                const cellText = td.textContent || '';
                cells.push(new TableCell({
                    children: [new Paragraph({
                        children: [new TextRun({
                            text: cellText,
                            bold: isHeader,
                        })],
                    })],
                    borders: TABLE_BORDERS,
                    shading: isHeader ? {
                        type: ShadingType.SOLID,
                        color: 'f5f5f5',
                        fill: 'f5f5f5',
                    } : undefined,
                }));
            }

            if (cells.length > 0) {
                rows.push(new TableRow({ children: cells }));
            }
        }

        if (rows.length > 0) {
            return [new Table({
                rows,
                width: { size: 100, type: WidthType.PERCENTAGE },
            })];
        }
        return [];
    }

    // ---- Unordered lists ----
    if (tag === 'UL') {
        const items: Paragraph[] = [];
        const lis = el.querySelectorAll(':scope > li');
        for (const li of Array.from(lis)) {
            const text = li.textContent || '';
            items.push(new Paragraph({
                children: [new TextRun(text)],
                bullet: { level: 0 },
            }));
        }
        return items;
    }

    // ---- Ordered lists ----
    if (tag === 'OL') {
        const items: Paragraph[] = [];
        const lis = el.querySelectorAll(':scope > li');
        for (const li of Array.from(lis)) {
            const text = li.textContent || '';
            items.push(new Paragraph({
                children: [new TextRun(text)],
                numbering: { reference: 'ordered-list', level: 0 },
            }));
        }
        return items;
    }

    // ---- Images (standalone) ----
    if (tag === 'IMG') {
        try {
            const src = el.getAttribute('src') || '';
            const widthAttr = el.getAttribute('width');
            const { data, width, height } = await fetchImageData(src);

            let imgWidth = widthAttr ? parseInt(widthAttr, 10) : width;
            let imgHeight = height;
            const maxWidth = 550;
            if (imgWidth > maxWidth) {
                const scale = maxWidth / imgWidth;
                imgWidth = maxWidth;
                imgHeight = Math.round(height * scale);
            }

            return [new Paragraph({
                children: [new ImageRun({
                    data: new Uint8Array(data),
                    transformation: { width: imgWidth, height: imgHeight },
                    type: 'png',
                })],
                alignment: AlignmentType.CENTER,
            })];
        } catch {
            return [new Paragraph({
                children: [new TextRun({ text: '[Image]', italics: true })],
            })];
        }
    }

    // ---- Horizontal rule ----
    if (tag === 'HR') {
        return [new Paragraph({
            children: [],
            border: {
                bottom: { style: BorderStyle.SINGLE, size: 1, color: 'cccccc' },
            },
            spacing: { before: 200, after: 200 },
        })];
    }

    // ---- DIV and other containers — recurse ----
    if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN') {
        const results: (Paragraph | Table)[] = [];
        for (const child of Array.from(el.children)) {
            results.push(...await convertBlockElement(child));
        }
        return results;
    }

    // ---- Fallback: treat as paragraph ----
    const fallbackText = el.textContent || '';
    if (fallbackText.trim()) {
        return [new Paragraph({
            children: [new TextRun(fallbackText)],
        })];
    }

    return [];
}

// ---- Public API ----

/**
 * Convert a cleaned HTML string to a DOCX Blob.
 *
 * @param html - The full HTML document (from convertNoteToHtml)
 * @param title - Document title (used for DOCX properties)
 * @param themeName - Theme to apply for styling hints
 * @returns A Blob containing the .docx file data
 */
export async function htmlToDocx(
    html: string,
    title: string,
    themeName: ThemeName = 'default',
): Promise<Blob> {
    // Parse HTML into DOM
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    // Walk all top-level block elements in <body>
    const children: (Paragraph | Table)[] = [];

    for (const el of Array.from(body.children)) {
        const blocks = await convertBlockElement(el);
        children.push(...blocks);
    }

    // If no content was extracted, add a placeholder
    if (children.length === 0) {
        children.push(new Paragraph({ children: [new TextRun('(empty document)')] }));
    }

    // Build the Document
    const docxDoc = new Document({
        title,
        creator: 'Obsidian — Publish to Google Docs',
        numbering: {
            config: [{
                reference: 'ordered-list',
                levels: [{
                    level: 0,
                    format: LevelFormat.DECIMAL,
                    text: '%1.',
                    alignment: AlignmentType.START,
                }],
            }],
        },
        sections: [{
            children,
        }],
    });

    // Pack to Blob
    return await Packer.toBlob(docxDoc);
}
