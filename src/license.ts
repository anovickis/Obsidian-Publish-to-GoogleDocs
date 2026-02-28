// license.ts — Gumroad license validation, caching, and feature gating
//
// Validates license keys against the Gumroad API. Caches the result
// locally to avoid hitting the API on every plugin load. Provides
// feature gates that check the user's tier before allowing Pro/Premium
// features to execute.
//
// Gift/reward licenses: Create a separate Gumroad product (e.g., "Pro Gift 1 Year")
// priced at $0 with a yearly subscription. When the subscription lapses,
// the Gumroad API returns subscription_ended_at in the past and the plugin
// downgrades to free automatically.

import { requestUrl, Notice } from 'obsidian';
import {
    PluginSettings,
    LicenseTier,
    Feature,
    GUMROAD_VERIFY_URL,
    GUMROAD_PRO_PERMALINK,
    GUMROAD_PREMIUM_PERMALINK,
} from './types';

// ---- Tier Hierarchy ----

const TIER_LEVEL: Record<LicenseTier, number> = {
    free: 0,
    pro: 1,
    premium: 2,
};

// Minimum tier required for each feature
const FEATURE_TIER: Record<Feature, number> = {
    'docx-export': 1,
    'pdf-export': 1,
    'batch-publish': 1,
    'custom-themes': 1,
    'toc': 1,
    'wikilink-resolve': 1,
    'header-footer': 1,
    'mermaid': 1,
    'true-update': 2,
    'auto-publish': 2,
    'history': 2,
    'team': 2,
};

// How often to re-validate (ms)
const REVALIDATION_INTERVAL_LIFETIME = 7 * 24 * 60 * 60 * 1000;  // 7 days for lifetime Pro
const REVALIDATION_INTERVAL_SUB = 24 * 60 * 60 * 1000;           // 24 hours for subscription/gift
const OFFLINE_GRACE_PERIOD = 30 * 24 * 60 * 60 * 1000;           // 30 days offline grace

// ---- Gumroad API ----

interface GumroadVerifyResponse {
    success: boolean;
    purchase?: {
        email: string;
        product_permalink: string;
        recurrence: string | null;          // null for one-time, 'monthly'/'yearly' for sub
        subscription_ended_at: string | null; // ISO date string if subscription lapsed
        refunded: boolean;
        chargebacked: boolean;
        subscription_cancelled_at: string | null;
        subscription_failed_at: string | null;
    };
    message?: string;
}

/**
 * Verify a license key against the Gumroad API.
 * Tries Pro product first, then Premium product.
 * Returns the determined tier, email, and expiry info.
 */
async function verifyWithGumroad(licenseKey: string): Promise<{
    tier: LicenseTier;
    email: string;
    expiresAt: number | null;
}> {
    // Try each product permalink in order: premium first (higher tier),
    // then pro. The Gumroad API only succeeds for the correct product.
    const products: { permalink: string; tier: LicenseTier }[] = [
        { permalink: GUMROAD_PREMIUM_PERMALINK, tier: 'premium' },
        { permalink: GUMROAD_PRO_PERMALINK, tier: 'pro' },
    ];

    for (const product of products) {
        try {
            const response = await requestUrl({
                url: GUMROAD_VERIFY_URL,
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    product_permalink: product.permalink,
                    license_key: licenseKey,
                }).toString(),
            });

            const data: GumroadVerifyResponse = response.json;

            if (data.success && data.purchase) {
                const purchase = data.purchase;

                // Check if refunded or chargebacked
                if (purchase.refunded || purchase.chargebacked) {
                    continue; // Skip this product, try next
                }

                // Check subscription status for recurring products (Premium, gift keys)
                if (purchase.recurrence) {
                    // Has a subscription end date in the past = lapsed
                    if (purchase.subscription_ended_at) {
                        const endedAt = new Date(purchase.subscription_ended_at).getTime();
                        if (endedAt < Date.now()) {
                            // Subscription has lapsed — downgrade
                            continue;
                        }
                        // Still active, but has an end date (e.g., yearly gift)
                        return {
                            tier: product.tier,
                            email: purchase.email,
                            expiresAt: endedAt,
                        };
                    }
                    // Active subscription with no end date
                    return {
                        tier: product.tier,
                        email: purchase.email,
                        expiresAt: null,
                    };
                }

                // One-time purchase (lifetime Pro)
                return {
                    tier: product.tier,
                    email: purchase.email,
                    expiresAt: null,
                };
            }
        } catch {
            // API call failed for this product — try next, or fall through
            continue;
        }
    }

    // No valid license found on any product
    return { tier: 'free', email: '', expiresAt: null };
}

// ---- Public API ----

/**
 * Validate the stored license key, using cache when appropriate.
 * Updates settings in place. Call saveFn to persist after.
 *
 * Returns the effective tier after validation.
 */
