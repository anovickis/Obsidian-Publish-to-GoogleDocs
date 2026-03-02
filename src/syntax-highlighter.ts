// syntax-highlighter.ts — Lightweight syntax highlighting for exported code blocks
//
// Adds inline color styles to code tokens inside <pre><code> blocks.
// This preserves syntax highlighting in Google Docs, Medium, LinkedIn, and DOCX
// exports where CSS classes are stripped.
//
// Supported languages: JavaScript/TypeScript, Python, C/C++, Java, Rust, Go,
// HTML/XML, CSS, SQL, Bash/Shell, YAML, JSON, Markdown, LaTeX.
//
// Uses a simple regex-based tokenizer — not a full parser. Handles:
//   - Keywords, built-in types, constants
//   - Strings (single, double, backtick/template)
//   - Comments (single-line and multi-line)
//   - Numbers (int, float, hex, binary)
//   - Function calls
//   - Decorators/attributes

// ---- Color Palette ----
// Based on VS Code's default dark+ theme, adapted for light backgrounds

const COLORS = {
    keyword: '#0000ff',     // blue: if, for, return, function, class
    type: '#267f99',        // teal: int, string, bool
    string: '#a31515',      // dark red: "hello", 'world'
    comment: '#008000',     // green: // comment, /* block */
    number: '#098658',      // dark green: 42, 3.14, 0xff
    function: '#795e26',    // brown: myFunc(...)
    constant: '#0070c1',    // dark blue: true, false, null, None
    decorator: '#af00db',   // purple: @decorator, #[attr]
    tag: '#800000',         // maroon: <div>, </span>
    attribute: '#ff0000',   // red: class=, href=
    operator: '#000000',    // black: +, -, =, =>
};

// ---- Language Definitions ----

interface LanguageDef {
    keywords: string[];
    types?: string[];
    constants?: string[];
    singleLineComment?: string;
    multiLineComment?: [string, string];
    hasTemplateStrings?: boolean;
    hasDecorators?: boolean;
}

