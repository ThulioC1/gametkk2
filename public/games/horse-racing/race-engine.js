/**
 * race-engine.js
 * Pure state machine for Horse Racing.
 * NO DOM, NO Canvas — just data in, state out.
 * The renderer (game.js) reads state and draws.
 *
 * Phases: WAITING → COUNTDOWN → RACING → FINISHED → COOLDOWN → WAITING
 *
 * @module games/horse-racing/race-engine
 */

class RaceEngine {
	/**
	 * @param {Object} config - RACE_CONFIG from config.js
	 */
	constructor(config) {
		this.config = config;
		this.listeners = {};
		this.reset();
	}

	// ==========================================
	// STATE
	// ==========================================

	reset() {
		const laneCount = this.config.lanes.length;
		this.state = {
			phase: "waiting",
			phaseStartedAt: Date.now(),
			lanes: this.config.lanes.map((lane) => ({
				...lane,
				distance: 0,
				supporters: new Map(), // uniqueId → { nickname, totalContrib }
			})),
			winner: null,
			raceCount: this.state?.raceCount || 0,
			recentEvents: [], // last N events for HUD feed
		};
		this._emit("phaseChange", { phase: "waiting" });
	}

	// ==========================================
	// PHASE TRANSITIONS
	// ==========================================

	/**
	 * Advance phase. Called by a tick loop or event trigger.
	 * @param {string} nextPhase
	 */
	_setPhase(nextPhase) {
		this.state.phase = nextPhase;
		this.state.phaseStartedAt = Date.now();
		this._emit("phaseChange", { phase: nextPhase });
	}

	/** Time elapsed in current phase (ms) */
	phaseElapsed() {
		return Date.now() - this.state.phaseStartedAt;
	}

	/** Time remaining in current phase (ms), or Infinity */
	phaseRemaining() {
		const dur = this.config.phases[this.state.phase]?.duration ?? Infinity;
		if (dur === Infinity) return Infinity;
		return Math.max(0, dur - this.phaseElapsed());
	}

	// ==========================================
	// TICK — call from requestAnimationFrame
	// ==========================================

	/**
	 * Main update tick. Handles phase timeouts / auto-transitions.
	 * Returns current state for rendering.
	 */
	tick() {
		const { phase } = this.state;
		const remaining = this.phaseRemaining();

		if (phase === "countdown" && remaining <= 0) {
			this._setPhase("racing");
		} else if (phase === "racing" && remaining <= 0) {
			// Time limit — pick horse with most distance as winner
			this._resolveWinner();
		} else if (phase === "finished" && remaining <= 0) {
			this._setPhase("cooldown");
		} else if (phase === "cooldown" && remaining <= 0) {
			this.state.raceCount++;
			this.reset();
		}

		return this.state;
	}

	// ==========================================
	// EVENT HANDLERS (called by game.js)
	// ==========================================

	/**
	 * Process a gift event.
	 * @param {{giftId: number, giftValue: number, user: {uniqueId: string, nickname: string}}} data
	 */
	handleGift(data) {
		const { phase } = this.state;

		// In waiting phase, first gift triggers countdown
		if (phase === "waiting") {
			this._setPhase("countdown");
		}

		// During countdown and racing, gifts move horses
		if (phase === "countdown" || phase === "racing") {
			const laneCount = this.state.lanes.length;
			// Name-based mapping (priority) with giftId fallback
			const laneIdx = this.config.giftToLane(data.giftName, data.giftId, laneCount);
			const distance = this.config.giftToDistance(data.giftValue);

			this._moveLane(laneIdx, distance, data.user, data);

			// Check for winner (only during racing)
			if (phase === "racing") {
				this._checkFinish();
			}
		}
	}

	/**
	 * Process a chat event.
	 * If comment matches a country code/alias, move that horse.
	 * @param {{user: {uniqueId: string, nickname: string}, comment: string}} data
	 */
	handleChat(data) {
		const { phase } = this.state;
		const comment = (data.comment || "").trim();

		// Try to match comment to a lane
		const laneIdx = this.config.chatToLane(comment);

		if (laneIdx >= 0) {
			// In waiting phase, first vote triggers countdown
			if (phase === "waiting") {
				this._setPhase("countdown");
			}

			// During countdown and racing, votes move horses
			if (phase === "countdown" || phase === "racing") {
				const distance = this.config.chatDistance || 3;
				const lane = this.state.lanes[laneIdx];

				this._moveLane(laneIdx, distance, data.user, {
					giftName: null,
					_isChat: true,
					_comment: comment,
					_laneFlag: lane?.flag || "",
				});

				// Check for winner (only during racing)
				if (phase === "racing") {
					this._checkFinish();
				}
			}
		} else {
			// Non-matching chat — just add to feed
			this._addRecentEvent({
				type: "chat",
				nickname: data.user.nickname,
				text: comment,
			});
		}
	}

	/**
	 * Process a like event.
	 * @param {{user: {uniqueId: string, nickname: string}, likeCount: number}} data
	 */
	handleLike(data) {
		this._addRecentEvent({
			type: "like",
			nickname: data.user.nickname,
			count: data.likeCount,
		});
	}

	// ==========================================
	// INTERNAL
	// ==========================================

	/**
	 * Move a lane forward and track supporter contribution.
	 * @private
	 */
	_moveLane(laneIdx, distance, user, rawData) {
		const lane = this.state.lanes[laneIdx];
		if (!lane) return;

		lane.distance = Math.min(lane.distance + distance, this.config.finishLine);

		// Track supporter
		const existing = lane.supporters.get(user.uniqueId);
		if (existing) {
			existing.totalContrib += distance;
		} else {
			lane.supporters.set(user.uniqueId, {
				nickname: user.nickname,
				totalContrib: distance,
			});
		}

		if (rawData._isChat) {
			// Chat vote event
			this._addRecentEvent({
				type: "vote",
				nickname: user.nickname,
				laneFlag: lane.flag,
				laneName: lane.name,
				distance,
				comment: rawData._comment,
			});
		} else {
			// Gift event
			this._addRecentEvent({
				type: "gift",
				nickname: user.nickname,
				laneFlag: lane.flag,
				laneName: lane.name,
				distance,
				giftName: rawData.giftName || "",
				giftEmoji: this.config.getGiftEmoji(rawData.giftName),
			});
		}

		this._emit("laneMove", { laneIdx, distance, lane, user });
	}

	/** @private */
	_checkFinish() {
		for (const lane of this.state.lanes) {
			if (lane.distance >= this.config.finishLine) {
				this.state.winner = lane;
				this._setPhase("finished");
				this._emit("raceFinished", { winner: lane });
				return;
			}
		}
	}

	/** @private — fallback when race times out */
	_resolveWinner() {
		let best = this.state.lanes[0];
		for (const lane of this.state.lanes) {
			if (lane.distance > best.distance) best = lane;
		}
		this.state.winner = best;
		this._setPhase("finished");
		this._emit("raceFinished", { winner: best });
	}

	/** @private — keep last 20 events for HUD feed */
	_addRecentEvent(evt) {
		evt.timestamp = Date.now();
		this.state.recentEvents.unshift(evt);
		if (this.state.recentEvents.length > 20) {
			this.state.recentEvents.length = 20;
		}
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
				console.error(`[RaceEngine] Error in ${event} listener:`, e);
			}
		});
	}
}

// Export for browser global
if (typeof module !== "undefined" && module.exports) {
	module.exports = RaceEngine;
} else {
	window.RaceEngine = RaceEngine;
}
