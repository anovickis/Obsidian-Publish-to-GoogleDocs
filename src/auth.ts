// auth.ts — OAuth 2.0 with loopback server + PKCE for Google APIs
//
// Flow: plugin opens browser → Google consent screen (account chooser) →
// user authorizes → redirect to http://127.0.0.1:<port> → plugin extracts
// auth code → exchanges for tokens → stores in plugin settings.

import { requestUrl, Notice } from 'obsidian';
import {
    PluginSettings,
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_USERINFO_URL,
    SCOPES,
} from './types';

// Node.js modules available in Electron
import * as http from 'http';
import * as crypto from 'crypto';

// ---- PKCE Helpers ----

/** Generate a cryptographically random code verifier (43-128 chars, base64url) */
function generateCodeVerifier(): string {
    const bytes = crypto.randomBytes(64);
    return bytes
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
        .slice(0, 128);
}

/** SHA-256 hash of verifier, base64url-encoded (no padding) */
function generateCodeChallenge(verifier: string): string {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return hash
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
}

/** Random state string for CSRF protection */
function generateState(): string {
    return crypto.randomBytes(16).toString('hex');
}

// ---- Loopback Server ----

interface LoopbackResult {
    port: number;
    codePromise: Promise<string>;
    server: http.Server;
}

/**
 * Spin up a temporary HTTP server on 127.0.0.1 with an OS-assigned port.
 * Waits for Google's OAuth redirect, extracts the authorization code,
 * sends a success page to the browser, and shuts down.
 */
async function startLoopbackServer(expectedState: string): Promise<LoopbackResult> {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;

    const codePromise = new Promise<string>((resolve, reject) => {
        resolveCode = resolve;
        rejectCode = reject;
    });

    const server = http.createServer((req, res) => {
        // Parse the query parameters from the callback URL
        const url = new URL(req.url || '/', `http://127.0.0.1`);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        // Always send a response so the browser doesn't hang
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

        if (error) {
            res.end(`<html><body><h1>Authorization failed</h1>
                <p>Error: ${error}</p>
                <p>You can close this window.</p></body></html>`);
            rejectCode(new Error(`OAuth error: ${error}`));
        } else if (!code || state !== expectedState) {
            res.end(`<html><body><h1>Authorization failed</h1>
                <p>Invalid response from Google. Please try again.</p>
                <p>You can close this window.</p></body></html>`);
            rejectCode(new Error('Invalid OAuth callback: missing code or state mismatch'));
        } else {
            res.end(`<html><body><h1>Authorization successful!</h1>
                <p>You can close this window and return to Obsidian.</p></body></html>`);
            resolveCode(code);
        }

        // Shut down the server after a brief delay (let the response flush)
        setTimeout(() => {
            server.close();
        }, 1000);
    });

    // Listen on ephemeral port on loopback only — wait for 'listening' event
    // before reading the assigned port
    const port = await new Promise<number>((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const assignedPort = typeof address === 'object' && address ? address.port : 0;
            resolve(assignedPort);
        });
    });

    // Timeout: reject if no callback within 120 seconds
    const timeout = setTimeout(() => {
        server.close();
        rejectCode(new Error('OAuth timeout: no callback received within 120 seconds'));
    }, 120000);

    // Clear timeout once we get the code
    codePromise.finally(() => clearTimeout(timeout));

    return { port, codePromise, server };
}

// ---- Token Exchange ----

interface TokenResponse {
    accessToken: string;
    refreshToken: string;
    tokenExpiry: number;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
async function exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string,
    redirectUri: string,
    codeVerifier: string,
): Promise<TokenResponse> {
    const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
    }).toString();

    const response = await requestUrl({
        url: GOOGLE_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const data = response.json;
    if (!data.access_token) {
        throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);
    }

    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || '',
        tokenExpiry: Date.now() + (data.expires_in || 3600) * 1000,
    };
}

/**
 * Fetch the authenticated user's email address from Google's userinfo endpoint.
 * Non-fatal: returns 'unknown' if the scope wasn't granted or the call fails.
 */
