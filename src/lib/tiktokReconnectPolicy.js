/**
 * tiktokReconnectPolicy.js
 * Exponential-backoff reconnect helper for TikTok Live connections.
 * Stateless — caller manages the attempt counter.
 *
 * @module lib/tiktokReconnectPolicy
 */

/** Default configuration */
const DEFAULTS = {
	maxRetries: 5,
	baseDelayMs: 2_000,
	maxDelayMs: 60_000,
	jitterFraction: 0.3, // ±30 %
};

/**
 * Compute the delay (ms) before the next reconnect attempt.
 * Uses exponential backoff with jitter to avoid thundering-herd.
 *
 * @param {number} attempt  - Zero-based attempt index (0 = first retry)
 * @param {Object} [opts]   - Override defaults
 * @returns {number} Delay in milliseconds
 */
export function getDelay(attempt, opts = {}) {
	const { baseDelayMs, maxDelayMs, jitterFraction } = { ...DEFAULTS, ...opts };
	const exp = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
	const jitter = exp * jitterFraction * (Math.random() * 2 - 1); // ±jitter
	return Math.max(0, Math.round(exp + jitter));
}

/**
 * Whether we should keep retrying.
 * @param {number} attempt   - Zero-based attempt index
 * @param {Object} [opts]    - Override defaults
 * @returns {boolean}
 */
export function shouldRetry(attempt, opts = {}) {
	const { maxRetries } = { ...DEFAULTS, ...opts };
	return attempt < maxRetries;
}

/**
 * Helper: sleep for `ms` milliseconds (cancellable).
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export { DEFAULTS as reconnectDefaults };
