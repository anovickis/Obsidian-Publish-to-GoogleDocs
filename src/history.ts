// history.ts — Publish history tracking
//
// Records each publish event (Google Docs, Medium, LinkedIn, DOCX, PDF)
// and stores them in plugin data. Provides a UI section in settings
// showing recent activity with clickable links.
//
// History is stored separately from plugin settings to avoid bloating
// the settings object. Limited to the most recent MAX_HISTORY entries.

import type PublishToGoogleDocsPlugin from './main';

const MAX_HISTORY = 50;

// ---- Types ----

export interface PublishEvent {
    timestamp: number;         // epoch ms
    filePath: string;          // vault-relative path of the source file
    fileName: string;          // display name (basename)
    format: string;            // 'google-docs' | 'medium' | 'linkedin' | 'docx' | 'pdf'
    success: boolean;          // whether the publish succeeded
    url?: string;              // Google Doc URL (if applicable)
    error?: string;            // error message (if failed)
}

interface HistoryData {
    events: PublishEvent[];
}

// ---- Storage ----

const HISTORY_KEY = 'publish-history';

/**
 * Load publish history from plugin storage.
 */
export async function loadHistory(plugin: PublishToGoogleDocsPlugin): Promise<PublishEvent[]> {
    const data = await plugin.loadData();
    const history: HistoryData = data?.[HISTORY_KEY] || { events: [] };
    return history.events;
}

/**
 * Save publish history to plugin storage.
 */
async function saveHistory(plugin: PublishToGoogleDocsPlugin, events: PublishEvent[]): Promise<void> {
    const data = (await plugin.loadData()) || {};
    data[HISTORY_KEY] = { events: events.slice(0, MAX_HISTORY) };
    await plugin.saveData(data);
}

/**
 * Record a new publish event.
 */
export async function recordPublishEvent(
    plugin: PublishToGoogleDocsPlugin,
    event: Omit<PublishEvent, 'timestamp'>,
): Promise<void> {
    const events = await loadHistory(plugin);
    events.unshift({
        ...event,
        timestamp: Date.now(),
    });

    // Trim to max size
    if (events.length > MAX_HISTORY) {
        events.splice(MAX_HISTORY);
    }

    await saveHistory(plugin, events);
}

/**
 * Clear all publish history.
 */
export async function clearHistory(plugin: PublishToGoogleDocsPlugin): Promise<void> {
    await saveHistory(plugin, []);
}

/**
 * Get a human-readable summary of a publish event.
 */
export function formatEvent(event: PublishEvent): string {
    const date = new Date(event.timestamp);
    const dateStr = date.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const formatLabel: Record<string, string> = {
        'google-docs': 'Google Docs',
        'medium': 'Medium',
        'linkedin': 'LinkedIn',
        'docx': 'DOCX',
        'pdf': 'PDF',
    };

    const platform = formatLabel[event.format] || event.format;
    const status = event.success ? 'OK' : 'FAILED';

    return `${dateStr} — ${event.fileName} → ${platform} [${status}]`;
}

/**
 * Get a formatted label for the publish format.
 */
export function getFormatLabel(format: string): string {
    const labels: Record<string, string> = {
        'google-docs': 'Google Docs',
        'medium': 'Medium',
        'linkedin': 'LinkedIn',
        'docx': 'DOCX',
        'pdf': 'PDF',
    };
    return labels[format] || format;
}
