/**
 * config.js
 * Horse Racing game configuration.
 *
 * LANE SYSTEM:
 * - Each lane = a country flag (viewers root for their country).
 * - Gifts are mapped to lanes by name, balanced across value tiers.
 * - Overlay shows which gift powers which horse.
 *
 * CUSTOMIZING:
 * - Use debug.html to discover exact gift names from your TikTok stream.
 * - Update giftTiers below to match your audience's available gifts.
 *
 * @module games/horse-racing/config
 */

const CONFIG = {
	// ==========================================
	// LANES (HORSES = COUNTRY FLAGS)
	// Top TikTok markets in Asia
	// ==========================================
	lanes: [
		{ id: 0, name: "Vietnam", flag: "🇻🇳", color: "#FF4444", aliases: ["vn", "vietnam", "viet nam", "viet"] },
		{ id: 1, name: "Thailand", flag: "🇹🇭", color: "#4488FF", aliases: ["th", "tl", "thailand", "thai"] },
		{ id: 2, name: "Indonesia", flag: "🇮🇩", color: "#44DD44", aliases: ["id", "indonesia", "indo"] },
		{ id: 3, name: "Malaysia", flag: "🇲🇾", color: "#FFCC00", aliases: ["my", "ml", "malaysia", "malay"] },
		{ id: 4, name: "China", flag: "🇨🇳", color: "#CC44FF", aliases: ["cn", "china", "trung quoc", "trung"] },
	],

	// ==========================================
	// GIFT → LANE MAPPING (by value tier)
	// Each tier: equal-cost gifts, one per lane.
	// Array index = lane index (0=VN, 1=TH, 2=ID, 3=MY, 4=CN).
	// ==========================================
	giftTiers: [
		{
			coins: 1,
			gifts: [
				{ name: "Rose", emoji: "🌹" },
				{ name: "GG", emoji: "✌️" },
				{ name: "Ice Cream Cone", emoji: "🍦" },
				{ name: "Finger Heart", emoji: "🫰" },
				{ name: "TikTok", emoji: "🎵" },
			],
		},
		{
			coins: 5,
			gifts: [
				{ name: "Hand Heart", emoji: "💕" },
				{ name: "Little Crown", emoji: "👑" },
				{ name: "Butterfly", emoji: "🦋" },
				{ name: "Love You", emoji: "💗" },
				{ name: "Wishing Bottle", emoji: "🧴" },
			],
		},
		{
			coins: 10,
			gifts: [
				{ name: "Perfume", emoji: "💐" },
				{ name: "Doughnut", emoji: "🍩" },
				{ name: "Cap", emoji: "🧢" },
				{ name: "Paper Crane", emoji: "🕊️" },
				{ name: "Sunglasses", emoji: "🕶️" },
			],
		},
		{
			coins: 99,
			gifts: [
				{ name: "Garland", emoji: "🏵️" },
				{ name: "Singing Mic", emoji: "🎤" },
				{ name: "Star", emoji: "⭐" },
				{ name: "Concert", emoji: "🎸" },
				{ name: "Lock and Key", emoji: "🔐" },
			],
		},
	],

	// ==========================================
	// RACE PHASES & TIMING (ms)
	// ==========================================
	phases: {
		/** WAITING — lobby, waiting for first gift to start countdown */
		waiting: { duration: Infinity },
		/** COUNTDOWN — 10s before race begins */
		countdown: { duration: 10_000 },
		/** RACING — gifts move horses, first to finish wins */
		racing: { duration: 120_000 }, // max race length (2 min failsafe)
		/** FINISHED — show winner for 8s */
		finished: { duration: 8_000 },
		/** COOLDOWN — brief pause before auto-reset */
		cooldown: { duration: 5_000 },
	},

	// ==========================================
	// RACE MECHANICS
	// ==========================================
	/** Distance (arbitrary units) a horse must reach to win */
	finishLine: 1000,

	/** Distance a single chat vote gives (much less than gifts) */
	chatDistance: 3,

	/**
	 * Convert gift diamond value to movement distance.
	 * Tunable: base + multiplier * sqrt(value) gives diminishing returns on mega-gifts.
	 */
	giftToDistance(giftValue) {
		return Math.round(5 + 3 * Math.sqrt(giftValue));
	},

	/**
	 * Resolve gift → lane index.
	 * Priority: 1) giftName match in tier map, 2) giftId % lanes fallback.
	 */
	giftToLane(giftName, giftId, laneCount) {
		// Build name→lane lookup on first call (lazy init)
		if (!this._giftNameMap) {
			this._giftNameMap = {};
			for (const tier of this.giftTiers) {
				tier.gifts.forEach((g, idx) => {
					this._giftNameMap[g.name.toLowerCase()] = idx;
				});
			}
		}
		const key = (giftName || "").toLowerCase();
		if (key && this._giftNameMap[key] !== undefined) {
			return this._giftNameMap[key];
		}
		// Fallback for unmapped gifts
		return Math.abs(giftId || 0) % laneCount;
	},

	/**
	 * Get gift emoji by name (for HUD/feed display).
	 */
	getGiftEmoji(giftName) {
		if (!this._giftEmojiMap) {
			this._giftEmojiMap = {};
			for (const tier of this.giftTiers) {
				for (const g of tier.gifts) {
					this._giftEmojiMap[g.name.toLowerCase()] = g.emoji;
				}
			}
		}
		return this._giftEmojiMap[(giftName || "").toLowerCase()] || "🎁";
	},

	/**
	 * Get all gift emojis for a lane (for HUD legend).
	 * @param {number} laneIdx
	 * @returns {string[]} Array of emoji strings
	 */
	getLaneGiftEmojis(laneIdx) {
		return this.giftTiers
			.map((tier) => tier.gifts[laneIdx]?.emoji)
			.filter(Boolean);
	},

	/**
	 * Chat-based lane selection.
	 * Viewer types country code (VN, TH, ID, MY, CN), aliases, or number 1-5.
	 * Case-insensitive, trimmed.
	 * @returns {number} lane index or -1 if no match
	 */
	chatToLane(comment) {
		const text = (comment || "").toLowerCase().trim();
		if (!text) return -1;

		// Number shortcut: "1"-"5"
		const num = parseInt(text, 10);
		if (num >= 1 && num <= this.lanes.length) return num - 1;

		// Build alias lookup on first call (lazy init)
		if (!this._chatAliasMap) {
			this._chatAliasMap = {};
			for (const lane of this.lanes) {
				// Country name itself
				this._chatAliasMap[lane.name.toLowerCase()] = lane.id;
				// All aliases
				for (const alias of lane.aliases || []) {
					this._chatAliasMap[alias.toLowerCase()] = lane.id;
				}
			}
		}

		return this._chatAliasMap[text] ?? -1;
	},
};

// Make available in both module and browser global contexts
if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
} else {
	window.RACE_CONFIG = CONFIG;
}
