// google-api.ts — Google Drive API interactions
//
// Uses Obsidian's requestUrl() which bypasses CORS restrictions.
// All functions require a valid OAuth access token.

import { requestUrl } from 'obsidian';
import {
    DRIVE_UPLOAD_URL,
    DRIVE_FILES_URL,
    DriveFileResponse,
} from './types';

// ---- Helpers ----

/** Concatenate multiple ArrayBuffers into one */
function concatArrayBuffers(...buffers: ArrayBuffer[]): ArrayBuffer {
    const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
        result.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
    }
    return result.buffer;
}

/** Encode a string as UTF-8 ArrayBuffer */
function stringToArrayBuffer(str: string): ArrayBuffer {
    return new TextEncoder().encode(str).buffer;
}

/** Extract Google Doc ID from a Google Docs URL */
export function extractDocId(url: string): string | null {
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

// ---- Create Google Doc from HTML ----

/**
 * Upload HTML content to Google Drive, auto-converting to a Google Doc.
 * Returns the new document's metadata including its webViewLink.
 */
export async function createGoogleDoc(
    accessToken: string,
    name: string,
    htmlContent: string,
    folderId?: string,
): Promise<DriveFileResponse> {
    const boundary = '----PublishToGDocs' + Date.now();

    // Metadata part: tell Drive to create a Google Doc
    const metadata: Record<string, unknown> = {
        name,
        mimeType: 'application/vnd.google-apps.document',
    };
    if (folderId) {
        metadata.parents = [folderId];
    }

    // Build multipart/related body as a string
    // (both parts are text, so string concatenation works)
    const body = [
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\n`,
        'Content-Type: text/html; charset=UTF-8\r\n\r\n',
        htmlContent,
        `\r\n--${boundary}--`,
    ].join('');

    const response = await requestUrl({
        url: `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,webViewLink,mimeType`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    const data = response.json;
    if (!data.id) {
        throw new Error(`Failed to create Google Doc: ${JSON.stringify(data)}`);
    }

    return {
        id: data.id,
        name: data.name,
        webViewLink: data.webViewLink,
        mimeType: data.mimeType,
    };
}

// ---- Delete a Google Doc ----

/**
 * Delete a file from Google Drive by its file ID.
 * Silently succeeds if the file is already gone (404).
 */
export async function deleteGoogleDoc(
    accessToken: string,
    fileId: string,
): Promise<void> {
    try {
        await requestUrl({
            url: `${DRIVE_FILES_URL}/${fileId}`,
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
    } catch (err: unknown) {
        // 404 = already deleted, that's fine
        const status = (err as { status?: number }).status;
        if (status !== 404) {
            throw err;
        }
    }
}

// ---- Upload Image to Drive ----

/**
 * Upload a binary image to Google Drive and make it publicly accessible.
 * Returns a direct-access URL suitable for use in <img> tags.
 */
export async function uploadImageToDrive(
    accessToken: string,
    imageData: ArrayBuffer,
    fileName: string,
    mimeType: string,
    folderId?: string,
): Promise<string> {
    const boundary = '----PublishToGDocsImg' + Date.now() + Math.random().toString(36).slice(2);

    // Build metadata
    const metadata: Record<string, unknown> = { name: fileName };
    if (folderId) {
        metadata.parents = [folderId];
    }

    // Build multipart body as ArrayBuffer (mixing text + binary)
    const metadataPart = [
        `--${boundary}\r\n`,
        'Content-Type: application/json; charset=UTF-8\r\n\r\n',
        JSON.stringify(metadata),
        '\r\n',
    ].join('');

    const imagePart = [
        `--${boundary}\r\n`,
        `Content-Type: ${mimeType}\r\n`,
        'Content-Transfer-Encoding: binary\r\n\r\n',
    ].join('');

    const closing = `\r\n--${boundary}--`;

    const body = concatArrayBuffers(
        stringToArrayBuffer(metadataPart),
        stringToArrayBuffer(imagePart),
        imageData,
        stringToArrayBuffer(closing),
    );

    // Upload the image
    const uploadResponse = await requestUrl({
        url: `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
    });

    const fileId = uploadResponse.json.id;
    if (!fileId) {
        throw new Error(`Image upload failed: ${JSON.stringify(uploadResponse.json)}`);
    }

    // Make the image publicly accessible (anyone with link can view)
    await requestUrl({
        url: `${DRIVE_FILES_URL}/${fileId}/permissions`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    // Return a direct-access URL that works in <img> tags
    return `https://drive.google.com/uc?id=${fileId}&export=download`;
}
