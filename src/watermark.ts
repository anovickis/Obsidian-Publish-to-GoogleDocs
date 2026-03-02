// watermark.ts — Diagonal text watermark for exported documents
//
// Adds a semi-transparent diagonal text overlay on documents.
// Uses CSS ::after for PDF/DOCX, and a rendered PNG background
// for Google Docs (which strips pseudo-elements).

// ---- Types ----

export interface WatermarkOpts {
    text: string;
    opacity: number;   // 0.01–0.2
    forGoogleDocs: boolean;  // true = render as background image
}

// ---- CSS Watermark (for PDF/DOCX) ----

/**
 * Generate CSS for a diagonal text watermark using ::after pseudo-element.
 * This works in PDF export and local rendering but is stripped by Google Docs.
 */
function generateCssWatermark(text: string, opacity: number): string {
    const escapedText = text.replace(/"/g, '\\"');
    return `
        body::after {
            content: "${escapedText}";
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-45deg);
            font-size: 120px;
            font-family: Arial, Helvetica, sans-serif;
            color: rgba(0, 0, 0, ${opacity});
            pointer-events: none;
            z-index: 9999;
            white-space: nowrap;
            letter-spacing: 8px;
            text-transform: uppercase;
        }
    `;
}

// ---- PNG Watermark (for Google Docs) ----

/**
 * Render watermark text to a tiled PNG background image data URI.
 * Google Docs preserves background-image CSS on body.
 */
async function generatePngWatermark(text: string, opacity: number): Promise<string> {
    const canvas = document.createElement('canvas');

    // Tile size — the watermark text repeats across the page
    const tileWidth = 600;
    const tileHeight = 400;
    canvas.width = tileWidth;
    canvas.height = tileHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Transparent background
    ctx.clearRect(0, 0, tileWidth, tileHeight);

    // Draw rotated text
    ctx.save();
    ctx.translate(tileWidth / 2, tileHeight / 2);
    ctx.rotate(-Math.PI / 4);  // -45 degrees
    ctx.font = 'bold 48px Arial, Helvetica, sans-serif';
    ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase(), 0, 0);
    ctx.restore();

    // Convert to data URI
    return new Promise<string>((resolve) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                resolve('');
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
        }, 'image/png');
    });
}

// ---- Public API ----

/**
 * Apply a watermark to an HTML document.
 *
 * Injects CSS into the <head> section. For Google Docs target, also
 * generates a PNG tile and sets it as the body background-image.
 *
 * @param html - The complete HTML document string
 * @param opts - Watermark options
 * @returns Modified HTML with watermark CSS/background
 */
export async function applyWatermark(
    html: string,
    opts: WatermarkOpts,
): Promise<string> {
    if (!opts.text) return html;

    let result = html;

    // Always add CSS watermark (works for PDF, DOCX preview)
    const cssWatermark = generateCssWatermark(opts.text, opts.opacity);
    result = result.replace('</head>', `<style>${cssWatermark}</style></head>`);

    // For Google Docs: also add PNG background (since ::after is stripped)
    if (opts.forGoogleDocs) {
        const pngDataUri = await generatePngWatermark(opts.text, opts.opacity);
        if (pngDataUri) {
            // Add background-image to body style
            result = result.replace(
                /(<body[^>]*style=")/,
                `$1background-image:url('${pngDataUri}');background-repeat:repeat;`,
            );
        }
    }

    return result;
}
