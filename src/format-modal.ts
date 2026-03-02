// format-modal.ts — Target format selection modal
//
// Shown when the user wants to publish/export for a specific platform.
// Follows the pattern of UpdateChoiceModal in publisher.ts.

import { App, Modal } from 'obsidian';
import { TargetFormat } from './types';

type FormatChoice = TargetFormat | null;

/**
 * Modal that lets the user choose a target platform before publishing.
 */
class FormatSelectionModal extends Modal {
    private resolveFn: (value: FormatChoice) => void;
    private defaultFormat: TargetFormat;

    constructor(app: App, defaultFormat: TargetFormat, resolveFn: (value: FormatChoice) => void) {
        super(app);
        this.defaultFormat = defaultFormat;
        this.resolveFn = resolveFn;
    }

    onOpen(): void {
        const { contentEl } = this;

        contentEl.createEl('h3', { text: 'Choose Target Platform' });
        contentEl.createEl('p', {
            text: 'Select where this note will be published. The formatting and math rendering will be adjusted accordingly.',
        });

        const options: { format: TargetFormat; label: string; desc: string; icon: string }[] = [
            {
                format: 'google-docs',
                label: 'Google Docs',
                desc: 'Upload to Google Drive. LaTeX preserved as text for Auto-LaTeX add-on.',
                icon: 'upload-cloud',
            },
            {
                format: 'medium',
                label: 'Medium',
                desc: 'Copy to clipboard. Math rendered as images. Headers limited to H2.',
                icon: 'clipboard-copy',
            },
            {
                format: 'linkedin',
                label: 'LinkedIn',
                desc: 'Copy to clipboard. Math rendered as images. Minimal formatting.',
                icon: 'clipboard-copy',
            },
        ];

        const buttonContainer = contentEl.createDiv();
        buttonContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px;';

        for (const opt of options) {
            const btn = buttonContainer.createEl('button');
            btn.style.cssText =
                'display:flex;flex-direction:column;align-items:flex-start;padding:12px 16px;' +
                'text-align:left;border:1px solid var(--background-modifier-border);' +
                'border-radius:8px;cursor:pointer;background:var(--background-primary);';

            if (opt.format === this.defaultFormat) {
                btn.style.borderColor = 'var(--interactive-accent)';
                btn.style.borderWidth = '2px';
            }

            const labelEl = btn.createEl('strong', { text: opt.label });
            labelEl.style.cssText = 'font-size:14px;';

            const descEl = btn.createEl('span', { text: opt.desc });
            descEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:4px;';

            btn.addEventListener('click', () => {
                this.resolveFn(opt.format);
                this.close();
            });
        }

        // Cancel
        const cancelBtn = contentEl.createEl('button', { text: 'Cancel' });
        cancelBtn.style.cssText = 'margin-top:12px;';
        cancelBtn.addEventListener('click', () => {
            this.resolveFn(null);
            this.close();
        });
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

/**
 * Show the format selection modal and return the user's choice.
 * Returns null if cancelled.
 */
export function showFormatModal(app: App, defaultFormat: TargetFormat): Promise<FormatChoice> {
    return new Promise((resolve) => {
        new FormatSelectionModal(app, defaultFormat, resolve).open();
    });
}