async function fetchUserEmail(accessToken: string): Promise<string> {
    try {
        const response = await requestUrl({
            url: GOOGLE_USERINFO_URL,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        return response.json.email || 'authenticated';
    } catch {
        // The email/userinfo scope wasn't requested — that's fine,
        // we only need drive.file scope for actual functionality.
        return 'authenticated';
    }
}

// ---- Public API ----

/**
 * Run the full OAuth 2.0 authorization flow.
 * Opens the browser with Google's account chooser, waits for the callback,
 * exchanges the code for tokens, and fetches the user's email.
 */
export async function authenticate(settings: PluginSettings): Promise<{
    accessToken: string;
    refreshToken: string;
    tokenExpiry: number;
    userEmail: string;
}> {
    if (!settings.clientId || !settings.clientSecret) {
        throw new Error('Please configure your Google Client ID and Client Secret in plugin settings.');
    }

    // PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Start loopback server
    const { port, codePromise, server } = await startLoopbackServer(state);
    const redirectUri = `http://127.0.0.1:${port}`;

    // Build authorization URL
    const params = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPES,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'select_account consent',  // force account chooser + always get refresh token
    });

    // If we know the user's email, hint it (pre-selects in account chooser)
    if (settings.userEmail) {
        params.set('login_hint', settings.userEmail);
    }

    const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;

    // Open in default browser
    window.open(authUrl);
    new Notice(`OAuth: waiting for callback on port ${port}...`);

    try {
        // Wait for the callback
        const code = await codePromise;
        new Notice('OAuth: received auth code, exchanging for tokens...');
        console.log('OAuth: auth code received, length:', code.length);

        // Exchange code for tokens
        const tokens = await exchangeCodeForTokens(
            code,
            settings.clientId,
            settings.clientSecret,
            redirectUri,
            codeVerifier,
        );
        new Notice('OAuth: tokens received, fetching user info...');
        console.log('OAuth: got access token, has refresh:', !!tokens.refreshToken);

        // Fetch user email
        const userEmail = await fetchUserEmail(tokens.accessToken);
        new Notice(`OAuth: signed in as ${userEmail}`);

        return { ...tokens, userEmail };
    } catch (err) {
        // Make sure server is closed on error
        server.close();
        console.error('OAuth error:', err);
        new Notice(`OAuth error: ${(err as Error).message}`);
        throw err;
    }
}

/**
 * Refresh an expired access token using the stored refresh token.
 */
export async function refreshAccessToken(settings: PluginSettings): Promise<{
    accessToken: string;
    tokenExpiry: number;
}> {
    if (!settings.refreshToken) {
        throw new Error('No refresh token available. Please sign in again.');
    }

    const body = new URLSearchParams({
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
        refresh_token: settings.refreshToken,
        grant_type: 'refresh_token',
    }).toString();

    const response = await requestUrl({
        url: GOOGLE_TOKEN_URL,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    const data = response.json;
    if (!data.access_token) {
        throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    }

    return {
        accessToken: data.access_token,
        tokenExpiry: Date.now() + (data.expires_in || 3600) * 1000,
    };
}

/**
 * Get a valid access token, refreshing or re-authenticating as needed.
 * Updates settings in place and calls saveFn to persist.
 */
export async function getValidToken(
    settings: PluginSettings,
    saveFn: () => Promise<void>,
): Promise<string> {
    // No refresh token at all → need full auth
    if (!settings.refreshToken) {
        const result = await authenticate(settings);
        settings.accessToken = result.accessToken;
        settings.refreshToken = result.refreshToken;
        settings.tokenExpiry = result.tokenExpiry;
        settings.userEmail = result.userEmail;
        await saveFn();
        return result.accessToken;
    }

    // Token still valid (with 60s buffer)
    if (settings.accessToken && Date.now() < settings.tokenExpiry - 60000) {
        return settings.accessToken;
    }

    // Token expired → refresh
    try {
        const result = await refreshAccessToken(settings);
        settings.accessToken = result.accessToken;
        settings.tokenExpiry = result.tokenExpiry;
        await saveFn();
        return result.accessToken;
    } catch (err) {
        // Refresh failed (token revoked?) → full re-auth
        new Notice('Token refresh failed. Please sign in again.');
        const result = await authenticate(settings);
        settings.accessToken = result.accessToken;
        settings.refreshToken = result.refreshToken;
        settings.tokenExpiry = result.tokenExpiry;
        settings.userEmail = result.userEmail;
        await saveFn();
        return result.accessToken;
    }
}
