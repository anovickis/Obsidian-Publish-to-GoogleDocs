// exporters.ts — Local export functions (DOCX, PDF)
//
// These functions handle exporting Obsidian notes to local files
// without uploading to Google Drive. They use the same converter
// pipeline but with imageMode: 'embed' (base64 data URIs).

import {
    App,
    Modal,
    Notice,
    TFile,
    TFolder,
    Setting,
} from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';
import { convertNoteToHtml } from './converter';
import { htmlToDocx } from './docx-builder';
import { ConvertOptions } from './types';
import { hasFeature, showUpgradeNotice } from './license';
import { publishNote } from './publisher';
import { recordPublishEvent } from './history';

// ---- DOCX Export ----

/**
 * Export a single note to a .docx file saved in the vault.
 */
export async function exportToDocx(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    // Feature gate
    if (!hasFeature(plugin.settings, 'docx-export')) {
        showUpgradeNotice('docx-export');
        return;
    }

    const progressNotice = new Notice('Exporting to DOCX...', 0);

    try {
        // Convert with embedded images (no Drive upload needed)
        const options: Partial<ConvertOptions> = {
            imageMode: 'embed',
            theme: plugin.settings.theme,
            includeToc: plugin.settings.includeToc,
            headerText: plugin.settings.customHeaderText || undefined,
            footerText: plugin.settings.customFooterText || undefined,
            resolveEmbeds: plugin.settings.resolveEmbeds,
            renderMermaid: plugin.settings.renderMermaid,
            handleFootnotes: plugin.settings.handleFootnotes,
            autoNumberFigures: plugin.settings.autoNumberFigures,
            resolveWikilinks: plugin.settings.resolveWikilinks,
            syntaxHighlighting: plugin.settings.syntaxHighlighting,
            customCss: plugin.settings.customCss || undefined,
            citationStyle: plugin.settings.citationStyle,
            bibFilePath: plugin.settings.bibFilePath,
            resolveCrossRefs: plugin.settings.resolveCrossRefs,
            mathAsImages: plugin.settings.mathAsImages,
            journalTemplate: plugin.settings.journalTemplate,
            optimizeImages: plugin.settings.optimizeImages,
            maxImageWidth: plugin.settings.maxImageWidth,
            imageQuality: plugin.settings.imageQuality,
            watermarkText: plugin.settings.watermarkText,
            watermarkOpacity: plugin.settings.watermarkOpacity,
        };

        const html = await convertNoteToHtml(plugin.app, file, null, options);

        // Build DOCX from HTML
        const blob = await htmlToDocx(html, file.basename, plugin.settings.theme);
        const buffer = await blob.arrayBuffer();

        // Save alongside the markdown file
        const docxPath = file.path.replace(/\.md$/, '.docx');
        await plugin.app.vault.adapter.writeBinary(docxPath, new Uint8Array(buffer));

        await recordPublishEvent(plugin, {
            filePath: file.path,
            fileName: file.basename,
            format: 'docx',
            success: true,
        });

        progressNotice.hide();
        new Notice(`Exported to ${docxPath}`, 5000);

        // Open with the system's default .docx viewer
        const vaultPath = (plugin.app.vault.adapter as any).getBasePath();
        const fullPath = require('path').join(vaultPath, docxPath);
        require('electron').shell.openPath(fullPath);

    } catch (err) {
        progressNotice.hide();
        console.error('DOCX export error:', err);
        new Notice(`DOCX export failed: ${(err as Error).message}`);

        await recordPublishEvent(plugin, {
            filePath: file.path,
            fileName: file.basename,
            format: 'docx',
            success: false,
            error: (err as Error).message,
        });
    }
}

// ---- PDF Export ----

/**
 * Export a single note to a PDF file.
 * Uses an offscreen iframe + window.print() as the most reliable
 * cross-platform approach within Obsidian's Electron environment.
 */
