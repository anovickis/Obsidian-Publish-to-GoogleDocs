// image-optimizer.ts — Canvas-based image compression and resizing
//
// Resizes oversized images and re-encodes them to reduce file size
// before uploading to Google Drive or embedding in documents.

// ---- Types ----

export interface ImageOptimizeOpts {
    maxWidth: number;      // max width in pixels (default: 1200)
    quality: number;       // JPEG quality 0.1–1.0 (default: 0.85)
}

export interface OptimizedImage {
    data: ArrayBuffer;
    mimeType: string;
}

// ---- Image Optimization ----

/**
 * Optimize an image by resizing and compressing.
 *
 * - Images wider than maxWidth are scaled down proportionally
 * - JPEG/WebP images are re-encoded at the specified quality
 * - PNG images stay PNG but are resized if oversized
 * - SVG data is returned as-is (SVGs are handled by rasterization elsewhere)
 * - GIF data is returned as-is (to preserve animation)
 */
export async function optimizeImage(
    imageData: ArrayBuffer,
    mimeType: string,
    opts: ImageOptimizeOpts,
): Promise<OptimizedImage> {
    // Skip SVGs and GIFs
    if (mimeType === 'image/svg+xml' || mimeType === 'image/gif') {
        return { data: imageData, mimeType };
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        const blob = new Blob([imageData], { type: mimeType });
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            try {
                let { width, height } = img;

                // Check if resize is needed
                const needsResize = width > opts.maxWidth;
                if (!needsResize && mimeType === 'image/png') {
                    // PNG that doesn't need resizing — return as-is
                    URL.revokeObjectURL(url);
                    resolve({ data: imageData, mimeType });
                    return;
                }

                // Calculate target dimensions
                if (needsResize) {
                    const ratio = opts.maxWidth / width;
                    width = opts.maxWidth;
                    height = Math.round(height * ratio);
                }

                // Draw on canvas
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    URL.revokeObjectURL(url);
                    reject(new Error('Failed to get canvas 2d context'));
                    return;
                }

                // White background for images with transparency (when converting to JPEG)
                if (mimeType !== 'image/png') {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                }

                ctx.drawImage(img, 0, 0, width, height);

                // Determine output format
                const outputMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
                const quality = outputMime === 'image/jpeg' ? opts.quality : undefined;

                canvas.toBlob(
                    (resultBlob) => {
                        URL.revokeObjectURL(url);
                        if (!resultBlob) {
                            reject(new Error('Canvas toBlob returned null'));
                            return;
                        }
                        resultBlob.arrayBuffer().then((buffer) => {
                            resolve({ data: buffer, mimeType: outputMime });
                        }).catch(reject);
                    },
                    outputMime,
                    quality,
                );
            } catch (err) {
                URL.revokeObjectURL(url);
                reject(err);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            // If we can't load the image, return original data
            resolve({ data: imageData, mimeType });
        };

        img.src = url;
    });
}
