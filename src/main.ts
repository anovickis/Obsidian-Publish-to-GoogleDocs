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
import { PluginSettings, DEFAULT_SETTINGS } from './types';
import { PublishSettingTab } from './settings';
import { publishNote } from './publisher';
import { exportToDocx, exportToPdf, batchPublishFolder } from './exporters';
import { hasFeature, validateLicense, showUpgradeNotice } from './license';

const PLUGIN_VERSION = '2.0.0';

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
