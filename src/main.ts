// main.ts — Plugin entry point for "Publish to Google Docs"
//
// Registers the file-menu context menu item and settings tab.
// The actual publish logic lives in publisher.ts.

import {
    Notice,
    Plugin,
    TFile,
    TAbstractFile,
} from 'obsidian';
import { PluginSettings, DEFAULT_SETTINGS } from './types';
import { PublishSettingTab } from './settings';
import { publishNote } from './publisher';

export default class PublishToGoogleDocsPlugin extends Plugin {
    settings: PluginSettings = DEFAULT_SETTINGS;

    async onload(): Promise<void> {
        await this.loadSettings();

        // Register settings tab
        this.addSettingTab(new PublishSettingTab(this.app, this));

        // Register file-menu event: right-click on .md file → "Publish to Google Docs"
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file: TAbstractFile) => {
                // Only show for markdown files
                if (!(file instanceof TFile)) return;
                if (file.extension !== 'md') return;

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
            }),
        );
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
