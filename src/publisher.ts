// publisher.ts — Orchestrator for the publish workflow
//
// Ties together: converter (markdown→HTML), google-api (upload),
// auth (tokens), and frontmatter (store doc URL).
// Presents the user with a choice modal when updating an existing doc.

import {
    App,
    Modal,
    Notice,
    requestUrl,
    Setting,
    TFile,
} from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';
import { convertNoteToHtml } from './converter';
import {
    createGoogleDoc,
    deleteGoogleDoc,
    uploadImageToDrive,
    extractDocId,
} from './google-api';
import { getValidToken } from './auth';

// ---- Choice Modal ----

type UpdateChoice = 'update' | 'new' | null;

/**
 * Modal dialog that asks the user whether to update the existing
 * Google Doc or create a new one.
 */
class UpdateChoiceModal extends Modal {
    private resolveFn: (value: UpdateChoice) => void;

    constructor(app: App, resolveFn: (value: UpdateChoice) => void) {
        super(app);
        this.resolveFn = resolveFn;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('publish-gdocs-modal');

        contentEl.createEl('h3', { text: 'Publish to Google Docs' });
        contentEl.createEl('p', {
            text: 'This note already has a linked Google Doc. What would you like to do?',
        });

        const buttonContainer = contentEl.createDiv('modal-button-container');

        // Update button (primary action)
        const updateBtn = buttonContainer.createEl('button', { text: 'Update existing' });
        updateBtn.addClass('mod-cta');
        updateBtn.addEventListener('click', () => {
            this.resolveFn('update');
            this.close();
        });

        // Create new button
        const newBtn = buttonContainer.createEl('button', { text: 'Create new' });
        newBtn.addEventListener('click', () => {
            this.resolveFn('new');
            this.close();
        });

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.resolveFn(null);
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/** Show the update choice modal and return the user's selection */
function showUpdateChoiceModal(app: App): Promise<UpdateChoice> {
    return new Promise((resolve) => {
        new UpdateChoiceModal(app, resolve).open();
    });
}

// ---- Main Publish Function ----

/**
 * Publish an Obsidian note to Google Docs.
 *
 * 1. Validates credentials
 * 2. Gets a valid OAuth token (may trigger browser auth flow)
 * 3. Checks frontmatter for existing google_doc URL
 * 4. If exists, asks user: update or create new?
 * 5. Converts markdown → HTML
 * 6. Creates new Google Doc via Drive API
 * 7. If updating, deletes the old doc
 * 8. Writes the new doc URL to frontmatter
 */
export async function publishNote(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    // 1. Validate credentials
    if (!plugin.settings.clientId || !plugin.settings.clientSecret) {
        new Notice('Please configure Google API credentials in the plugin settings first.');
        // Open settings
        const settingTab = (plugin.app as any).setting;
        if (settingTab) {
            settingTab.open();
            settingTab.openTabById('publish-to-google-docs');
        }
        return;
    }

    // 2. Get valid access token
    let token: string;
    try {
        token = await getValidToken(plugin.settings, () => plugin.saveSettings());
    } catch (err) {
        new Notice(`Authentication failed: ${(err as Error).message}`);
        return;
    }

    // 3. Check frontmatter for existing google_doc URL
    let existingUrl: string | null = null;
    const cache = plugin.app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.google_doc) {
        existingUrl = cache.frontmatter.google_doc;
    }

    // 4. If existing doc, show choice modal
    let action: 'update' | 'new' = 'new';
    if (existingUrl) {
        const choice = await showUpdateChoiceModal(plugin.app);
        if (choice === null) return; // User cancelled
        action = choice;
    }

    // 5. Show progress
    const progressNotice = new Notice('Publishing to Google Docs...', 0);

    try {
        // 6. Convert note to HTML
        const uploadImage = async (data: ArrayBuffer, name: string, mime: string): Promise<string> => {
            return uploadImageToDrive(
                token,
                data,
                name,
                mime,
                plugin.settings.defaultFolderId || undefined,
            );
        };

        const html = await convertNoteToHtml(plugin.app, file, uploadImage);

        // 7. Create new Google Doc
        const docName = file.basename;
        const result = await createGoogleDoc(
            token,
            docName,
            html,
            plugin.settings.defaultFolderId || undefined,
        );

        // 8. If updating, move old doc to trash (not permanent delete).
        //    User can recover from Google Drive trash if needed.
        if (action === 'update' && existingUrl) {
            const oldId = extractDocId(existingUrl);
            if (oldId) {
                try {
                    // Move to trash instead of permanent delete
                    await requestUrl({
                        url: `https://www.googleapis.com/drive/v3/files/${oldId}`,
                        method: 'PATCH',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ trashed: true }),
                    });
                } catch (err) {
                    console.warn('Failed to trash old Google Doc:', err);
                    // Non-fatal: old doc stays, new doc is already created
                }
            }
        }

        // 9. Write the new Google Doc URL to frontmatter
        await plugin.app.fileManager.processFrontMatter(file, (fm) => {
            fm.google_doc = result.webViewLink;
        });

        // 10. Success!
        progressNotice.hide();
        new Notice(`Published to Google Docs!\n${result.webViewLink}`, 10000);

        // Open the new doc in the browser
        window.open(result.webViewLink);

    } catch (err) {
        progressNotice.hide();

        // Check if it's an auth error (401/403) — retry once with fresh token
        const status = (err as { status?: number }).status;
        if (status === 401 || status === 403) {
            new Notice('Auth token expired. Refreshing and retrying...');
            plugin.settings.accessToken = '';
            plugin.settings.tokenExpiry = 0;
            await plugin.saveSettings();

            // Retry once
            try {
                await publishNote(plugin, file);
            } catch (retryErr) {
                new Notice(`Publish failed after retry: ${(retryErr as Error).message}`);
            }
            return;
        }

        new Notice(`Publish failed: ${(err as Error).message}`);
        console.error('Publish to Google Docs error:', err);
    }
}
