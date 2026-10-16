/**
 * config.js
 * Pipa Arena — game configuration.
 *
 * MECHANICS (TikTok Live interaction):
 * - Comment → viewer launches a kite; comments on an already-flying kite tug it
 *   higher (one kite per viewer at a time).
 * - Like    → big pull on the viewer's own kite (altitude boost).
 * - Gift    → cuts the line of rival kites (highest first), scaled by diamond value:
 *                small  (< 10 💎)  → cuts 1 line
 *                medium (10-99 💎) → cuts 2 lines
 *                large  (100+ 💎)  → cuts 3 lines
 *             Combos (repeatCount) cut extra lines.
 * - Kites land gracefully after `lifeMs` (survival points) and can be relaunched.
 * - When the round ends, the highest score "owns the sky". Rounds loop forever.
 *
 * CUSTOMIZING:
 * - All player-facing strings live in `ui`.
 *
 * @module games/pipa/config
 */

const CONFIG = {
	// ==========================================
	// UI STRINGS (portuguese by default)
	// ==========================================
	ui: {
		title: "Pipa Arena",
		waiting: "💬 COMENTE PRA SOLTAR SUA PIPA!",
		countdown: "⏳ A ARENA ABRE EM...",
		racing: "🪁 CORTA A LINHA DOS RIVAIS!",
		finished: "🏆 DONO DO CÉU!",
		cooldown: "⏳ PRÓXIMA RODADA EM...",
		legendTitle: "COMO JOGAR",
		legend: [
			"💬 Comente → solta sua pipa",
			"❤️ Like → puxa sua pipa pra cima",
			"✂️ Presente → corta a linha do rival",
			"🏆 Quem pontua mais domina o céu!",
		],
		feedLaunch: (name) => `🪁 ${name} soltou uma pipa!`,
		feedTug: (name) => `💬 ${name} puxou a linha!`,
		feedLikeBig: (name, n) => `⚡ ${name} puxou forte (+${n} likes)`,
		feedCut: (name, cuts, victims) =>
			`✂️ ${name} cortou ${cuts} pipa${cuts > 1 ? "s" : ""}${
				victims ? ` de ${victims}` : ""
			}!`,
		feedNoTarget: (name) => `✂️ ${name} tentou cortar... céu vazio!`,
		feedWinner: (name) => `🏆 ${name} DOMINOU O CÉU!`,
		winnerTitle: "DOMINOU O CÉU!",
		winnerSubtitle: (points, cuts) =>
			`${points} pontos • ✂️ ${cuts} linha${cuts === 1 ? "" : "s"} cortada${
				cuts === 1 ? "" : "s"
			}`,
		leaderboardTitle: "CEIFADORES",
		skyLabel: "PIPAS NO CÉU",
		noLeaders: "Solte a primeira pipa!",
	},

	// ==========================================
	// WORLD (unit space, renderer scales to screen)
	// ==========================================
	world: {
		width: 1000,
		/** Max altitude above the ground */
		ceiling: 430,
	},

	// ==========================================
	// KITE BEHAVIOR
	// ==========================================
	kite: {
		/** Rise speed (units/second) */
		riseSpeed: 26,
		/** Altitude gained per like */
		liftPerLike: 7,
		/** Cap per single like event */
		maxLiftPerEvent: 70,
		/** Altitude gained when the owner comments again */
		tugPerComment: 10,
		/** Kite lands gracefully after this (owner earns survival points) */
		lifeMs: 60_000,
		/** Horizontal sway */
		swayAmplitude: 16,
		swaySpeed: 0.7,
		/** Launch X range */
		minX: 90,
		maxX: 910,
	},

	// ==========================================
	// CUTTING (gifts)
	// ==========================================
	cut: {
		/** Points awarded per line cut */
		pointsPerCut: 10,
		/** Points awarded when your kite lands on its own */
		survivePoints: 5,
		/** Hard cap of cuts per single gift */
		maxCuts: 8,
		/** Max kites cut from the same victim per single gift */
		maxPerVictim: 2,
		/** Resolve how many lines a gift cuts. */
		cutsFor(giftValue, repeatCount) {
			const base = giftValue >= 100 ? 3 : giftValue >= 10 ? 2 : 1;
			const combo = Math.min(Math.max(repeatCount || 1, 1), 3) - 1;
			return Math.min(base + combo, 8);
		},
	},

	// ==========================================
	// ROUND PHASES & TIMING (ms)
	// ==========================================
	phases: {
		/** Waiting for the first kite */
		waiting: { duration: Infinity },
		/** Arena warm-up before the round starts */
		countdown: { duration: 5_000 },
		/** Round length (highest score wins on timeout) */
		racing: { duration: 90_000 },
		/** Winner celebration */
		finished: { duration: 8_000 },
		/** Pause before next round */
		cooldown: { duration: 5_000 },
	},

	/** A round can end early (last kite standing) only after this long */
	minRoundBeforeLastStanding: 20_000,

	// ==========================================
	// KITE COLORS (assigned in rotation)
	// ==========================================
	colors: [
		"#fe2c55",
		"#25f4ee",
		"#ffd700",
		"#7cff6b",
		"#ff8c42",
		"#b06bff",
		"#4aa8ff",
		"#ff69b4",
		"#f4f4f4",
		"#00e0a4",
		"#ff5555",
		"#c9a227",
	],

	/** Assign the next kite color (keeps a rotating index on config). */
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
	window.PIPA_CONFIG = CONFIG;
}