export async function validateLicense(
    settings: PluginSettings,
    saveFn: () => Promise<void>,
): Promise<LicenseTier> {
    // No license key entered — always free
    if (!settings.licenseKey) {
        settings.licenseType = 'free';
        settings.licenseEmail = '';
        settings.licenseExpiresAt = null;
        settings.licenseValidatedAt = 0;
        await saveFn();
        return 'free';
    }

    // Check if cached validation is still fresh
    const now = Date.now();
    const timeSinceValidation = now - settings.licenseValidatedAt;
    const isSubscription = settings.licenseExpiresAt !== null ||
                           settings.licenseType === 'premium';
    const revalidationInterval = isSubscription
        ? REVALIDATION_INTERVAL_SUB
        : REVALIDATION_INTERVAL_LIFETIME;

    if (settings.licenseValidatedAt > 0 && timeSinceValidation < revalidationInterval) {
        // Cache is fresh — check expiry for gift/sub licenses
        if (settings.licenseExpiresAt && now > settings.licenseExpiresAt) {
            settings.licenseType = 'free';
            await saveFn();
            return 'free';
        }
        return settings.licenseType;
    }

    // Cache is stale — try to re-validate
    try {
        const result = await verifyWithGumroad(settings.licenseKey);
        settings.licenseType = result.tier;
        settings.licenseEmail = result.email;
        settings.licenseExpiresAt = result.expiresAt;
        settings.licenseValidatedAt = now;
        await saveFn();
        return result.tier;
    } catch {
        // Network error — use offline grace period
        if (settings.licenseValidatedAt > 0 &&
            timeSinceValidation < OFFLINE_GRACE_PERIOD) {
            // Trust the cache for up to 30 days offline
            console.log('License validation failed (offline?), using cached tier:', settings.licenseType);
            return settings.licenseType;
        }

        // Cache is too old AND we can't reach Gumroad — downgrade to free
        console.warn('License validation failed and cache expired. Downgrading to free.');
        settings.licenseType = 'free';
        await saveFn();
        return 'free';
    }
}

/**
 * Activate a new license key immediately (used from settings UI).
 * Always hits the Gumroad API regardless of cache.
 */
export async function activateLicense(
    licenseKey: string,
    settings: PluginSettings,
    saveFn: () => Promise<void>,
): Promise<{ tier: LicenseTier; email: string; expiresAt: number | null }> {
    settings.licenseKey = licenseKey;

    const result = await verifyWithGumroad(licenseKey);

    settings.licenseType = result.tier;
    settings.licenseEmail = result.email;
    settings.licenseExpiresAt = result.expiresAt;
    settings.licenseValidatedAt = Date.now();
    await saveFn();

    return result;
}

/**
 * Deactivate the current license (sign out of Pro/Premium).
 */
export async function deactivateLicense(
    settings: PluginSettings,
    saveFn: () => Promise<void>,
): Promise<void> {
    settings.licenseKey = '';
    settings.licenseType = 'free';
    settings.licenseEmail = '';
    settings.licenseExpiresAt = null;
    settings.licenseValidatedAt = 0;
    await saveFn();
}

/**
 * Check if the current license tier grants access to a feature.
 * This is the main gate function — call before executing any Pro/Premium feature.
 */
export function hasFeature(settings: PluginSettings, feature: Feature): boolean {
    // Check expiry for gift/subscription licenses
    if (settings.licenseExpiresAt && Date.now() > settings.licenseExpiresAt) {
        return false;
    }
    return TIER_LEVEL[settings.licenseType] >= FEATURE_TIER[feature];
}

/**
 * Get a human-readable tier name for display in settings.
 */
export function getTierDisplayName(settings: PluginSettings): string {
    const tier = settings.licenseType;
    if (tier === 'free') return 'Free';

    const base = tier === 'pro' ? 'Pro' : 'Premium';

    if (settings.licenseExpiresAt) {
        const expiryDate = new Date(settings.licenseExpiresAt);
        const dateStr = expiryDate.toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric',
        });
        return `${base} (expires ${dateStr})`;
    }

    return base;
}

/**
 * Get the minimum tier name required for a feature (for upgrade prompts).
 */
export function getRequiredTierName(feature: Feature): string {
    const level = FEATURE_TIER[feature];
    return level >= 2 ? 'Premium' : 'Pro';
}

/**
 * Show a notice prompting the user to upgrade when they try a gated feature.
 */
export function showUpgradeNotice(feature: Feature): void {
    const tierName = getRequiredTierName(feature);
    new Notice(
        `This feature requires ${tierName}. ` +
        `Go to Settings → Publish to Google Docs → License to activate.`,
        8000,
    );
}