const LANGUAGES: Record<string, LanguageDef> = {
    javascript: {
        keywords: ['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
            'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
            'for', 'from', 'function', 'get', 'if', 'import', 'in', 'instanceof', 'let',
            'new', 'of', 'return', 'set', 'static', 'super', 'switch', 'this', 'throw',
            'try', 'typeof', 'var', 'void', 'while', 'with', 'yield'],
        types: ['Array', 'Boolean', 'Date', 'Error', 'Function', 'Map', 'Number', 'Object',
            'Promise', 'RegExp', 'Set', 'String', 'Symbol', 'WeakMap', 'WeakSet'],
        constants: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity', 'console', 'window', 'document'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
        hasTemplateStrings: true,
    },
    typescript: {
        keywords: ['abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
            'continue', 'debugger', 'declare', 'default', 'delete', 'do', 'else', 'enum',
            'export', 'extends', 'finally', 'for', 'from', 'function', 'get', 'if', 'implements',
            'import', 'in', 'infer', 'instanceof', 'interface', 'is', 'keyof', 'let', 'module',
            'namespace', 'new', 'of', 'override', 'readonly', 'return', 'satisfies', 'set',
            'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var',
            'void', 'while', 'with', 'yield'],
        types: ['any', 'bigint', 'boolean', 'never', 'number', 'object', 'string', 'symbol',
            'unknown', 'void', 'Array', 'Map', 'Set', 'Promise', 'Record', 'Partial',
            'Required', 'Readonly', 'Pick', 'Omit'],
        constants: ['true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
        hasTemplateStrings: true,
        hasDecorators: true,
    },
    python: {
        keywords: ['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
            'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
            'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
            'raise', 'return', 'try', 'while', 'with', 'yield'],
        types: ['int', 'float', 'str', 'bool', 'list', 'dict', 'set', 'tuple', 'bytes',
            'complex', 'frozenset', 'type', 'range', 'bytearray', 'memoryview'],
        constants: ['True', 'False', 'None', 'self', 'cls', '__name__', '__main__'],
        singleLineComment: '#',
        hasDecorators: true,
    },
    c: {
        keywords: ['auto', 'break', 'case', 'const', 'continue', 'default', 'do', 'else',
            'enum', 'extern', 'for', 'goto', 'if', 'inline', 'register', 'restrict',
            'return', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
            'volatile', 'while'],
        types: ['char', 'double', 'float', 'int', 'long', 'short', 'signed', 'unsigned',
            'void', 'size_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t',
            'uint16_t', 'uint32_t', 'uint64_t', 'bool', 'FILE'],
        constants: ['NULL', 'true', 'false', 'EOF', 'stdin', 'stdout', 'stderr'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
    },
    cpp: {
        keywords: ['alignas', 'alignof', 'auto', 'break', 'case', 'catch', 'class', 'const',
            'constexpr', 'continue', 'decltype', 'default', 'delete', 'do', 'dynamic_cast',
            'else', 'enum', 'explicit', 'export', 'extern', 'for', 'friend', 'goto', 'if',
            'inline', 'mutable', 'namespace', 'new', 'noexcept', 'operator', 'override',
            'private', 'protected', 'public', 'register', 'return', 'sizeof', 'static',
            'static_cast', 'struct', 'switch', 'template', 'this', 'throw', 'try', 'typedef',
            'typeid', 'typename', 'union', 'using', 'virtual', 'volatile', 'while'],
        types: ['bool', 'char', 'double', 'float', 'int', 'long', 'short', 'signed',
            'unsigned', 'void', 'string', 'vector', 'map', 'set', 'shared_ptr', 'unique_ptr',
            'size_t', 'auto'],
        constants: ['NULL', 'nullptr', 'true', 'false', 'std'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
    },
    java: {
        keywords: ['abstract', 'assert', 'break', 'case', 'catch', 'class', 'continue',
            'default', 'do', 'else', 'enum', 'extends', 'final', 'finally', 'for', 'if',
            'implements', 'import', 'instanceof', 'interface', 'native', 'new', 'package',
            'private', 'protected', 'public', 'return', 'static', 'strictfp', 'super',
            'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
            'volatile', 'while'],
        types: ['boolean', 'byte', 'char', 'double', 'float', 'int', 'long', 'short', 'void',
            'String', 'Integer', 'Double', 'Boolean', 'List', 'Map', 'Set', 'Object',
            'Class', 'System'],
        constants: ['true', 'false', 'null'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
        hasDecorators: true,
    },
    rust: {
        keywords: ['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
            'else', 'enum', 'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
            'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'static',
            'struct', 'super', 'trait', 'type', 'unsafe', 'use', 'where', 'while'],
        types: ['bool', 'char', 'f32', 'f64', 'i8', 'i16', 'i32', 'i64', 'i128', 'isize',
            'u8', 'u16', 'u32', 'u64', 'u128', 'usize', 'str', 'String', 'Vec', 'Box',
            'Option', 'Result', 'HashMap', 'HashSet'],
        constants: ['true', 'false', 'None', 'Some', 'Ok', 'Err', 'Self'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
    },
    go: {
        keywords: ['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
            'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map',
            'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var'],
        types: ['bool', 'byte', 'complex64', 'complex128', 'error', 'float32', 'float64',
            'int', 'int8', 'int16', 'int32', 'int64', 'rune', 'string', 'uint', 'uint8',
            'uint16', 'uint32', 'uint64', 'uintptr'],
        constants: ['true', 'false', 'nil', 'iota'],
        singleLineComment: '//',
        multiLineComment: ['/*', '*/'],
    },
    sql: {
        keywords: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set',
            'delete', 'create', 'table', 'alter', 'drop', 'index', 'view', 'join', 'inner',
            'outer', 'left', 'right', 'on', 'and', 'or', 'not', 'in', 'between', 'like',
            'is', 'null', 'as', 'order', 'by', 'group', 'having', 'limit', 'offset',
            'union', 'all', 'distinct', 'case', 'when', 'then', 'else', 'end', 'exists',
            'primary', 'key', 'foreign', 'references', 'constraint', 'default', 'check',
            'unique', 'grant', 'revoke', 'commit', 'rollback', 'begin', 'transaction'],
        types: ['int', 'integer', 'varchar', 'char', 'text', 'boolean', 'date', 'datetime',
            'timestamp', 'float', 'double', 'decimal', 'numeric', 'blob', 'serial', 'bigint'],
        constants: ['true', 'false', 'null'],
        singleLineComment: '--',
        multiLineComment: ['/*', '*/'],
    },
    bash: {
        keywords: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case',
            'esac', 'in', 'function', 'return', 'local', 'export', 'source', 'alias',
            'unalias', 'set', 'unset', 'shift', 'break', 'continue', 'exit', 'trap',
            'read', 'declare', 'typeset', 'readonly'],
        constants: ['true', 'false'],
        singleLineComment: '#',
    },
    yaml: {
        keywords: [],
        constants: ['true', 'false', 'null', 'yes', 'no', 'on', 'off'],
        singleLineComment: '#',
    },
    css: {
        keywords: ['important', 'media', 'keyframes', 'import', 'charset', 'font-face',
            'supports', 'namespace', 'page', 'counter-style', 'layer'],
        constants: ['inherit', 'initial', 'unset', 'revert', 'none', 'auto', 'transparent',
            'currentColor'],
        multiLineComment: ['/*', '*/'],
    },
};

// Aliases for common language identifiers
const LANG_ALIASES: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', python3: 'python',
    'c++': 'cpp', cxx: 'cpp', cc: 'cpp', h: 'c', hpp: 'cpp',
    sh: 'bash', shell: 'bash', zsh: 'bash',
    yml: 'yaml',
    golang: 'go',
    mysql: 'sql', postgresql: 'sql', sqlite: 'sql',
    'c#': 'java', csharp: 'java', // Java-like enough for basic highlighting
    kotlin: 'java',
};

// ---- Tokenizer ----

interface Token {
    text: string;
    color: string | null;  // null = no color (plain text)
}

function tokenize(code: string, lang: LanguageDef): Token[] {
    const tokens: Token[] = [];
    let pos = 0;

    const keywordSet = new Set(lang.keywords);
    const typeSet = new Set(lang.types || []);
    const constantSet = new Set(lang.constants || []);

    while (pos < code.length) {
        let matched = false;

        // Multi-line comment
        if (lang.multiLineComment && code.startsWith(lang.multiLineComment[0], pos)) {
            const end = code.indexOf(lang.multiLineComment[1], pos + lang.multiLineComment[0].length);
            const commentEnd = end >= 0 ? end + lang.multiLineComment[1].length : code.length;
            tokens.push({ text: code.slice(pos, commentEnd), color: COLORS.comment });
            pos = commentEnd;
            matched = true;
        }

        // Single-line comment
        if (!matched && lang.singleLineComment && code.startsWith(lang.singleLineComment, pos)) {
            const lineEnd = code.indexOf('\n', pos);
            const end = lineEnd >= 0 ? lineEnd : code.length;
            tokens.push({ text: code.slice(pos, end), color: COLORS.comment });
            pos = end;
            matched = true;
        }

        // Decorator / attribute
        if (!matched && lang.hasDecorators && code[pos] === '@') {
            const m = code.slice(pos).match(/^@\w+/);
            if (m) {
                tokens.push({ text: m[0], color: COLORS.decorator });
                pos += m[0].length;
                matched = true;
            }
        }

        // Strings: double-quoted
        if (!matched && code[pos] === '"') {
            const end = findStringEnd(code, pos, '"');
            tokens.push({ text: code.slice(pos, end), color: COLORS.string });
            pos = end;
            matched = true;
        }

        // Strings: single-quoted
        if (!matched && code[pos] === "'") {
            const end = findStringEnd(code, pos, "'");
            tokens.push({ text: code.slice(pos, end), color: COLORS.string });
            pos = end;
            matched = true;
        }

        // Template strings: backtick
        if (!matched && lang.hasTemplateStrings && code[pos] === '`') {
            const end = findStringEnd(code, pos, '`');
            tokens.push({ text: code.slice(pos, end), color: COLORS.string });
            pos = end;
            matched = true;
        }

        // Numbers: hex, binary, octal, float, int
        if (!matched && /[0-9]/.test(code[pos])) {
            const m = code.slice(pos).match(/^0[xX][0-9a-fA-F_]+|^0[bB][01_]+|^0[oO][0-7_]+|^\d[\d_]*\.?\d*(?:[eE][+-]?\d+)?/);
            if (m) {
                tokens.push({ text: m[0], color: COLORS.number });
                pos += m[0].length;
                matched = true;
            }
        }

        // Words: keywords, types, constants, function calls
        if (!matched && /[a-zA-Z_$]/.test(code[pos])) {
            const m = code.slice(pos).match(/^[a-zA-Z_$]\w*/);
            if (m) {
                const word = m[0];
                let color: string | null = null;

                if (keywordSet.has(word)) {
                    color = COLORS.keyword;
                } else if (typeSet.has(word)) {
                    color = COLORS.type;
                } else if (constantSet.has(word)) {
                    color = COLORS.constant;
                } else if (code[pos + word.length] === '(') {
                    color = COLORS.function;
                }

                tokens.push({ text: word, color });
                pos += word.length;
                matched = true;
            }
        }

        // Anything else: single character
        if (!matched) {
            tokens.push({ text: code[pos], color: null });
            pos++;
        }
    }

    return tokens;
}

function findStringEnd(code: string, start: number, quote: string): number {
    let pos = start + 1;
    while (pos < code.length) {
        if (code[pos] === '\\') {
            pos += 2; // skip escaped character
            continue;
        }
        if (code[pos] === quote) {
            return pos + 1;
        }
        // For template strings, don't end on newlines
        if (quote !== '`' && code[pos] === '\n') {
            return pos;
        }
        pos++;
    }
    return code.length;
}

// ---- HTML Processing ----

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function tokensToHtml(tokens: Token[]): string {
    return tokens
        .map((t) => {
            const escaped = escapeHtml(t.text);
            if (t.color) {
                return `<span style="color:${t.color};">${escaped}</span>`;
            }
            return escaped;
        })
        .join('');
}

/**
 * Highlight a raw markdown fenced code block and return it as HTML.
 *
 * Takes the full fence including backticks, e.g.:
 *   ```python\ndef foo():\n    pass\n```
 *
 * Returns `<pre><code class="language-xxx">...highlighted...</code></pre>`
 * or null if the language is unknown or the fence has no language.
 */
export function highlightFencedBlock(fence: string): string | null {
    // Parse language and code from the fence manually (handles \r\n and edge cases)
    const firstNewline = fence.indexOf('\n');
    if (firstNewline === -1) return null;

    const openingLine = fence.substring(0, firstNewline).replace(/\r$/, '').trim();
    if (!openingLine.startsWith('```')) return null;

    const langRaw = openingLine.substring(3).trim();
    if (!langRaw || !/^\w+$/.test(langRaw)) return null;

    // Find closing ``` — must be at the end
    const closingIdx = fence.lastIndexOf('```');
    if (closingIdx <= firstNewline) return null;

    // Extract code between opening fence line and closing ```
    let code = fence.substring(firstNewline + 1, closingIdx);
    // Strip trailing newline(s) before closing fence
    code = code.replace(/\r?\n$/, '');

    const normalizedLang = langRaw.toLowerCase();
    const langKey = LANG_ALIASES[normalizedLang] || normalizedLang;
    const langDef = LANGUAGES[langKey];

    if (!langDef) {
        console.log(`[syntax-highlight] Unknown language: ${langRaw}`);
        return null;
    }

    const tokens = tokenize(code, langDef);
    const highlighted = tokensToHtml(tokens);

    console.log(`[syntax-highlight] Highlighted ${langRaw} block (${code.length} chars, ${tokens.length} tokens)`);

    // Use a <table> wrapper because Google Docs strips inline styles from
    // <span> elements inside <pre> and <div> blocks, but preserves them inside
    // table cells (confirmed working — same pattern as callouts).
    // Replace spaces with &nbsp; to preserve indentation (HTML collapses spaces).
    // Only replace spaces in text content, not inside HTML tags.
    const preserved = highlighted
        .replace(/(<[^>]*>)|( )/g, (_, tag, space) => tag ? tag : '&nbsp;')
        .split('\n').join('<br>');
    return `<table style="border:none;border-collapse:collapse;background:#f5f5f5;width:100%;margin:12px 0;"><tr><td style="padding:12px 16px;font-family:'Courier New',Courier,monospace;font-size:13px;line-height:1.5;border:none;">${preserved}</td></tr></table>`;
}

/**
 * Add syntax highlighting to code blocks in the HTML output (fallback).
 * Kept for compatibility but the preferred path is highlightFencedBlock
 * applied during the extraction phase before Obsidian renders.
 */
export function highlightCodeBlocks(html: string): string {
    return html.replace(
        /<pre([^>]*)>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/gi,
        (match, preAttrs: string, codeAttrs: string, codeHtml: string) => {
            const langMatch = codeAttrs.match(/language-(\w+)/) || preAttrs.match(/language-(\w+)/);
            if (!langMatch) return match;

            const langId = langMatch[1];
            const normalizedLang = langId.toLowerCase();
            const langKey = LANG_ALIASES[normalizedLang] || normalizedLang;
            const langDef = LANGUAGES[langKey];
            if (!langDef) return match;

            const rawCode = codeHtml
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");

            const tokens = tokenize(rawCode, langDef);
            const highlighted = tokensToHtml(tokens);

            return `<pre${preAttrs}><code class="language-${langId}">${highlighted}</code></pre>`;
        },
    );
}
