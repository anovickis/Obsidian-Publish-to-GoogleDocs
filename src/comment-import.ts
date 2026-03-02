// comment-import.ts — Import Google Docs comments back into Obsidian
//
// Fetches comments from a published Google Doc via the Drive Comments API
// and formats them as Obsidian callout blocks appended to the note.

import { Notice, TFile, requestUrl } from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';
import { extractDocId } from './google-api';
import { getValidToken } from './auth';
import { CommentFilter } from './types';
import { DRIVE_FILES_URL } from './types';

// ---- Types ----

interface DocComment {
    id: string;
    content: string;
    author: {
        displayName: string;
    };
    quotedFileContent?: {
        value: string;
    };
    createdTime: string;    // ISO 8601
    resolved: boolean;
    replies?: Array<{
        content: string;
        author: { displayName: string };
        createdTime: string;
    }>;
}

interface CommentsApiResponse {
    comments: DocComment[];
    nextPageToken?: string;
}

// ---- Fetch Comments ----

/**
 * Fetch all comments from a Google Doc.
 */
async function fetchDocComments(
    token: string,
    docId: string,
): Promise<DocComment[]> {
    const allComments: DocComment[] = [];
    let pageToken: string | undefined;

    do {
        const params = new URLSearchParams({
            fields: 'comments(id,content,author/displayName,quotedFileContent/value,createdTime,resolved,replies(content,author/displayName,createdTime)),nextPageToken',
            pageSize: '100',
        });
        if (pageToken) params.set('pageToken', pageToken);

        const response = await requestUrl({
            url: `${DRIVE_FILES_URL}/${docId}/comments?${params.toString()}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        const data: CommentsApiResponse = response.json;
        if (data.comments) {
            allComments.push(...data.comments);
        }
        pageToken = data.nextPageToken;
    } while (pageToken);

    return allComments;
}

// ---- Format as Markdown ----

/**
 * Format comments as Obsidian callout blocks.
 */
function formatCommentsAsMarkdown(
    comments: DocComment[],
    filter: CommentFilter,
): string {
    // Apply filter
    let filtered = comments;
    if (filter === 'unresolved') {
        filtered = comments.filter((c) => !c.resolved);
    } else if (filter === 'resolved') {
        filtered = comments.filter((c) => c.resolved);
    }

    if (filtered.length === 0) return '';

    const parts: string[] = ['\n\n## Google Docs Comments\n'];

    for (const comment of filtered) {
        const date = new Date(comment.createdTime).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });

        const resolvedTag = comment.resolved ? ' [RESOLVED]' : '';
        const header = `${comment.author.displayName} (${date})${resolvedTag}`;

        // Build callout
        const lines: string[] = [];
        lines.push(`> [!comment] ${header}`);

        // Quoted text from the document
        if (comment.quotedFileContent?.value) {
            const quoted = comment.quotedFileContent.value.replace(/\n/g, '\n> > ');
            lines.push(`> > "${quoted}"`);
            lines.push(`>`);
        }

        // Comment text
        const commentText = comment.content.replace(/\n/g, '\n> ');
        lines.push(`> ${commentText}`);

        // Replies
        if (comment.replies && comment.replies.length > 0) {
            lines.push(`>`);
            for (const reply of comment.replies) {
                const replyDate = new Date(reply.createdTime).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                });
                const replyText = reply.content.replace(/\n/g, '\n> ');
                lines.push(`> **${reply.author.displayName}** (${replyDate}): ${replyText}`);
            }
        }

        parts.push(lines.join('\n'));
    }

    return parts.join('\n\n');
}

// ---- Main Import Function ----

/**
 * Import comments from a published Google Doc into the Obsidian note.
 */
export async function importComments(
    plugin: PublishToGoogleDocsPlugin,
    file: TFile,
): Promise<void> {
    // 1. Get the Google Doc URL from frontmatter
    const cache = plugin.app.metadataCache.getFileCache(file);
    const docUrl = cache?.frontmatter?.google_doc;

    if (!docUrl) {
        new Notice('This note has not been published to Google Docs yet.');
        return;
    }

    const docId = extractDocId(docUrl);
    if (!docId) {
        new Notice('Could not extract Google Doc ID from the frontmatter URL.');
        return;
    }

    // 2. Validate credentials
    if (!plugin.settings.clientId || !plugin.settings.clientSecret) {
        new Notice('Please configure Google API credentials first.');
        return;
    }

    const progressNotice = new Notice('Fetching comments from Google Docs...', 0);

    try {
        // 3. Get auth token
        const token = await getValidToken(plugin.settings, () => plugin.saveSettings());

        // 4. Fetch comments
        const comments = await fetchDocComments(token, docId);

        if (comments.length === 0) {
            progressNotice.hide();
            new Notice('No comments found on this Google Doc.');
            return;
        }

        // 5. Format as markdown
        const commentsMarkdown = formatCommentsAsMarkdown(comments, plugin.settings.commentFilter);

        if (!commentsMarkdown) {
            progressNotice.hide();
            const filterNote = plugin.settings.commentFilter === 'unresolved'
                ? ' (all comments are resolved — try changing the comment filter in settings)'
                : '';
            new Notice(`No matching comments found${filterNote}.`);
            return;
        }

        // 6. Check if there's already a Comments section
        const existingContent = await plugin.app.vault.read(file);
        const commentsHeadingRegex = /\n## Google Docs Comments\n[\s\S]*$/;

        let newContent: string;
        if (commentsHeadingRegex.test(existingContent)) {
            // Replace existing comments section
            newContent = existingContent.replace(commentsHeadingRegex, commentsMarkdown);
        } else {
            // Append new comments section
            newContent = existingContent + commentsMarkdown;
        }

        await plugin.app.vault.modify(file, newContent);

        progressNotice.hide();
        const total = comments.length;
        const filtered = plugin.settings.commentFilter === 'all'
            ? total
            : comments.filter((c) =>
                plugin.settings.commentFilter === 'unresolved' ? !c.resolved : c.resolved,
            ).length;

        new Notice(`Imported ${filtered} comment${filtered !== 1 ? 's' : ''} from Google Docs.`, 5000);

    } catch (err) {
        progressNotice.hide();
        console.error('Comment import error:', err);
        new Notice(`Comment import failed: ${(err as Error).message}`);
    }
}
