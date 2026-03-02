// main.ts — Plugin entry point for "Publish to Google Docs" v2.0.0
//
// Registers context menu items, settings tab, and auto-publish watcher.
// Menu items:
//   - Publish to Google Docs (free — always shown on .md files)
//   - Export to DOCX (Pro — shown on .md files)
//   - Export to PDF (Pro — shown on .md files)
//   - Publish folder to Google Docs (Pro — shown on folders)

import {
    Modal,
    Notice,
    Plugin,
    TFile,
    TFolder,
    TAbstractFile,
} from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS, TargetFormat } from './types';
import { PublishSettingTab } from './settings';
import { publishNote } from './publisher';
import { exportToDocx, exportToPdf, batchPublishFolder } from './exporters';
import { hasFeature, validateLicense, showUpgradeNotice } from './license';
import { showFormatModal } from './format-modal';
import { compileProject, hasProjectManifest } from './project-compiler';
import { convertNoteToHtml } from './converter';
import { createGoogleDoc, uploadImageToDrive } from './google-api';
import { getValidToken } from './auth';
import { importComments } from './comment-import';
import { recordPublishEvent } from './history';

const PLUGIN_VERSION = '2.1.1';

export default class PublishToGoogleDocsPlugin extends Plugin {
    settings: PluginSettings = { ...DEFAULT_SETTINGS };

    async onload(): Promise<void> {
        await this.loadSettings();

        // Validate license on load (non-blocking, uses cache)
        validateLicense(this.settings, () => this.saveSettings()).catch((err) => {
            console.warn('License validation on load failed:', err);
        });

        // Register settings tab
        this.addSettingTab(new PublishSettingTab(this.app, this));

        // ---- File Menu: Markdown files ----
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file: TAbstractFile) => {
                if (!(file instanceof TFile)) return;
                if (file.extension !== 'md') return;

                // Free: Publish to Google Docs
                menu.addItem((item) => {
                    item.setTitle('Publish to Google Docs')
                        .setIcon('upload-cloud')
                        .onClick(async () => {
                            try {
                                await publishNote(this, file);
                            } catch (err) {
                                console.error('Publish to Google Docs error:', err);
                                new Notice(`Publish failed: ${(err as Error).message}`);
                            }
                        });
                });

                // Pro: Export to DOCX
                menu.addItem((item) => {
                    item.setTitle('Export to DOCX')
                        .setIcon('file-text')
                        .onClick(async () => {
                            try {
                                await exportToDocx(this, file);
                            } catch (err) {
                                console.error('DOCX export error:', err);
                                new Notice(`DOCX export failed: ${(err as Error).message}`);
                            }
                        });
                });

                // Pro: Export to PDF
                menu.addItem((item) => {
                    item.setTitle('Export to PDF')
                        .setIcon('file')
                        .onClick(async () => {
                            try {
                                await exportToPdf(this, file);
                            } catch (err) {
                                console.error('PDF export error:', err);
                                new Notice(`PDF export failed: ${(err as Error).message}`);
                            }
                        });
                });

                // Pro: Copy for Medium
                menu.addItem((item) => {
                    item.setTitle('Copy for Medium')
                        .setIcon('clipboard-copy')
                        .onClick(async () => {
                            if (!hasFeature(this.settings, 'platform-export')) {
                                showUpgradeNotice('platform-export');
                                return;
                            }
                            try {
                                await publishNote(this, file, 'medium');
                            } catch (err) {
                                console.error('Medium export error:', err);
                                new Notice(`Medium export failed: ${(err as Error).message}`);
                            }
                        });
                });

                // Pro: Copy for LinkedIn
                menu.addItem((item) => {
                    item.setTitle('Copy for LinkedIn')
                        .setIcon('clipboard-copy')
                        .onClick(async () => {
                            if (!hasFeature(this.settings, 'platform-export')) {
                                showUpgradeNotice('platform-export');
                                return;
                            }
                            try {
                                await publishNote(this, file, 'linkedin');
                            } catch (err) {
                                console.error('LinkedIn export error:', err);
                                new Notice(`LinkedIn export failed: ${(err as Error).message}`);
                            }
                        });
                });

                // Pro: Compile Project (only shown if file has publish_project manifest)
                if (hasProjectManifest(this.app, file)) {
                    menu.addItem((item) => {
                        item.setTitle('Compile Project to Google Docs')
                            .setIcon('layers')
                            .onClick(async () => {
                                if (!hasFeature(this.settings, 'project-compile')) {
                                    showUpgradeNotice('project-compile');
                                    return;
                                }
                                try {
                                    await this.compileAndPublishProject(file);
                                } catch (err) {
                                    console.error('Project compilation error:', err);
                                    new Notice(`Project compilation failed: ${(err as Error).message}`);
                                }
                            });
                    });
                }

                // Premium: Import Google Docs Comments
                menu.addItem((item) => {
                    item.setTitle('Import Google Docs Comments')
                        .setIcon('message-circle')
                        .onClick(async () => {
                            if (!hasFeature(this.settings, 'comment-import')) {
                                showUpgradeNotice('comment-import');
                                return;
                            }
                            try {
                                await importComments(this, file);
                            } catch (err) {
                                console.error('Comment import error:', err);
                                new Notice(`Comment import failed: ${(err as Error).message}`);
                            }
                        });
                });
            }),
        );

        // ---- File Menu: Folders ----
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file: TAbstractFile) => {
                if (!(file instanceof TFolder)) return;

                // Pro: Batch publish folder
                menu.addItem((item) => {
                    item.setTitle('Publish folder to Google Docs')
                        .setIcon('upload-cloud')
                        .onClick(async () => {
                            try {
                                await batchPublishFolder(this, file);
                            } catch (err) {
                                console.error('Batch publish error:', err);
                                new Notice(`Batch publish failed: ${(err as Error).message}`);
                            }
                        });
                });
            }),
        );

        // ---- "What's New" modal on first v2 load ----
        if (this.settings.lastShownVersion !== PLUGIN_VERSION) {
            // Delay slightly so Obsidian finishes loading
            setTimeout(() => {
                new WhatsNewModal(this.app).open();
            }, 2000);
            this.settings.lastShownVersion = PLUGIN_VERSION;
            await this.saveSettings();
        }
    }

    /**
     * Compile a multi-file project and publish to Google Docs.
     */
    async compileAndPublishProject(masterFile: TFile): Promise<void> {
        // 1. Validate credentials
        if (!this.settings.clientId || !this.settings.clientSecret) {
            new Notice('Please configure Google API credentials in the plugin settings first.');
            return;
        }

        const progressNotice = new Notice('Compiling project...', 0);

        try {
            // 2. Compile the project
            const compiled = await compileProject(this.app, masterFile);
            if (!compiled) return;

            // 3. Get auth token
            const token = await getValidToken(this.settings, () => this.saveSettings());

            // 4. Build convert options
            const uploadImage = async (data: ArrayBuffer, name: string, mime: string): Promise<string> => {
                return uploadImageToDrive(
                    token, data, name, mime,
                    this.settings.defaultFolderId || undefined,
                );
            };

            const convertOptions = {
                imageMode: 'upload' as const,
                theme: this.settings.theme,
                includeToc: this.settings.includeToc,
                headerText: this.settings.customHeaderText || undefined,
                footerText: this.settings.customFooterText || undefined,
                targetFormat: 'google-docs' as const,
                resolveEmbeds: this.settings.resolveEmbeds,
                renderMermaid: this.settings.renderMermaid,
                handleFootnotes: this.settings.handleFootnotes,
                autoNumberFigures: this.settings.autoNumberFigures,
                resolveWikilinks: this.settings.resolveWikilinks,
                syntaxHighlighting: this.settings.syntaxHighlighting,
                customCss: this.settings.customCss || undefined,
                citationStyle: this.settings.citationStyle,
                bibFilePath: compiled.bibPath || this.settings.bibFilePath,
                resolveCrossRefs: this.settings.resolveCrossRefs,
                mathAsImages: this.settings.mathAsImages,
                journalTemplate: this.settings.journalTemplate,
                optimizeImages: this.settings.optimizeImages,
                maxImageWidth: this.settings.maxImageWidth,
                imageQuality: this.settings.imageQuality,
                watermarkText: this.settings.watermarkText,
                watermarkOpacity: this.settings.watermarkOpacity,
            };

            progressNotice.setMessage('Converting project...');

            // 5. Convert using the compiled markdown
            const html = await convertNoteToHtml(
                this.app, masterFile, uploadImage, convertOptions, compiled.markdown,
            );

            progressNotice.setMessage('Uploading to Google Docs...');

            // 6. Create Google Doc
            const result = await createGoogleDoc(
                token,
                masterFile.basename,
                html,
                this.settings.defaultFolderId || undefined,
            );

            // 7. Write URL to frontmatter
            await this.app.fileManager.processFrontMatter(masterFile, (fm) => {
                fm.google_doc = result.webViewLink;
            });

            // 8. Record in history
            await recordPublishEvent(this, {
                filePath: masterFile.path,
                fileName: masterFile.basename,
                format: 'google-docs',
                success: true,
                url: result.webViewLink,
            });

            progressNotice.hide();
            new Notice(`Project published to Google Docs!\n${result.webViewLink}`, 10000);
            window.open(result.webViewLink);

        } catch (err) {
            progressNotice.hide();
            console.error('Project compilation error:', err);
            new Notice(`Project compilation failed: ${(err as Error).message}`);

            await recordPublishEvent(this, {
                filePath: masterFile.path,
                fileName: masterFile.basename,
                format: 'google-docs',
                success: false,
                error: (err as Error).message,
            });
        }
    }

    onunload(): void {
        // No persistent resources to clean up
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}

