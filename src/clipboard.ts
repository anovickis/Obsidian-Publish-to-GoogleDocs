// clipboard.ts — Rich HTML clipboard copy for platform export
//
// Copies formatted HTML to the system clipboard so users can paste
// directly into Medium, LinkedIn, or other rich-text editors.
// Uses the Clipboard API with ClipboardItem (supported in Electron).

/**
 * Copy HTML content to the clipboard with both rich HTML and plaintext fallback.
 *
 * @param html - The full HTML document string
 * @param plainText - Plaintext fallback (for editors that only accept text)
 */
export async function copyHtmlToClipboard(html: string, plainText: string): Promise<void> {
    // Try the modern Clipboard API first (ClipboardItem with MIME types)
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([plainText], { type: 'text/plain' });
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': htmlBlob,
                'text/plain': textBlob,
            }),
        ]);
        return;
    }

    // Fallback: use execCommand with a temporary element
    // This works in older Electron versions
    const tempEl = document.createElement('div');
    tempEl.innerHTML = html;
    tempEl.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(tempEl);

    try {
        const range = document.createRange();
        range.selectNodeContents(tempEl);
        const selection = window.getSelection();
        if (selection) {
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('copy');
            selection.removeAllRanges();
        }
    } finally {
        document.body.removeChild(tempEl);
    }
}

/**
 * Extract plaintext from HTML by stripping tags.
 * Used to generate the text/plain clipboard fallback.
 */
export function htmlToPlainText(html: string): string {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    return doc.body.textContent || '';
}
