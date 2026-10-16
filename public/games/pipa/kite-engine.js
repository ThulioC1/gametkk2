/**
 * kite-engine.js
 * Pure state machine for Pipa Arena.
 * NO DOM, NO Canvas — data in, state out. The renderer (game.js) draws state.
 *
 * Flow: WAITING → COUNTDOWN → RACING → FINISHED → COOLDOWN → (reset) → WAITING
 *
 * Interaction:
 * - comment → launch a kite (or tug your flying kite higher)
 * - like    → pull your own kite up
 * - gift    → cut rival lines (highest first), scaled by diamond value
 *
 * Time is injectable: every method accepts an optional `now` (ms) so the
 * engine can be simulated deterministically.
 *
 * @module games/pipa/kite-engine
 */

class PipaEngine {
	/**
	 * @param {Object} config - PIPA_CONFIG from config.js
	 */
	constructor(config) {
		this.config = config;
		this.listeners = {};
		this.lastTick = null;
		this.nextKiteId = 1;
		this.reset(Date.now());
	}

	// ==========================================
	// STATE
	// ==========================================

	/**
	 * Reset for a brand new round (sky is cleared).
	 * @param {number} [now]
	 */
	reset(now = Date.now()) {
		this.config.resetColors();
		this.state = {
			phase: "waiting",
			phaseStartedAt: now,
			raceStartedAt: null,
			raceCount: this.state?.raceCount ?? 0,
			kites: [],
			pieces: [],
			roster: new Map(), // uniqueId → { name, color, points, cuts, flights }
			fx: [],
			feed: [],
			feedSeq: 0,
			fxSeq: 0,
			winner: null,
			totalLaunched: 0,
		};
		this._emit("phaseChange", { phase: "waiting" });
	}

	/** Time elapsed in current phase (ms) */
	phaseElapsed(now = Date.now()) {
		return now - this.state.phaseStartedAt;
	}

	/** Time remaining in current phase (ms), or Infinity */
	phaseRemaining(now = Date.now()) {
		const dur = this.config.phases[this.state.phase]?.duration ?? Infinity;
		if (dur === Infinity) return Infinity;
		return Math.max(0, dur - this.phaseElapsed(now));
	}

	/** Roster sorted by score (for leaderboards). */
	leaders(limit = 6) {
		return [...this.state.roster.values()]
			.sort((a, b) => b.points - a.points || b.cuts - a.cuts)
			.slice(0, limit);
	}

	// ==========================================
	// EVENT HANDLERS (called by game.js)
	// ==========================================

	/**
	 * Chat message → launch a kite, or tug the one already flying.
	 * @param {{user: {uniqueId: string, nickname: string}, comment: string}} data
	 * @param {number} [now]
	 */
	handleChat(data, now = Date.now()) {
		if (!this._canJoin()) return;
		const user = data.user;
		if (!user?.uniqueId) return;

		const flying = this.state.kites.find((k) => k.uniqueId === user.uniqueId);
		if (flying) {
			flying.y = Math.min(this.config.world.ceiling, flying.y + this.config.kite.tugPerComment);
			this._addFx("tug", flying);
			return;
		}

		const kite = this._launch(user, now);
		this._addFeed("launch", this.config.ui.feedLaunch(kite.name));
	}

	/**
	 * Like → pulls the viewer's own kite upward.
	 * @param {{user: {uniqueId: string, nickname: string}, likeCount: number}} data
	 * @param {number} [now]
	 */
	handleLike(data, now = Date.now()) {
		const kite = this.state.kites.find(
			(k) => k.uniqueId === data.user?.uniqueId,
		);
		if (!kite) return;

		const count = Math.max(1, data.likeCount || 1);
		const lift = Math.min(
			count * this.config.kite.liftPerLike,
			this.config.kite.maxLiftPerEvent,
		);
		kite.y = Math.min(this.config.world.ceiling, kite.y + lift);
		this._addFx("lift", kite);
		if (count >= 10) {
			this._addFeed("like", this.config.ui.feedLikeBig(kite.name, count));
		}
	}

