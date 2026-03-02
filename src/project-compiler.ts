// project-compiler.ts — Multi-file project compilation
//
// Reads a YAML manifest from the master file's frontmatter and
// concatenates multiple markdown files into a single document.
// Uses the convertNoteToHtml pipeline for the final output.

import { App, TFile, Notice } from 'obsidian';
import type PublishToGoogleDocsPlugin from './main';

// ---- Types ----

interface ProjectManifest {
    sections: string[];        // list of markdown file paths (vault-relative or folder-relative)
    appendices?: string[];     // optional appendix files
    bibliography?: string;     // optional .bib file path
}

// ---- Manifest Extraction ----

/**
 * Extract publish_project manifest from a file's frontmatter.
 * Returns null if no manifest is found.
 */
export function extractManifest(app: App, file: TFile): ProjectManifest | null {
    const cache = app.metadataCache.getFileCache(file);
    if (!cache?.frontmatter?.publish_project) return null;

    const raw = cache.frontmatter.publish_project;

    // Validate structure
    if (!raw.sections || !Array.isArray(raw.sections) || raw.sections.length === 0) {
        return null;
    }

    return {
        sections: raw.sections.map(String),
        appendices: raw.appendices ? raw.appendices.map(String) : undefined,
        bibliography: raw.bibliography ? String(raw.bibliography) : undefined,
    };
}

// ---- File Resolution ----

/**
 * Resolve a file path relative to the master file's folder.
 * Tries exact path first, then relative to the master file's parent folder.
 */
function resolveFilePath(app: App, masterFile: TFile, path: string): TFile | null {
    // Try exact vault path
    const exact = app.vault.getAbstractFileByPath(path);
    if (exact instanceof TFile) return exact;

    // Try relative to master file's folder
    const parentPath = masterFile.parent?.path || '';
    const relativePath = parentPath ? `${parentPath}/${path}` : path;
    const relative = app.vault.getAbstractFileByPath(relativePath);
    if (relative instanceof TFile) return relative;

    // Try with .md extension
    const withExt = path.endsWith('.md') ? path : `${path}.md`;
    const withExtFile = app.vault.getAbstractFileByPath(withExt);
    if (withExtFile instanceof TFile) return withExtFile;

    const relativeWithExt = parentPath ? `${parentPath}/${withExt}` : withExt;
    const relativeWithExtFile = app.vault.getAbstractFileByPath(relativeWithExt);
    if (relativeWithExtFile instanceof TFile) return relativeWithExtFile;

    return null;
}

// ---- Frontmatter Stripping ----

function stripFrontmatter(markdown: string): string {
    const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return match ? markdown.slice(match[0].length) : markdown;
}

// ---- Project Compilation ----

/**
 * Compile a multi-file project into a single markdown string.
 *
 * 1. Reads the master file and strips its frontmatter
 * 2. For each section in the manifest, reads and appends the file's content
 * 3. For appendices, adds an "Appendix" prefix to the first heading
 * 4. Returns the combined markdown ready for convertNoteToHtml
 *
 * @returns combined markdown string, or null if compilation fails
 */
export async function compileProject(
    app: App,
    masterFile: TFile,
): Promise<{ markdown: string; bibPath: string | undefined } | null> {
    const manifest = extractManifest(app, masterFile);
    if (!manifest) {
        new Notice('No publish_project manifest found in frontmatter.');
        return null;
    }

    const parts: string[] = [];
    const errors: string[] = [];

    // Master file content (stripped of frontmatter)
    const masterContent = await app.vault.read(masterFile);
    const masterBody = stripFrontmatter(masterContent).trim();
    if (masterBody) {
        parts.push(masterBody);
    }

    // Section files
    for (const sectionPath of manifest.sections) {
        const file = resolveFilePath(app, masterFile, sectionPath);
        if (!file) {
            errors.push(`Section not found: ${sectionPath}`);
            parts.push(`\n\n> [!warning] Missing section: ${sectionPath}\n`);
            continue;
        }

        const content = await app.vault.read(file);
        const body = stripFrontmatter(content).trim();
        parts.push(`\n\n---\n\n${body}`);
    }

    // Appendix files
    if (manifest.appendices) {
        let appendixLetter = 'A';
        for (const appendixPath of manifest.appendices) {
            const file = resolveFilePath(app, masterFile, appendixPath);
            if (!file) {
                errors.push(`Appendix not found: ${appendixPath}`);
                parts.push(`\n\n> [!warning] Missing appendix: ${appendixPath}\n`);
                continue;
            }

            const content = await app.vault.read(file);
            let body = stripFrontmatter(content).trim();

            // Add appendix prefix to the first heading
            body = body.replace(/^(#{1,2}\s+)/, `$1Appendix ${appendixLetter}: `);
            parts.push(`\n\n---\n\n${body}`);
            appendixLetter = String.fromCharCode(appendixLetter.charCodeAt(0) + 1);
        }
    }

    if (errors.length > 0) {
        console.warn('Project compilation warnings:', errors);
    }

    // Resolve bibliography path
    let bibPath: string | undefined;
    if (manifest.bibliography) {
        const bibFile = resolveFilePath(app, masterFile, manifest.bibliography);
        if (bibFile) {
            bibPath = bibFile.path;
        } else {
            console.warn(`Bibliography file not found: ${manifest.bibliography}`);
        }
    }

    return {
        markdown: parts.join('\n'),
        bibPath,
    };
}

/**
 * Check if a file has a project manifest in its frontmatter.
 */
export function hasProjectManifest(app: App, file: TFile): boolean {
    return extractManifest(app, file) !== null;
}
