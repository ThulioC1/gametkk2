/**
 * config.js
 * Corrida na Live — game configuration.
 *
 * MECHANICS (TikTok Live interaction):
 * - Comment  → viewer enters the race with a car (one car per viewer).
 * - Like     → fills the viewer's turbo bar with a persistent speed bonus.
 * - Gift     → instant effect scaled by diamond value:
 *                 small  (< 10 💎)  → NITRO  (short speed burst)
 *                 medium (10-99 💎) → TURBO  (longer, stronger burst)
 *                 large  (100+ 💎)  → ULTRAPASSAGEM (instantly overtakes the car ahead)
 *              Specific gift names can be remapped (e.g. to "oil") in byName below.
 * - Share    → counts as a like bundle for the sharer's car.
 * - First car to cross the finish line wins. The race loops forever.
 *
 * CUSTOMIZING:
 * - Use /debug.html to discover exact gift names from your stream.
 * - All player-facing strings live in `ui` so the overlay can be re-worded/translated.
 *
 * @module games/corrida/config
 */

const CONFIG = {
	// ==========================================
	// UI STRINGS (portuguese by default)
	// ==========================================
	ui: {
		title: "Corrida na Live",
		waiting: "💬 COMENTE PRA ENTRAR NA PISTA!",
		countdown: "⏳ LARGADA EM...",
		racing: "🏁 CORRIDA! LIKE ACELERA • PRESENTE VIRA NITRO!",
		finished: "🏆 TEMOS UM VENCEDOR!",
		cooldown: "⏳ PRÓXIMA CORRIDA EM...",
		legendTitle: "COMO JOGAR",
		legend: [
			"💬 Comente → entra na pista",
			"❤️ Like → acelera seu carro",
			"⚡ Presente pequeno → NITRO",
			"🚀 Presente médio → TURBO",
			"🔥 Presente grande → ULTRAPASSAGEM",
			"🛢️ Alguns presentes → ÓLEO na pista",
		],
		feedJoin: (name) => `🚗 ${name} ENTROU NA PISTA!`,
		feedLike: (name, n) => `⚡ ${name} turbinou (+${n} likes)`,
		feedShare: (name) => `📣 ${name} compartilhou! (+turbo)`,
		feedNitro: (name) => `⚡ ${name} ativou o NITRO!`,
		feedTurbo: (name) => `🚀 ${name} ativou o TURBO!`,
		feedOvertake: (name) => `🔥 ${name} deu ULTRAPASSAGEM!`,
		feedOil: (name) => `🛢️ ${name} jogou ÓLEO na pista!`,
		feedSpin: (name) => `💫 ${name} derrapou no óleo!`,
		feedTimeout: "⏰ Tempo esgotado!",
		feedWinner: (name) => `🏆 ${name} VENCEU!`,
		winnerTitle: "VENCEU!",
		winnerSubtitle: (kmh, likes, gifts) =>
			`${kmh} km/h • ❤️ ${likes} likes • 🎁 ${gifts} presentes`,
		leaderboardTitle: "POSIÇÕES",
		noCars: "Nenhum carro ainda...",
	},

	// ==========================================
	// TRACK
	// ==========================================
	/** Distance (world units) a car must reach to win */
	finishLine: 1000,
	/** Lanes on the road (max cars racing side by side) */
	lanes: 8,
	/** Max cars on track; when full, the car furthest behind is removed */
	maxCars: 24,
	/** Starting grid spacing (world units, cars start at negative distance) */
	gridColumnGap: 46,
	gridStartOffset: 18,

	// ==========================================
	// RACE PHASES & TIMING (ms)
	// ==========================================
	phases: {
		/** Waiting for the first comment to start the countdown */
		waiting: { duration: Infinity },
		/** Countdown before the race starts */
		countdown: { duration: 10_000 },
		/** Max race length (failsafe — leader wins on timeout) */
		racing: { duration: 150_000 },
		/** Winner celebration */
		finished: { duration: 8_000 },
		/** Pause before next race */
		cooldown: { duration: 5_000 },
	},

	// ==========================================
	// SPEED MODEL (world units per second)
	// ==========================================
	speed: {
		/** Cruising speed when the race starts */
		base: 16,
		/** Likes needed to fill the turbo bar */
		likeMeterCap: 150,
		/** Extra speed (u/s) when the turbo bar is full */
		maxLikeBonus: 14,
		/** Turbo bar decay per second (likes * this amount) */
		likeDecayPerSec: 0.01,
		/** A share counts as this many likes */
		shareLikeValue: 5,
		/** Soft speed cap so the km/h plate stays sane */
		kmhFactor: 4.2,
		kmhCap: 320,
	},

	// ==========================================
	// GIFT EFFECTS
	// ==========================================
	effects: {
		nitro: {
			speedBonus: 30, // u/s
			durationMs: 2_400,
			power: 1, // start-line power when sent during countdown
		},
		turbo: {
			speedBonus: 45,
			durationMs: 3_600,
			power: 2,
		},
		overtake: {
			/** Units gained ahead of the car in front (during racing) */
			overtakeMargin: 12,
			/** Units gained when already leading */
			leadGain: 20,
			/** Overtake can never push a car past this fraction of the track */
			maxProgress: 0.97,
			durationMs: 0,
			speedBonus: 0,
			power: 3,
		},
		oil: {
			/** Slick lifetime on the road */
			slickLifeMs: 20_000,
			/** How long a car spins after touching a slick */
			spinMs: 1_600,
			/** Slick is dropped this many units behind the sender */
			dropBehind: 10,
			/** Max slicks on the road at once */
			maxSlicks: 6,
		},
	},

	// ==========================================
	// GIFT → EFFECT RESOLUTION
	// ==========================================
	/**
	 * Gift name overrides (checked before the value tiers).
	 * Example: { "Ice Cream Cone": "oil", "Rose": "nitro" }
	 * Use /debug.html to find exact gift names on your stream.
	 */
	byName: {},

	/** Resolve a gift's effect from its diamond value. */
	effectForValue(value) {
		if (value >= 100) return "overtake";
		if (value >= 10) return "turbo";
		return "nitro";
	},

	/** Resolve the effect for a gift event (name first, then value). */
	effectForGift(giftName, giftValue) {
		const key = (giftName || "").toLowerCase().trim();
		if (key) {
			const match = Object.keys(this.byName).find(
				(name) => name.toLowerCase().trim() === key,
			);
			if (match) return this.byName[match];
		}
		return this.effectForValue(giftValue || 1);
	},

	// ==========================================
	// CARS
	// ==========================================
	/** Car body colors (assigned round-robin to new drivers) */
	colors: [
		"#fe2c55",
		"#25f4ee",
		"#ffd700",
		"#44dd44",
		"#ff8c42",
		"#b06bff",
		"#4aa8ff",
		"#ff69b4",
		"#f4f4f4",
		"#8bc34a",
		"#ff5555",
		"#00c2a8",
		"#c9a227",
		"#7c4dff",
	],

	/** Assign the next car color (keeps a rotating index on config). */
	nextColor() {
		this._colorIdx = ((this._colorIdx ?? -1) + 1) % this.colors.length;
		return this.colors[this._colorIdx];
	},

	/** Reset color rotation (called on engine reset). */
	resetColors() {
		this._colorIdx = -1;
	},
};

// Make available in both module and browser global contexts
if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
} else {
	window.CORRIDA_CONFIG = CONFIG;
}