	/**
	 * Gift → cuts rival kite lines (highest flying first).
	 * @param {{user: Object, giftName: string, giftValue: number, repeatCount: number}} data
	 * @param {number} [now]
	 */
	handleGift(data, now = Date.now()) {
		if (!this._canJoin()) return;
		const user = data.user;
		if (!user?.uniqueId) return;

		const rosterEntry = this._rosterOf(user);
		const totalCuts = this.config.cut.cutsFor(
			data.giftValue || 1,
			data.repeatCount || 1,
		);

		// Highest kites first, at most maxPerVictim per owner
		const perVictim = new Map();
		const victims = this.state.kites
			.filter((k) => k.uniqueId !== user.uniqueId)
			.sort((a, b) => b.y - a.y)
			.filter((k) => {
				const count = perVictim.get(k.uniqueId) || 0;
				if (count >= this.config.cut.maxPerVictim) return false;
				perVictim.set(k.uniqueId, count + 1);
				return true;
			})
			.slice(0, totalCuts);

		if (!victims.length) {
			this._addFeed("cut", this.config.ui.feedNoTarget(rosterEntry.name));
			return;
		}

		const victimNames = [...new Set(victims.map((k) => k.name))].slice(0, 3);
		for (const kite of victims) {
			this._cutKite(kite);
		}

		rosterEntry.cuts += victims.length;
		rosterEntry.points += victims.length * this.config.cut.pointsPerCut;

		this._addFeed(
			"cut",
			this.config.ui.feedCut(
				rosterEntry.name,
				victims.length,
				victimNames.join(" e "),
			),
		);
	}

	// ==========================================
	// TICK — call from requestAnimationFrame
	// ==========================================

	/**
	 * Advance simulation. Handles phase timeouts, kite motion, landings.
	 * @param {number} [now]
	 */
	tick(now = Date.now()) {
		const dt =
			this.lastTick === null
				? 0
				: Math.min((now - this.lastTick) / 1000, 1); // clamp long frames
		this.lastTick = now;

		const { phase } = this.state;

		if (phase === "countdown" && this.phaseRemaining(now) <= 0) {
			this._startRound(now);
		} else if (phase === "racing" && this.phaseRemaining(now) <= 0) {
			this._endRound(now, "timeout");
		} else if (phase === "finished" && this.phaseRemaining(now) <= 0) {
			this._setPhase("cooldown", now);
		} else if (phase === "cooldown" && this.phaseRemaining(now) <= 0) {
			this.state.raceCount += 1;
			this.reset(now);
			this.lastTick = now;
			return this.state;
		}

		if (this.state.phase === "racing" || this.state.phase === "countdown") {
			this._moveKites(dt, now);
		}
		this._movePieces(dt);

		// Last kite standing can win the round early
		if (
			this.state.phase === "racing" &&
			this.state.kites.length <= 1 &&
			this.phaseElapsed(now) > this.config.minRoundBeforeLastStanding
		) {
			this._endRound(now, "last-standing");
		}

		return this.state;
	}

	// ==========================================
	// INTERNAL — ROUND FLOW
	// ==========================================

	/** @private */
	_canJoin() {
		const phase = this.state.phase;
		return phase === "waiting" || phase === "countdown" || phase === "racing";
	}

	/** @private */
	_setPhase(phase, now) {
		this.state.phase = phase;
		this.state.phaseStartedAt = now;
		this._emit("phaseChange", { phase });
	}

	/** @private */
	_startRound(now) {
		this.state.raceStartedAt = now;
		this._setPhase("racing", now);
	}

	/** @private */
	_endRound(now, reason) {
		const leaders = this.leaders(1);
		const champion = leaders[0];

		if (!champion) {
			// Nobody scored — just go back to waiting
			this.state.raceCount += 1;
			this.reset(now);
			this.lastTick = now;
			return;
		}

		this.state.winner = {
			uniqueId: champion.uniqueId,
			name: champion.name,
			color: champion.color,
			points: champion.points,
			cuts: champion.cuts,
			reason,
		};
		this._addFeed("winner", this.config.ui.feedWinner(champion.name));
		this._setPhase("finished", now);
		this._emit("winner", this.state.winner);
	}

	// ==========================================
	// INTERNAL — KITES
	// ==========================================

