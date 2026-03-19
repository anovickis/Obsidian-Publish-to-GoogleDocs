// settings.ts — Plugin settings tab (v2.0.0)
//
// Sectioned layout:
//   1. License — tier badge, key input, activate/deactivate, upgrade links
//   2. Google Cloud Credentials — client ID/secret
//   3. Authentication — sign in/out status
//   4. Google Drive Options — target folder
//   5. Export Options (Pro+) — theme, TOC, header/footer, wikilinks
//   6. Advanced (Premium) — auto-publish
//   7. Setup Instructions — collapsible how-to

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';
import { authenticate } from './auth';
import { ThemeName, TargetFormat, CitationStyle, JournalTemplateName } from './types';
import {
    activateLicense,
    deactivateLicense,
    hasFeature,
    getTierDisplayName,
} from './license';
import { getThemeOptions } from './themes';
import { loadHistory, clearHistory, formatEvent, PublishEvent } from './history';
import { getJournalTemplateOptions } from './journal-templates';

export class PublishSettingTab extends PluginSettingTab {
    plugin: PublishToGoogleDocsPlugin;

    constructor(app: App, plugin: PublishToGoogleDocsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Publish to Google Docs' });

        this.renderLicenseSection(containerEl);
        this.renderCredentialsSection(containerEl);
        this.renderAuthSection(containerEl);
        this.renderDriveSection(containerEl);
        this.renderExportSection(containerEl);
        this.renderAdvancedSection(containerEl);
        this.renderHistorySection(containerEl);
        this.renderSetupSection(containerEl);
    }

    // ---- Section 1: License ----