// ---- What's New Modal ----

class WhatsNewModal extends Modal {
    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: "What's New in v2.0" });

        const intro = contentEl.createEl('p');
        intro.textContent = 'Publish to Google Docs now offers Pro and Premium tiers with powerful new features:';

        const features = contentEl.createEl('ul');
        const items = [
            'Export to DOCX — save Word documents directly from your vault (Pro)',
            'Export to PDF — print-ready PDF export (Pro)',
            'Batch publish — publish an entire folder at once (Pro)',
            'Document themes — 5 style presets: Default, Academic, Business, Minimal, Colorful (Pro)',
            'Table of Contents — auto-generated from headings (Pro)',
            'Custom header/footer — add metadata text to exports (Pro)',
            'Auto-publish on save — re-publish when you edit notes (Premium)',
        ];

        for (const item of items) {
            features.createEl('li', { text: item });
        }

        const freeNote = contentEl.createEl('p');
        freeNote.innerHTML =
            '<b>All existing features remain free.</b> ' +
            'The core Publish to Google Docs functionality is unchanged. ' +
            'Go to <b>Settings → Publish to Google Docs → License</b> to upgrade.';

        const closeBtn = contentEl.createEl('button', { text: 'Got it' });
        closeBtn.addClass('mod-cta');
        closeBtn.style.marginTop = '16px';
        closeBtn.addEventListener('click', () => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