	/** @private */
	_launch(user, now) {
		const kite = {
			id: this.nextKiteId++,
			uniqueId: user.uniqueId,
			name: String(user.nickname || user.uniqueId).slice(0, 16),
			color: this.config.nextColor(),
			targetX:
				this.config.kite.minX +
				Math.random() * (this.config.kite.maxX - this.config.kite.minX),
			x: 0,
			y: 8,
			seed: Math.random() * Math.PI * 2,
			lifeLeft: this.config.kite.lifeMs,
			launchedAt: now,
		};
		kite.x = kite.targetX;
		this.state.kites.push(kite);
		this.state.totalLaunched += 1;

		const rosterEntry = this._rosterOf(user);
		rosterEntry.flights += 1;
		if (rosterEntry.color === null) rosterEntry.color = kite.color;

		this._addFx("launch", kite);

		// First kite wakes the round
		if (this.state.phase === "waiting") {
			this._setPhase("countdown", now);
		}
		return kite;
	}

	/** @private — cut one kite: it becomes a falling piece */
	_cutKite(kite) {
		this.state.kites = this.state.kites.filter((k) => k !== kite);
		this.state.pieces.push({
			x: kite.x,
			y: kite.y,
			vx: (Math.random() - 0.5) * 40,
			fallSpeed: 30,
			rot: 0,
			rotV: (Math.random() - 0.5) * 3,
			alpha: 1,
			color: kite.color,
			name: kite.name,
		});
		this._addFx("cut", kite);
	}

	/** @private */
	_moveKites(dt, now) {
		const { world, kite: K } = this.config;
		const t = now / 1000;

		for (const kite of [...this.state.kites]) {
			// Rise
			kite.y = Math.min(world.ceiling, kite.y + K.riseSpeed * dt);
			// Sway around the anchor X
			kite.x = Math.max(
				20,
				Math.min(
					world.width - 20,
					kite.targetX + Math.sin(t * K.swaySpeed + kite.seed) * K.swayAmplitude,
				),
			);

			// Lifespan → graceful landing (survival points)
			kite.lifeLeft -= dt * 1000;
			if (kite.lifeLeft <= 0) {
				this.state.kites = this.state.kites.filter((k) => k !== kite);
				this._awardSurvival(kite);
				this._addFx("land", kite);
			}
		}
	}

	/** @private */
	_awardSurvival(kite) {
		const entry = this.state.roster.get(kite.uniqueId);
		if (entry) entry.points += this.config.cut.survivePoints;
	}

	/** @private */
	_movePieces(dt) {
		for (const piece of this.state.pieces) {
			piece.fallSpeed += 320 * dt;
			piece.y -= piece.fallSpeed * dt;
			piece.x += piece.vx * dt;
			piece.rot += piece.rotV * dt;
			if (piece.y < 60) piece.alpha = Math.max(0, piece.alpha - dt * 0.9);
		}
		this.state.pieces = this.state.pieces.filter((p) => p.y > -30);
	}

	/** @private */
	_rosterOf(user) {
		if (!this.state.roster.has(user.uniqueId)) {
			this.state.roster.set(user.uniqueId, {
				uniqueId: user.uniqueId,
				name: String(user.nickname || user.uniqueId).slice(0, 16),
				color: null,
				points: 0,
				cuts: 0,
				flights: 0,
			});
		}
		return this.state.roster.get(user.uniqueId);
	}

	// ==========================================
	// INTERNAL — FEED / FX
	// ==========================================

	/** @private */
	_addFeed(type, text) {
		this.state.feedSeq += 1;
		this.state.feed.unshift({ seq: this.state.feedSeq, type, text });
		if (this.state.feed.length > 14) this.state.feed.length = 14;
	}

	/** @private */
	_addFx(kind, kite) {
		this.state.fxSeq += 1;
		this.state.fx.push({
			seq: this.state.fxSeq,
			kind,
			x: kite.x,
			y: kite.y,
			color: kite.color,
		});
		if (this.state.fx.length > 40) this.state.fx.shift();
	}

	// ==========================================
	// EVENT EMITTER (simple)
	// ==========================================

	on(event, fn) {
		(this.listeners[event] ??= []).push(fn);
	}

	_emit(event, data) {
		(this.listeners[event] || []).forEach((fn) => {
			try {
				fn(data);
			} catch (e) {
				console.error(`[PipaEngine] Error in ${event} listener:`, e);
			}
		});
	}
}

// Export for browser global
if (typeof module !== "undefined" && module.exports) {
	module.exports = PipaEngine;
} else {
	window.PipaEngine = PipaEngine;
}