    private renderLicenseSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'License' });

        // Tier status badge
        const tierName = getTierDisplayName(this.plugin.settings);
        const tierSetting = new Setting(containerEl)
            .setName('Current plan')
            .setDesc(tierName);

        // Style the badge
        const badge = tierSetting.descEl.createSpan();
        badge.textContent = ` ${this.plugin.settings.licenseType.toUpperCase()}`;
        badge.style.cssText = this.plugin.settings.licenseType === 'free'
            ? 'background:#e0e0e0;color:#333;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:8px;'
            : 'background:#448aff;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold;margin-left:8px;';

        // License key input + activate button
        if (this.plugin.settings.licenseType === 'free') {
            new Setting(containerEl)
                .setName('License key')
                .setDesc('Enter your Gumroad license key to unlock Pro or Premium features.')
                .addText((text) => {
                    text
                        .setPlaceholder('XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX')
                        .setValue(this.plugin.settings.licenseKey)
                        .onChange((value) => {
                            // Just store locally, don't validate on every keystroke
                            this.plugin.settings.licenseKey = value.trim();
                        });
                    text.inputEl.style.width = '300px';
                })
                .addButton((btn) =>
                    btn
                        .setButtonText('Activate')
                        .setCta()
                        .onClick(async () => {
                            const key = this.plugin.settings.licenseKey;
                            if (!key) {
                                new Notice('Please enter a license key first.');
                                return;
                            }
                            try {
                                btn.setDisabled(true);
                                btn.setButtonText('Validating...');
                                const result = await activateLicense(
                                    key, this.plugin.settings, () => this.plugin.saveSettings(),
                                );
                                if (result.tier === 'free') {
                                    new Notice('Invalid or expired license key. Please check and try again.');
                                } else {
                                    const expiryNote = result.expiresAt
                                        ? ` (expires ${new Date(result.expiresAt).toLocaleDateString()})`
                                        : '';
                                    new Notice(`License activated! Plan: ${result.tier.toUpperCase()}${expiryNote}`);
                                }
                                this.display(); // Refresh UI
                            } catch (err) {
                                new Notice(`Activation failed: ${(err as Error).message}`);
                                btn.setDisabled(false);
                                btn.setButtonText('Activate');
                            }
                        }),
                );

            // Upgrade links
            const upgradeDiv = containerEl.createDiv();
            upgradeDiv.style.cssText = 'margin:8px 0 16px 0;display:flex;gap:12px;';

            const proLink = upgradeDiv.createEl('a', {
                text: 'Get Pro ($20 lifetime)',
                href: 'https://anovickis.gumroad.com/l/publish-gdocs-pro',
            });
            proLink.style.cssText =
                'background:#448aff;color:#fff;padding:8px 16px;border-radius:6px;' +
                'text-decoration:none;font-size:13px;font-weight:bold;';

            const premiumLink = upgradeDiv.createEl('a', {
                text: 'Get Premium ($5/mo)',
                href: 'https://anovickis.gumroad.com/l/publish-gdocs-premium',
            });
            premiumLink.style.cssText =
                'background:#7c4dff;color:#fff;padding:8px 16px;border-radius:6px;' +
                'text-decoration:none;font-size:13px;font-weight:bold;';

        } else {
            // Licensed — show email and deactivate button
            if (this.plugin.settings.licenseEmail) {
                new Setting(containerEl)
                    .setName('Licensed to')
                    .setDesc(this.plugin.settings.licenseEmail);
            }

            new Setting(containerEl)
                .setName('License key')
                .setDesc(this.plugin.settings.licenseKey.slice(0, 8) + '...')
                .addButton((btn) =>
                    btn
                        .setButtonText('Deactivate')
                        .setWarning()
                        .onClick(async () => {
                            await deactivateLicense(
                                this.plugin.settings, () => this.plugin.saveSettings(),
                            );
                            new Notice('License deactivated. Downgraded to Free.');
                            this.display();
                        }),
                );
        }
    }

    // ---- Section 2: Google Cloud Credentials ----

    private renderCredentialsSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Google Cloud Credentials' });
        containerEl.createEl('p', {
            text: 'You need your own Google Cloud project with OAuth credentials. See setup instructions below.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Client ID')
            .setDesc('From Google Cloud Console → APIs & Services → Credentials')
            .addText((text) =>
                text
                    .setPlaceholder('xxxx.apps.googleusercontent.com')
                    .setValue(this.plugin.settings.clientId)
                    .onChange(async (value) => {
                        this.plugin.settings.clientId = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );

        new Setting(containerEl)
            .setName('Client Secret')
            .setDesc('Keep this private — stored locally in your vault')
            .addText((text) => {
                text
                    .setPlaceholder('GOCSPX-...')
                    .setValue(this.plugin.settings.clientSecret)
                    .onChange(async (value) => {
                        this.plugin.settings.clientSecret = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });
    }

    // ---- Section 3: Authentication ----

    private renderAuthSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Authentication' });

        const authStatus = this.plugin.settings.refreshToken
            ? `Signed in as: ${this.plugin.settings.userEmail || 'unknown'}`
            : 'Not signed in';

        const authSetting = new Setting(containerEl)
            .setName('Status')
            .setDesc(authStatus);

        if (this.plugin.settings.refreshToken) {
            authSetting.addButton((btn) =>
                btn
                    .setButtonText('Sign out')
                    .onClick(async () => {
                        this.plugin.settings.accessToken = '';
                        this.plugin.settings.refreshToken = '';
                        this.plugin.settings.tokenExpiry = 0;
                        this.plugin.settings.userEmail = '';
                        await this.plugin.saveSettings();
                        new Notice('Signed out of Google.');
                        this.display();
                    }),
            );
        } else {
            authSetting.addButton((btn) =>
                btn
                    .setButtonText('Sign in with Google')
                    .setCta()
                    .onClick(async () => {
                        if (!this.plugin.settings.clientId || !this.plugin.settings.clientSecret) {
                            new Notice('Please enter your Client ID and Client Secret first.');
                            return;
                        }
                        try {
                            const result = await authenticate(this.plugin.settings);
                            this.plugin.settings.accessToken = result.accessToken;
                            this.plugin.settings.refreshToken = result.refreshToken;
                            this.plugin.settings.tokenExpiry = result.tokenExpiry;
                            this.plugin.settings.userEmail = result.userEmail;
                            await this.plugin.saveSettings();
                            new Notice(`Signed in as ${result.userEmail}`);
                            this.display();
                        } catch (err) {
                            new Notice(`Sign-in failed: ${(err as Error).message}`);
                        }
                    }),
            );
        }
    }

    // ---- Section 4: Google Drive Options ----

    private renderDriveSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Google Drive Options' });

        new Setting(containerEl)
            .setName('Target Folder ID')
            .setDesc(
                'Optional. ID of the Google Drive folder where new docs are created. ' +
                'Leave blank for the root of My Drive. ' +
                'Find the ID in the folder URL: drive.google.com/drive/folders/THIS_PART',
            )
            .addText((text) =>
                text
                    .setPlaceholder('1a2b3c4d5e...')
                    .setValue(this.plugin.settings.defaultFolderId)
                    .onChange(async (value) => {
                        this.plugin.settings.defaultFolderId = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );
    }

    // ---- Section 5: Export Options (Pro+) ----

    private renderExportSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Export Options' });

        const isPro = hasFeature(this.plugin.settings, 'custom-themes');

        if (!isPro) {
            const lockNote = containerEl.createEl('p');
            lockNote.style.cssText = 'color:#888;font-style:italic;font-size:13px;';
            lockNote.textContent = 'These options require a Pro or Premium license.';
        }

        // Theme dropdown
        const themeSetting = new Setting(containerEl)
            .setName('Document theme')
            .setDesc('Visual style applied to exported documents');

        if (isPro) {
            themeSetting.addDropdown((dropdown) => {
                const options = getThemeOptions();
                for (const opt of options) {
                    dropdown.addOption(opt.value, `${opt.label} — ${opt.description}`);
                }
                dropdown.setValue(this.plugin.settings.theme);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.theme = value as ThemeName;
                    await this.plugin.saveSettings();
                });
            });
        } else {
            themeSetting.setDisabled(true);
            themeSetting.descEl.textContent += ' (Pro)';
        }

        // TOC toggle
        const tocSetting = new Setting(containerEl)
            .setName('Include Table of Contents')
            .setDesc('Auto-generate a TOC from headings at the top of the document');

        if (isPro) {
            tocSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.includeToc)
                    .onChange(async (value) => {
                        this.plugin.settings.includeToc = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            tocSetting.setDisabled(true);
            tocSetting.descEl.textContent += ' (Pro)';
        }

        // Header text
        const headerSetting = new Setting(containerEl)
            .setName('Custom header text')
            .setDesc('Text shown above the document title');

        if (isPro) {
            headerSetting.addText((text) =>
                text
                    .setPlaceholder('e.g., CONFIDENTIAL')
                    .setValue(this.plugin.settings.customHeaderText)
                    .onChange(async (value) => {
                        this.plugin.settings.customHeaderText = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            headerSetting.setDisabled(true);
            headerSetting.descEl.textContent += ' (Pro)';
        }

        // Footer text
        const footerSetting = new Setting(containerEl)
            .setName('Custom footer text')
            .setDesc('Text shown at the bottom of the document');

        if (isPro) {
            footerSetting.addText((text) =>
                text
                    .setPlaceholder('e.g., Generated from Obsidian')
                    .setValue(this.plugin.settings.customFooterText)
                    .onChange(async (value) => {
                        this.plugin.settings.customFooterText = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            footerSetting.setDisabled(true);
            footerSetting.descEl.textContent += ' (Pro)';
        }

        // Default target format
        const formatSetting = new Setting(containerEl)
            .setName('Default target platform')
            .setDesc('Platform to format for when using "Copy for..." menu items');

        if (isPro) {
            formatSetting.addDropdown((dropdown) => {
                dropdown.addOption('google-docs', 'Google Docs — LaTeX as text (Auto-LaTeX add-on)');
                dropdown.addOption('medium', 'Medium — math as images, simplified HTML');
                dropdown.addOption('linkedin', 'LinkedIn — math as images, minimal HTML');
                dropdown.setValue(this.plugin.settings.defaultTargetFormat);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.defaultTargetFormat = value as TargetFormat;
                    await this.plugin.saveSettings();
                });
            });
        } else {
            formatSetting.setDisabled(true);
            formatSetting.descEl.textContent += ' (Pro)';
        }

        // Resolve embeds
        const embedSetting = new Setting(containerEl)
            .setName('Resolve embeds')
            .setDesc('Inline ![[note]] transclusions (including #section and ^block references)');

        if (isPro) {
            embedSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.resolveEmbeds)
                    .onChange(async (value) => {
                        this.plugin.settings.resolveEmbeds = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            embedSetting.setDisabled(true);
            embedSetting.descEl.textContent += ' (Pro)';
        }

        // Render Mermaid diagrams
        const mermaidSetting = new Setting(containerEl)
            .setName('Render Mermaid diagrams')
            .setDesc('Convert ```mermaid code blocks to PNG images in the export');

        if (isPro) {
            mermaidSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.renderMermaid)
                    .onChange(async (value) => {
                        this.plugin.settings.renderMermaid = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            mermaidSetting.setDisabled(true);
            mermaidSetting.descEl.textContent += ' (Pro)';
        }

        // Handle footnotes
        const footnoteSetting = new Setting(containerEl)
            .setName('Handle footnotes')
            .setDesc('Convert [^id] footnotes to numbered endnotes with a Notes section');

        if (isPro) {
            footnoteSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.handleFootnotes)
                    .onChange(async (value) => {
                        this.plugin.settings.handleFootnotes = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            footnoteSetting.setDisabled(true);
            footnoteSetting.descEl.textContent += ' (Pro)';
        }

        // Auto-number figures and tables
        const numberingSetting = new Setting(containerEl)
            .setName('Auto-number figures & tables')
            .setDesc('Add sequential Figure N / Table N labels to images and tables');

        if (isPro) {
            numberingSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoNumberFigures)
                    .onChange(async (value) => {
                        this.plugin.settings.autoNumberFigures = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            numberingSetting.setDisabled(true);
            numberingSetting.descEl.textContent += ' (Pro)';
        }

        // Resolve wikilinks to hyperlinks
        const wikilinkSetting = new Setting(containerEl)
            .setName('Resolve wikilinks')
            .setDesc('Convert [[links]] to clickable Google Docs hyperlinks (if the linked note has been published)');

        if (isPro) {
            wikilinkSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.resolveWikilinks)
                    .onChange(async (value) => {
                        this.plugin.settings.resolveWikilinks = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            wikilinkSetting.setDisabled(true);
            wikilinkSetting.descEl.textContent += ' (Pro)';
        }

        // Syntax highlighting
        const syntaxSetting = new Setting(containerEl)
            .setName('Syntax highlighting')
            .setDesc('Add colored syntax highlighting to code blocks in exports');

        if (isPro) {
            syntaxSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.syntaxHighlighting)
                    .onChange(async (value) => {
                        this.plugin.settings.syntaxHighlighting = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            syntaxSetting.setDisabled(true);
            syntaxSetting.descEl.textContent += ' (Pro)';
        }

        // Custom CSS
        const cssSetting = new Setting(containerEl)
            .setName('Custom CSS')
            .setDesc('Custom CSS rules injected into exported documents (overrides theme styles)');

        if (isPro) {
            cssSetting.addTextArea((text) => {
                text
                    .setPlaceholder('body { font-size: 16px; }\nh1 { color: #333; }')
                    .setValue(this.plugin.settings.customCss)
                    .onChange(async (value) => {
                        this.plugin.settings.customCss = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.rows = 6;
                text.inputEl.style.width = '100%';
                text.inputEl.style.fontFamily = 'monospace';
                text.inputEl.style.fontSize = '12px';
            });
        } else {
            cssSetting.setDisabled(true);
            cssSetting.descEl.textContent += ' (Pro)';
        }

        // ---- Citations & Bibliography ----
        containerEl.createEl('h4', { text: 'Citations & Bibliography' });

        // BibTeX file path
        const bibSetting = new Setting(containerEl)
            .setName('BibTeX file')
            .setDesc('Vault-relative path to your .bib file (e.g., references.bib)');

        if (isPro) {
            bibSetting.addText((text) =>
                text
                    .setPlaceholder('path/to/references.bib')
                    .setValue(this.plugin.settings.bibFilePath)
                    .onChange(async (value) => {
                        this.plugin.settings.bibFilePath = value.trim();
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            bibSetting.setDisabled(true);
            bibSetting.descEl.textContent += ' (Pro)';
        }

        // Citation style
        const citStyleSetting = new Setting(containerEl)
            .setName('Citation style')
            .setDesc('How [@citekey] citations are formatted in the output');

        if (isPro) {
            citStyleSetting.addDropdown((dropdown) => {
                dropdown.addOption('numbered', 'Numbered — [1], [2]');
                dropdown.addOption('author-year', 'Author-Year — Smith (2024)');
                dropdown.addOption('author-year-paren', 'Author-Year (parenthetical) — (Smith, 2024)');
                dropdown.setValue(this.plugin.settings.citationStyle);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.citationStyle = value as CitationStyle;
                    await this.plugin.saveSettings();
                });
            });
        } else {
            citStyleSetting.setDisabled(true);
            citStyleSetting.descEl.textContent += ' (Pro)';
        }

        // Cross-references
        const xrefSetting = new Setting(containerEl)
            .setName('Resolve cross-references')
            .setDesc('Convert @fig:label, @tab:label, @eq:label to numbered links (requires auto-numbering)');

        if (isPro) {
            xrefSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.resolveCrossRefs)
                    .onChange(async (value) => {
                        this.plugin.settings.resolveCrossRefs = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            xrefSetting.setDisabled(true);
            xrefSetting.descEl.textContent += ' (Pro)';
        }

        // ---- Math Rendering ----
        containerEl.createEl('h4', { text: 'Math Rendering' });

        // Math as images (free tier)
        new Setting(containerEl)
            .setName('Render math as images')
            .setDesc('Render LaTeX equations as PNG images instead of text delimiters (eliminates need for Auto-LaTeX Equations add-on)')
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.mathAsImages)
                    .onChange(async (value) => {
                        this.plugin.settings.mathAsImages = value;
                        await this.plugin.saveSettings();
                    }),
            );

        // ---- Journal Templates ----
        containerEl.createEl('h4', { text: 'Journal Templates' });

        const journalSetting = new Setting(containerEl)
            .setName('Journal template')
            .setDesc('Apply academic journal formatting (overrides some theme settings)');

        if (isPro) {
            journalSetting.addDropdown((dropdown) => {
                const options = getJournalTemplateOptions();
                for (const opt of options) {
                    dropdown.addOption(opt.value, `${opt.label} — ${opt.description}`);
                }
                dropdown.setValue(this.plugin.settings.journalTemplate);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.journalTemplate = value as JournalTemplateName;
                    await this.plugin.saveSettings();
                });
            });
        } else {
            journalSetting.setDisabled(true);
            journalSetting.descEl.textContent += ' (Pro)';
        }

        // ---- Image Optimization ----
        containerEl.createEl('h4', { text: 'Image Optimization' });

        const imgOptSetting = new Setting(containerEl)
            .setName('Optimize images')
            .setDesc('Compress and resize images before upload to reduce file size');

        if (isPro) {
            imgOptSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.optimizeImages)
                    .onChange(async (value) => {
                        this.plugin.settings.optimizeImages = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            imgOptSetting.setDisabled(true);
            imgOptSetting.descEl.textContent += ' (Pro)';
        }

        const maxWidthSetting = new Setting(containerEl)
            .setName('Max image width (px)')
            .setDesc('Images wider than this are scaled down proportionally');

        if (isPro) {
            maxWidthSetting.addText((text) => {
                text
                    .setPlaceholder('1200')
                    .setValue(String(this.plugin.settings.maxImageWidth))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 0) {
                            this.plugin.settings.maxImageWidth = num;
                            await this.plugin.saveSettings();
                        }
                    });
                text.inputEl.type = 'number';
                text.inputEl.style.width = '80px';
            });
        } else {
            maxWidthSetting.setDisabled(true);
            maxWidthSetting.descEl.textContent += ' (Pro)';
        }

        const qualitySetting = new Setting(containerEl)
            .setName('JPEG quality')
            .setDesc('Compression quality for JPEG images (0.1 = smallest, 1.0 = best quality)');

        if (isPro) {
            qualitySetting.addText((text) => {
                text
                    .setPlaceholder('0.85')
                    .setValue(String(this.plugin.settings.imageQuality))
                    .onChange(async (value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num) && num >= 0.1 && num <= 1.0) {
                            this.plugin.settings.imageQuality = num;
                            await this.plugin.saveSettings();
                        }
                    });
                text.inputEl.type = 'number';
                text.inputEl.step = '0.05';
                text.inputEl.min = '0.1';
                text.inputEl.max = '1.0';
                text.inputEl.style.width = '80px';
            });
        } else {
            qualitySetting.setDisabled(true);
            qualitySetting.descEl.textContent += ' (Pro)';
        }

        // ---- Watermark ----
        containerEl.createEl('h4', { text: 'Watermark' });

        const watermarkSetting = new Setting(containerEl)
            .setName('Watermark text')
            .setDesc('Diagonal text overlay on exports (e.g., DRAFT, CONFIDENTIAL). Leave empty to disable.');

        if (isPro) {
            watermarkSetting.addText((text) =>
                text
                    .setPlaceholder('e.g., DRAFT')
                    .setValue(this.plugin.settings.watermarkText)
                    .onChange(async (value) => {
                        this.plugin.settings.watermarkText = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            watermarkSetting.setDisabled(true);
            watermarkSetting.descEl.textContent += ' (Pro)';
        }

        const opacitySetting = new Setting(containerEl)
            .setName('Watermark opacity')
            .setDesc('Transparency of the watermark (0.01 = barely visible, 0.2 = prominent)');

        if (isPro) {
            opacitySetting.addText((text) => {
                text
                    .setPlaceholder('0.06')
                    .setValue(String(this.plugin.settings.watermarkOpacity))
                    .onChange(async (value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num) && num >= 0.01 && num <= 0.2) {
                            this.plugin.settings.watermarkOpacity = num;
                            await this.plugin.saveSettings();
                        }
                    });
                text.inputEl.type = 'number';
                text.inputEl.step = '0.01';
                text.inputEl.min = '0.01';
                text.inputEl.max = '0.2';
                text.inputEl.style.width = '80px';
            });
        } else {
            opacitySetting.setDisabled(true);
            opacitySetting.descEl.textContent += ' (Pro)';
        }
    }

    // ---- Section 6: Advanced (Premium) ----

    private renderAdvancedSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Advanced' });

        const isPremium = hasFeature(this.plugin.settings, 'auto-publish');

        if (!isPremium) {
            const lockNote = containerEl.createEl('p');
            lockNote.style.cssText = 'color:#888;font-style:italic;font-size:13px;';
            lockNote.textContent = 'These options require a Premium license.';
        }

        const autoSetting = new Setting(containerEl)
            .setName('Auto-publish on save')
            .setDesc('Automatically re-publish notes to Google Docs when you save them');

        if (isPremium) {
            autoSetting.addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoPublishOnSave)
                    .onChange(async (value) => {
                        this.plugin.settings.autoPublishOnSave = value;
                        await this.plugin.saveSettings();
                    }),
            );
        } else {
            autoSetting.setDisabled(true);
            autoSetting.descEl.textContent += ' (Premium)';
        }

        // Comment import filter
        const commentSetting = new Setting(containerEl)
            .setName('Comment import filter')
            .setDesc('Which Google Docs comments to import when using "Import Comments"');

        if (isPremium) {
            commentSetting.addDropdown((dropdown) => {
                dropdown.addOption('unresolved', 'Unresolved only');
                dropdown.addOption('all', 'All comments');
                dropdown.addOption('resolved', 'Resolved only');
                dropdown.setValue(this.plugin.settings.commentFilter);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.commentFilter = value as 'all' | 'unresolved' | 'resolved';
                    await this.plugin.saveSettings();
                });
            });
        } else {
            commentSetting.setDisabled(true);
            commentSetting.descEl.textContent += ' (Premium)';
        }
    }

    // ---- Section 7: Publish History (Premium) ----

    private renderHistorySection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Publish History' });

        const isPremium = hasFeature(this.plugin.settings, 'history');

        if (!isPremium) {
            const lockNote = containerEl.createEl('p');
            lockNote.style.cssText = 'color:#888;font-style:italic;font-size:13px;';
            lockNote.textContent = 'Publish history requires a Premium license.';
            return;
        }

        // Load history asynchronously and render
        const historyContainer = containerEl.createDiv();
        historyContainer.style.cssText = 'margin:8px 0;';

        loadHistory(this.plugin).then((events) => {
            if (events.length === 0) {
                historyContainer.createEl('p', {
                    text: 'No publish history yet.',
                }).style.cssText = 'color:#888;font-style:italic;font-size:13px;';
                return;
            }

            // Show last 10 events
            const list = historyContainer.createEl('div');
            list.style.cssText = 'max-height:200px;overflow-y:auto;font-size:13px;';

            const displayEvents = events.slice(0, 10);
            for (const event of displayEvents) {
                const row = list.createEl('div');
                row.style.cssText = 'padding:4px 0;border-bottom:1px solid #eee;display:flex;align-items:center;gap:8px;';

                const statusDot = row.createSpan();
                statusDot.style.cssText = `width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${event.success ? '#00c853' : '#ff5252'};`;

                const text = row.createSpan();
                text.textContent = formatEvent(event);
                text.style.cssText = 'flex:1;';

                if (event.url) {
                    const link = row.createEl('a', { text: 'Open' });
                    link.href = event.url;
                    link.style.cssText = 'color:#448aff;font-size:12px;text-decoration:none;';
                    link.addEventListener('click', (e) => {
                        e.preventDefault();
                        window.open(event.url);
                    });
                }
            }

            if (events.length > 10) {
                const moreNote = historyContainer.createEl('p');
                moreNote.textContent = `...and ${events.length - 10} more events`;
                moreNote.style.cssText = 'color:#888;font-size:12px;margin-top:4px;';
            }

            // Clear history button
            new Setting(historyContainer)
                .setName('')
                .addButton((btn) =>
                    btn
                        .setButtonText('Clear history')
                        .setWarning()
                        .onClick(async () => {
                            await clearHistory(this.plugin);
                            new Notice('Publish history cleared.');
                            this.display();
                        }),
                );
        });
    }

    // ---- Section 8: Setup Instructions ----

    private renderSetupSection(containerEl: HTMLElement): void {
        containerEl.createEl('h3', { text: 'Setup Instructions' });

        const details = containerEl.createEl('details');
        details.createEl('summary', { text: 'How to create Google Cloud OAuth credentials' });

        const steps = details.createEl('ol');
        const instructions = [
            'Go to <a href="https://console.cloud.google.com">console.cloud.google.com</a>',
            'Create a new project (or select an existing one)',
            'Navigate to <b>APIs & Services → Library</b>',
            'Search for and enable the <b>Google Drive API</b>',
            'Navigate to <b>APIs & Services → Credentials</b>',
            'Click <b>Create Credentials → OAuth client ID</b>',
            'Choose application type: <b>Desktop app</b>',
            'Give it a name (e.g., "Obsidian Publish")',
            'Click <b>Create</b>',
            'Copy the <b>Client ID</b> and <b>Client Secret</b> into the fields above',
            'You may need to configure the <b>OAuth consent screen</b> first (choose "External" type, add yourself as a test user)',
        ];

        for (const instruction of instructions) {
            const li = steps.createEl('li');
            li.innerHTML = instruction;
        }

        const securityNote = details.createEl('p');
        securityNote.innerHTML =
            '<b>Security note:</b> Your credentials are stored locally in ' +
            '<code>.obsidian/plugins/publish-to-google-docs/data.json</code>. ' +
            'If your vault syncs via cloud storage (OneDrive, Dropbox, etc.), ' +
            'this file will be synced too. The plugin only requests the narrowest ' +
            'possible scope (<code>drive.file</code>) which limits access to files ' +
            'created by this plugin.';

        // ---- Pandoc / LaTeX setup (for DOCX & PDF export) ----
        const pandocDetails = containerEl.createEl('details');
        pandocDetails.createEl('summary', {
            text: 'DOCX & PDF export — required tools (pandoc, LaTeX)',
        });

        const pandocIntro = pandocDetails.createEl('p');
        pandocIntro.innerHTML =
            'DOCX and PDF export use <b>pandoc</b> for high-quality output with ' +
            '<b>native Word equations</b> (DOCX) and <b>LaTeX-typeset math</b> (PDF). ' +
            'If pandoc is not installed, the plugin falls back to an HTML-based ' +
            'converter (lower quality, math rendered as images).';

        const pandocSteps = pandocDetails.createEl('ol');
        const pandocInstructions = [
            '<b>Pandoc</b> (required for DOCX & PDF):<br>' +
            '<a href="https://pandoc.org/installing.html">pandoc.org/installing.html</a><br>' +
            'Windows: <code>winget install JohnMacFarlane.Pandoc</code> or download the .msi installer.<br>' +
            'macOS: <code>brew install pandoc</code><br>' +
            'Linux: <code>sudo apt install pandoc</code> (or your distro\'s package manager)',

            '<b>LaTeX engine</b> (required for PDF export only — DOCX works without it):<br>' +
            '<a href="https://miktex.org/download">miktex.org/download</a> (Windows, recommended) or ' +
            '<a href="https://tug.org/texlive/">tug.org/texlive</a> (all platforms)<br>' +
            'Windows: <code>winget install MiKTeX.MiKTeX</code><br>' +
            'macOS: <code>brew install --cask mactex-no-gui</code><br>' +
            'Linux: <code>sudo apt install texlive-xetex</code><br>' +
            'The plugin uses <b>XeLaTeX</b> (included with MiKTeX and TeX Live) for full Unicode and font support.',

            '<b>Verify installation</b> — open a terminal and run:<br>' +
            '<code>pandoc --version</code> (should show 3.x+)<br>' +
            '<code>xelatex --version</code> (should show XeTeX/MiKTeX or TeX Live)<br>' +
            'If the commands are not found, restart your terminal or add them to your system PATH.',
        ];

        for (const step of pandocInstructions) {
            const li = pandocSteps.createEl('li');
            li.innerHTML = step;
            li.style.marginBottom = '12px';
        }

        const pandocNote = pandocDetails.createEl('p');
        pandocNote.innerHTML =
            '<b>Tip:</b> You can place a <code>reference.docx</code> file in your vault root ' +
            'to customize Word styling (fonts, heading styles, margins). Generate one with ' +
            '<code>pandoc -o reference.docx --print-default-data-file reference.docx</code>, ' +
            'then edit the styles in Word.';

        // ---- Google Docs math (Auto-LaTeX add-on) ----
        const latexDetails = containerEl.createEl('details');
        latexDetails.createEl('summary', {
            text: 'Google Docs — rendering LaTeX equations',
        });

        const latexIntro = latexDetails.createEl('p');
        latexIntro.innerHTML =
            'When publishing to Google Docs, LaTeX math is inserted as <code>$$...$$</code> text. ' +
            'To render these as formatted equations, install the ' +
            '<b>Auto-LaTeX Equations</b> add-on in Google Docs:';

        const latexSteps = latexDetails.createEl('ol');
        const latexInstructions = [
            'Open a Google Doc',
            'Go to <b>Extensions → Add-ons → Get add-ons</b>',
            'Search for <b>"Auto-LaTeX Equations"</b>',
            'Install it and grant permissions',
            'After publishing, go to <b>Extensions → Auto-LaTeX Equations → Start</b>',
            'Click <b>Render Equations</b> — all <code>$$...$$</code> blocks will be converted to equation images',
        ];

        for (const step of latexInstructions) {
            latexSteps.createEl('li').innerHTML = step;
        }
    }
}
