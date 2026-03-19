// exporters.ts — Local export functions (DOCX, PDF)
//
// Uses pandoc for high-quality output with native equation support
// (OMML equations in DOCX, XeLaTeX-typeset math in PDF).
// Falls back to HTML-based conversion if pandoc is not installed.

import {
    App,
    Modal,
    Notice,
    TFile,
    TFolder,
    Setting,
} from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';
import { convertNoteToHtml, rasterizeSvgToPng } from './converter';
import { htmlToDocx } from './docx-builder';
import { ConvertOptions } from './types';
import { hasFeature, showUpgradeNotice } from './license';
import { publishNote } from './publisher';
import { recordPublishEvent } from './history';
import { resolveEmbeds } from './embed-resolver';

// ============================================================
// Pandoc Helpers
// ============================================================

/**
 * Run pandoc as a child process.
 * Throws on non-zero exit with stderr as the error message.
 */
function runPandoc(args: string[]): Promise<{ stdout: string; stderr: string }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
        execFile('pandoc', args, { maxBuffer: 50 * 1024 * 1024 },
            (error: any, stdout: string, stderr: string) => {
                if (error) reject(new Error(stderr || error.message));
                else resolve({ stdout, stderr });
            },
        );
    });
}

/**
 * Check if pandoc is available on the system PATH.
 */
async function isPandocAvailable(): Promise<boolean> {
    try {
        await runPandoc(['--version']);
        return true;
    } catch {
        return false;
    }
}

/**
 * Find a LaTeX PDF engine for pandoc (xelatex, lualatex, or pdflatex).
 * Returns the engine name or null if none found.
 */
async function findPdfEngine(): Promise<string | null> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execFile } = require('child_process');
    for (const engine of ['xelatex', 'lualatex', 'pdflatex']) {
        try {
            await new Promise<void>((resolve, reject) => {
                execFile(engine, ['--version'], (err: any) => {
                    if (err) reject(err); else resolve();
                });
            });
            return engine;
        } catch { /* try next */ }
    }
    return null;
}

/**
 * Preprocess Obsidian markdown for pandoc consumption.
 *
 * - Strips YAML frontmatter
 * - Resolves ![[note]] transclusion embeds
 * - Converts ![[image]] wikilinks to ![](absolute_path)
 * - Rasterizes SVG images to temp PNGs (DOCX/PDF can't handle SVG)
 * - Converts [[wikilinks]] to bold text
 * - Converts Obsidian callouts to blockquotes
 *
 * LaTeX math ($...$, $$...$$) is left untouched — pandoc handles it natively.
 */