export async function exportToPdf(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    // Feature gate
    if (!hasFeature(plugin.settings, 'pdf-export')) {
        showUpgradeNotice('pdf-export');
        return;
    }

    const progressNotice = new Notice('Generating PDF...', 0);

    try {
        // Convert with embedded images
        const options: Partial<ConvertOptions> = {
            imageMode: 'embed',
            theme: plugin.settings.theme,
            includeToc: plugin.settings.includeToc,
            headerText: plugin.settings.customHeaderText || undefined,
            footerText: plugin.settings.customFooterText || undefined,
            resolveEmbeds: plugin.settings.resolveEmbeds,
            renderMermaid: plugin.settings.renderMermaid,
            handleFootnotes: plugin.settings.handleFootnotes,
            autoNumberFigures: plugin.settings.autoNumberFigures,
            resolveWikilinks: plugin.settings.resolveWikilinks,
            syntaxHighlighting: plugin.settings.syntaxHighlighting,
            customCss: plugin.settings.customCss || undefined,
            citationStyle: plugin.settings.citationStyle,
            bibFilePath: plugin.settings.bibFilePath,
            resolveCrossRefs: plugin.settings.resolveCrossRefs,
            mathAsImages: plugin.settings.mathAsImages,
            journalTemplate: plugin.settings.journalTemplate,
            optimizeImages: plugin.settings.optimizeImages,
            maxImageWidth: plugin.settings.maxImageWidth,
            imageQuality: plugin.settings.imageQuality,
            watermarkText: plugin.settings.watermarkText,
            watermarkOpacity: plugin.settings.watermarkOpacity,
        };

        const html = await convertNoteToHtml(plugin.app, file, null, options);

        // Add print-specific styles to the HTML
        const printHtml = html.replace('</head>', `
            <style>
                body { margin: 0; padding: 20px; }
                pre { white-space: pre-wrap; word-break: break-all; }
                img { max-width: 100%; page-break-inside: avoid; }
                h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
                table { page-break-inside: avoid; }
            </style>
            </head>`);

        // Generate PDF directly using Electron's printToPDF (no print dialog)
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require('electron');
        const { BrowserWindow, dialog } = electron.remote;

        // Ask user where to save before generating
        const saveResult = await dialog.showSaveDialog({
            defaultPath: `${file.basename}.pdf`,
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        });

        if (saveResult.canceled || !saveResult.filePath) {
            progressNotice.hide();
            return;
        }

        // Create a hidden window to render the HTML
        const win = new BrowserWindow({
            show: false,
            width: 800,
            height: 600,
            webPreferences: { offscreen: true },
        });

        try {
            await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printHtml)}`);

            // Wait for content to render
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Generate PDF
            const pdfData = await win.webContents.printToPDF({
                marginsType: 0,
                printBackground: true,
                pageSize: 'A4',
            });

            // Save to disk
            const fs = require('fs');
            fs.writeFileSync(saveResult.filePath, pdfData);

            progressNotice.hide();
            new Notice(`PDF saved to ${saveResult.filePath}`, 5000);

            await recordPublishEvent(plugin, {
                filePath: file.path,
                fileName: file.basename,
                format: 'pdf',
                success: true,
            });
        } finally {
            win.close();
        }

    } catch (err) {
        progressNotice.hide();
        console.error('PDF export error:', err);
        new Notice(`PDF export failed: ${(err as Error).message}`);

        await recordPublishEvent(plugin, {
            filePath: file.path,
            fileName: file.basename,
            format: 'pdf',
            success: false,
            error: (err as Error).message,
        });
    }
}

// ---- Batch Publish ----

/**
 * Progress modal for batch publishing.
 */
class BatchProgressModal extends Modal {
    private messageEl: HTMLElement;
    private progressEl: HTMLElement;
    private cancelled = false;

    constructor(app: App) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Batch Publishing' });
        this.messageEl = contentEl.createEl('p', { text: 'Preparing...' });
        this.progressEl = contentEl.createEl('div', { cls: 'publish-gdocs-progress' });
        this.progressEl.style.cssText =
            'width:100%;height:8px;background:#e0e0e0;border-radius:4px;margin:12px 0;';

        const bar = this.progressEl.createEl('div');
        bar.style.cssText =
            'width:0%;height:100%;background:#448aff;border-radius:4px;transition:width 0.3s;';

        const cancelBtn = contentEl.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => {
            this.cancelled = true;
            this.close();
        });
    }

    update(current: number, total: number, fileName: string): void {
        this.messageEl.textContent = `Publishing ${current}/${total}: ${fileName}`;
        const bar = this.progressEl.querySelector('div');
        if (bar) {
            (bar as HTMLElement).style.width = `${(current / total) * 100}%`;
        }
    }

    isCancelled(): boolean {
        return this.cancelled;
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Batch publish all markdown files in a folder to Google Docs.
 */
export async function batchPublishFolder(
    plugin: PublishToGoogleDocsPlugin,
    folder: TFolder,
): Promise<void> {
    // Feature gate
    if (!hasFeature(plugin.settings, 'batch-publish')) {
        showUpgradeNotice('batch-publish');
        return;
    }

    // Collect all .md files in the folder (recursively)
    const files: TFile[] = [];
    function collectFiles(f: TFolder): void {
        for (const child of f.children) {
            if (child instanceof TFile && child.extension === 'md') {
                files.push(child);
            } else if (child instanceof TFolder) {
                collectFiles(child);
            }
        }
    }
    collectFiles(folder);

    if (files.length === 0) {
        new Notice('No markdown files found in this folder.');
        return;
    }

    // Rate limit warning
    const MAX_BATCH = 50;
    if (files.length > MAX_BATCH) {
        new Notice(
            `Folder contains ${files.length} files. ` +
            `Batch publish is limited to ${MAX_BATCH} files to avoid Google API rate limits. ` +
            `Only the first ${MAX_BATCH} files will be published.`,
            10000,
        );
        files.splice(MAX_BATCH);
    }

    // Show progress modal
    const modal = new BatchProgressModal(plugin.app);
    modal.open();

    let succeeded = 0;
    let failed = 0;
    const failures: string[] = [];

    for (let i = 0; i < files.length; i++) {
        if (modal.isCancelled()) break;

        const file = files[i];
        modal.update(i + 1, files.length, file.name);

        try {
            await publishNote(plugin, file);
            succeeded++;
        } catch (err) {
            failed++;
            failures.push(`${file.name}: ${(err as Error).message}`);
            console.error(`Batch publish failed for ${file.path}:`, err);
        }

        // 1-second delay between publishes to avoid rate limiting
        if (i < files.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    modal.close();

    // Results summary
    const cancelNote = modal.isCancelled() ? ' (cancelled)' : '';
    let message = `Batch publish complete${cancelNote}: ${succeeded} succeeded`;
    if (failed > 0) {
        message += `, ${failed} failed`;
    }
    new Notice(message, 8000);

    if (failures.length > 0) {
        console.error('Batch publish failures:', failures);
    }
}
