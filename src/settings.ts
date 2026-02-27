// settings.ts — Plugin settings tab
//
// Provides UI for: Google Cloud credentials (client ID, secret),
// authentication status + sign-in/out, Drive folder target,
// and setup instructions.

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';
import { authenticate } from './auth';

export class PublishSettingTab extends PluginSettingTab {
    plugin: PublishToGoogleDocsPlugin;

    constructor(app: App, plugin: PublishToGoogleDocsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ---- Header ----
        containerEl.createEl('h2', { text: 'Publish to Google Docs' });

        // ---- Google Cloud Credentials ----
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
                // Mask the input like a password field
                text.inputEl.type = 'password';
            });

        // ---- Authentication Status ----
        containerEl.createEl('h3', { text: 'Authentication' });

        const authStatus = this.plugin.settings.refreshToken
            ? `Signed in as: ${this.plugin.settings.userEmail || 'unknown'}`
            : 'Not signed in';

        const authSetting = new Setting(containerEl)
            .setName('Status')
            .setDesc(authStatus);

        if (this.plugin.settings.refreshToken) {
            // Sign out button
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
                        this.display(); // Refresh the settings UI
                    }),
            );
        } else {
            // Sign in button
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
                            this.display(); // Refresh the settings UI
                        } catch (err) {
                            new Notice(`Sign-in failed: ${(err as Error).message}`);
                        }
                    }),
            );
        }

        // ---- Google Drive Options ----
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

        // ---- Setup Instructions ----
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