async function preprocessForPandoc(
    app: App,
    file: TFile,
    doResolveEmbeds: boolean,
): Promise<{ markdown: string; tempFiles: string[] }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePath = require('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');

    const vaultBase: string = (app.vault.adapter as any).getBasePath();
    const tempFiles: string[] = [];

    let md = await app.vault.read(file);

    // Strip YAML frontmatter (pandoc metadata handling differs from Obsidian)
    const fmMatch = md.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    if (fmMatch) md = md.slice(fmMatch[0].length);

    // Resolve ![[note]] transclusion embeds
    if (doResolveEmbeds) {
        md = await resolveEmbeds(md, app, file);
    }

    // --- Protect code blocks from further regex ---
    const codeBlocks: { placeholder: string; original: string }[] = [];
    md = md.replace(/```[\s\S]*?```/g, (match) => {
        const ph = `__PANDOC_CB${codeBlocks.length}__`;
        codeBlocks.push({ placeholder: ph, original: match });
        return ph;
    });
    md = md.replace(/`[^`\n]+`/g, (match) => {
        const ph = `__PANDOC_CI${codeBlocks.length}__`;
        codeBlocks.push({ placeholder: ph, original: match });
        return ph;
    });

    // --- Resolve wikilink images: ![[path]] or ![[path|size/alt]] ---
    const wikiImgRegex = /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g;
    const imgReplacements: [string, string][] = [];
    let m;
    while ((m = wikiImgRegex.exec(md)) !== null) {
        const imgPath = m[1].trim();
        const sizeOrAlt = (m[2] || '').trim();

        const imageFile = app.metadataCache.getFirstLinkpathDest(imgPath, file.path);
        if (!imageFile) {
            imgReplacements.push([m[0], `*[Image not found: ${imgPath}]*`]);
            continue;
        }

        let absPath = nodePath.join(vaultBase, imageFile.path).replace(/\\/g, '/');

        // SVG → rasterize to temp PNG
        if (imageFile.extension.toLowerCase() === 'svg') {
            try {
                const svgData = await app.vault.readBinary(imageFile);
                const pngData = await rasterizeSvgToPng(svgData);
                const tmpPng = nodePath.join(
                    os.tmpdir(),
                    `obsidian-export-${Date.now()}-${imageFile.basename}.png`,
                );
                fs.writeFileSync(tmpPng, Buffer.from(pngData));
                absPath = tmpPng.replace(/\\/g, '/');
                tempFiles.push(tmpPng);
            } catch (err) {
                console.warn(`SVG rasterization failed for ${imgPath}:`, err);
            }
        }

        // Width attribute (pandoc supports {width=Npx} after the image)
        let widthSuffix = '';
        let alt = '';
        if (sizeOrAlt && /^\d+(?:x\d+)?$/.test(sizeOrAlt)) {
            widthSuffix = `{ width=${sizeOrAlt.split('x')[0]}px }`;
        } else if (sizeOrAlt) {
            alt = sizeOrAlt;
        }

        imgReplacements.push([m[0], `![${alt}](${absPath})${widthSuffix}`]);
    }
    for (const [orig, repl] of imgReplacements) {
        md = md.split(orig).join(repl);
    }

    // --- Resolve standard markdown images with relative paths ---
    md = md.replace(/!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g, (match, alt, relPath) => {
        const decoded = decodeURIComponent(relPath.trim());
        const resolved = app.metadataCache.getFirstLinkpathDest(decoded, file.path);
        if (resolved) {
            const abs = nodePath.join(vaultBase, resolved.path).replace(/\\/g, '/');
            return `![${alt}](${abs})`;
        }
        return match;
    });

    // --- Convert [[wikilinks]] to bold text ---
    md = md.replace(/\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (_, target, alias) => {
        return `**${alias || target}**`;
    });

    // --- Convert Obsidian callouts to blockquotes ---
    // > [!type] Title → > **Title**
    md = md.replace(/^(>\s*)\[!(\w+)\]\s*(.*)/gm, (_, prefix, type, title) => {
        const display = title.trim() || type.charAt(0).toUpperCase() + type.slice(1);
        return `${prefix}**${display}**`;
    });

    // --- Fix LaTeX for pandoc's texmath parser ---
    // Bare _\text{...} subscripts (without outer braces) cause a parse failure
    // when followed by \tag{N}. Normalize to _{\text{...}} which is equivalent
    // LaTeX but parseable by texmath.
    md = md.replace(/_\\text\{([^}]*)\}/g, '_{\\text{$1}}');
    md = md.replace(/\^\\text\{([^}]*)\}/g, '^{\\text{$1}}');

    // --- Restore code blocks ---
    for (let i = codeBlocks.length - 1; i >= 0; i--) {
        md = md.split(codeBlocks[i].placeholder).join(codeBlocks[i].original);
    }

    return { markdown: md, tempFiles };
}

/**
 * Clean up temporary files created during preprocessing.
 */
function cleanupTemp(paths: string[]): void {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    for (const p of paths) {
        try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
}

// ============================================================
// DOCX Export
// ============================================================

/**
 * Export a note to DOCX using pandoc (native Word equations).
 * Falls back to HTML-based builder if pandoc is not available.
 */
export async function exportToDocx(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    if (!hasFeature(plugin.settings, 'docx-export')) {
        showUpgradeNotice('docx-export');
        return;
    }

    // Try pandoc first, fall back to HTML-based export
    if (await isPandocAvailable()) {
        return exportToDocxPandoc(plugin, file);
    }
    console.log('[export] pandoc not found, using HTML-based DOCX export');
    return exportToDocxLegacy(plugin, file);
}

/** Pandoc-based DOCX export — produces native Word equations via OMML. */
async function exportToDocxPandoc(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePath = require('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');

    const progressNotice = new Notice('Exporting to DOCX (pandoc)...', 0);
    let tempMd = '';
    let tempFiles: string[] = [];

    try {
        // 1. Preprocess markdown
        const preprocessed = await preprocessForPandoc(
            plugin.app, file, plugin.settings.resolveEmbeds,
        );
        tempFiles = preprocessed.tempFiles;

        // 2. Write to temp file
        tempMd = nodePath.join(os.tmpdir(), `obsidian-docx-${Date.now()}.md`);
        fs.writeFileSync(tempMd, preprocessed.markdown, 'utf-8');

        // 3. Output path (alongside the .md file)
        const vaultBase = (plugin.app.vault.adapter as any).getBasePath();
        const docxPath = file.path.replace(/\.md$/, '.docx');
        const absDocx = nodePath.join(vaultBase, docxPath);

        // 4. Resource path (so pandoc can find images relative to the note)
        const resourceDir = nodePath.join(vaultBase, nodePath.dirname(file.path));

        // 5. Build pandoc args
        const args = [
            tempMd,
            '-o', absDocx,
            '--from', 'markdown+tex_math_dollars+pipe_tables+strikeout+task_lists',
            '--to', 'docx',
            '--resource-path', resourceDir,
        ];

        // Optional: custom reference doc for Word styling
        const refDoc = nodePath.join(vaultBase, 'reference.docx');
        if (fs.existsSync(refDoc)) {
            args.push('--reference-doc', refDoc);
        }

        // 6. Run pandoc
        console.log('[export] Running pandoc:', args.join(' '));
        await runPandoc(args);

        // 7. Record success
        await recordPublishEvent(plugin, {
            filePath: file.path,
            fileName: file.basename,
            format: 'docx',
            success: true,
        });

        progressNotice.hide();
        new Notice(`Exported to ${docxPath}`, 5000);

        // Open in default viewer
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('electron').shell.openPath(absDocx);

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
    } finally {
        if (tempMd) try { require('fs').unlinkSync(tempMd); } catch { /* */ }
        cleanupTemp(tempFiles);
    }
}

/** Legacy HTML-based DOCX export (fallback when pandoc is not installed). */
async function exportToDocxLegacy(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    const progressNotice = new Notice('Exporting to DOCX...', 0);

    try {
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
            // Force math as images for legacy path — docx-builder can't handle
            // text-delimiter math ($$...$$ or \(...\)) reliably
            mathAsImages: true,
            journalTemplate: plugin.settings.journalTemplate,
            optimizeImages: plugin.settings.optimizeImages,
            maxImageWidth: plugin.settings.maxImageWidth,
            imageQuality: plugin.settings.imageQuality,
            watermarkText: plugin.settings.watermarkText,
            watermarkOpacity: plugin.settings.watermarkOpacity,
        };

        const html = await convertNoteToHtml(plugin.app, file, null, options);
        const blob = await htmlToDocx(html, file.basename, plugin.settings.theme);
        const buffer = await blob.arrayBuffer();

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

        const vaultPath = (plugin.app.vault.adapter as any).getBasePath();
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fullPath = require('path').join(vaultPath, docxPath);
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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

// ============================================================
// PDF Export
// ============================================================

/**
 * Export a note to PDF.
 * Uses pandoc + XeLaTeX for proper typeset math if available.
 * Falls back to HTML → BrowserWindow.printToPDF otherwise.
 */
export async function exportToPdf(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    if (!hasFeature(plugin.settings, 'pdf-export')) {
        showUpgradeNotice('pdf-export');
        return;
    }

    // Try pandoc + LaTeX engine first
    if (await isPandocAvailable()) {
        const engine = await findPdfEngine();
        if (engine) {
            return exportToPdfPandoc(plugin, file, engine);
        }
        console.log('[export] pandoc found but no LaTeX engine — falling back to HTML PDF');
    }
    return exportToPdfLegacy(plugin, file);
}

/** Pandoc-based PDF export — uses XeLaTeX for proper typeset math. */
async function exportToPdfPandoc(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
    pdfEngine: string,
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePath = require('path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require('os');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');

    const progressNotice = new Notice(`Generating PDF (pandoc + ${pdfEngine})...`, 0);
    let tempMd = '';
    let tempFiles: string[] = [];

    try {
        // 1. Ask user where to save
        const { dialog } = electron.remote;
        const saveResult = await dialog.showSaveDialog({
            defaultPath: `${file.basename}.pdf`,
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        });
        if (saveResult.canceled || !saveResult.filePath) {
            progressNotice.hide();
            return;
        }

        // 2. Preprocess markdown
        const preprocessed = await preprocessForPandoc(
            plugin.app, file, plugin.settings.resolveEmbeds,
        );
        tempFiles = preprocessed.tempFiles;

        // 3. Write to temp file
        tempMd = nodePath.join(os.tmpdir(), `obsidian-pdf-${Date.now()}.md`);
        fs.writeFileSync(tempMd, preprocessed.markdown, 'utf-8');

        // 4. Resource path
        const vaultBase = (plugin.app.vault.adapter as any).getBasePath();
        const resourceDir = nodePath.join(vaultBase, nodePath.dirname(file.path));

        // 5. Build pandoc args
        const args = [
            tempMd,
            '-o', saveResult.filePath,
            '--from', 'markdown+tex_math_dollars+pipe_tables+strikeout+task_lists',
            `--pdf-engine=${pdfEngine}`,
            '--resource-path', resourceDir,
            '-V', 'geometry:margin=1in',
            // Cambria has broad Unicode coverage (≈, ×, °, em-dash, etc.)
            // and ships with Windows. Latin Modern lacks many of these glyphs.
            '-V', 'mainfont:Cambria',
            '-V', 'monofont:Consolas',
        ];

        // 6. Run pandoc
        console.log('[export] Running pandoc:', args.join(' '));
        await runPandoc(args);

        progressNotice.hide();
        new Notice(`PDF saved to ${saveResult.filePath}`, 5000);

        await recordPublishEvent(plugin, {
            filePath: file.path,
            fileName: file.basename,
            format: 'pdf',
            success: true,
        });

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
    } finally {
        if (tempMd) try { require('fs').unlinkSync(tempMd); } catch { /* */ }
        cleanupTemp(tempFiles);
    }
}

/** Legacy HTML-based PDF export (fallback when pandoc/LaTeX not available). */
async function exportToPdfLegacy(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    const progressNotice = new Notice('Generating PDF...', 0);

    try {
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
            // Force math as images for legacy path — the hidden BrowserWindow
            // has no MathJax, so $$...$$ text would appear as raw LaTeX
            mathAsImages: true,
            journalTemplate: plugin.settings.journalTemplate,
            optimizeImages: plugin.settings.optimizeImages,
            maxImageWidth: plugin.settings.maxImageWidth,
            imageQuality: plugin.settings.imageQuality,
            watermarkText: plugin.settings.watermarkText,
            watermarkOpacity: plugin.settings.watermarkOpacity,
        };

        const html = await convertNoteToHtml(plugin.app, file, null, options);

        const printHtml = html.replace('</head>', `
            <style>
                body { margin: 0; padding: 20px; }
                pre { white-space: pre-wrap; word-break: break-all; }
                img { max-width: 100%; page-break-inside: avoid; }
                h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
                table { page-break-inside: avoid; }
            </style>
            </head>`);

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const electron = require('electron');
        const { BrowserWindow, dialog } = electron.remote;

        const saveResult = await dialog.showSaveDialog({
            defaultPath: `${file.basename}.pdf`,
            filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
        });

        if (saveResult.canceled || !saveResult.filePath) {
            progressNotice.hide();
            return;
        }

        const win = new BrowserWindow({
            show: false,
            width: 800,
            height: 600,
            webPreferences: { offscreen: true },
        });

        try {
            await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printHtml)}`);
            await new Promise(resolve => setTimeout(resolve, 1000));

            const pdfData = await win.webContents.printToPDF({
                marginsType: 0,
                printBackground: true,
                pageSize: 'A4',
            });

            // eslint-disable-next-line @typescript-eslint/no-var-requires
            require('fs').writeFileSync(saveResult.filePath, pdfData);

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

// ============================================================
// Batch Publish
// ============================================================

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
    if (!hasFeature(plugin.settings, 'batch-publish')) {
        showUpgradeNotice('batch-publish');
        return;
    }

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

        if (i < files.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    modal.close();

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
