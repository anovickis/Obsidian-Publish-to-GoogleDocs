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
import { ThemeName } from './types';
import {
    activateLicense,
    deactivateLicense,
    hasFeature,
    getTierDisplayName,
} from './license';
import { getThemeOptions } from './themes';

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
    }

    // ---- Section 7: Setup Instructions ----

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
    }
}
