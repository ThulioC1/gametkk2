/**
 * race-engine.js
 * Pure state machine for Corrida na Live.
 * NO DOM, NO Canvas — data in, state out. The renderer (game.js) draws state.
 *
 * Flow: WAITING → COUNTDOWN → RACING → FINISHED → COOLDOWN → (reset) → WAITING
 *
 * Interaction:
 * - comment        → viewer joins with a car
 * - like / share   → persistent speed bonus (turbo bar)
 * - gift           → nitro / turbo / overtake / oil, scaled by diamond value
 *
 * Time is injectable: every method accepts an optional `now` (ms) so the
 * engine can be simulated deterministically.
 *
 * @module games/corrida/race-engine
 */

class CorridaEngine {
	/**
	 * @param {Object} config - CORRIDA_CONFIG from config.js
	 */
	constructor(config) {
		this.config = config;
		this.listeners = {};
		this.lastTick = null;
		this.nextCarNumber = 1;
		this.kmhFactor = config.speed.kmhFactor;
		this.kmhCap = config.speed.kmhCap;
		this.reset(Date.now());
	}

	// ==========================================
	// STATE
	// ==========================================

	/**
	 * Reset for a brand new race (cars leave the track).
	 * @param {number} [now]
	 */
	reset(now = Date.now()) {
		this.config.resetColors();
		this.state = {
			phase: "waiting",
			phaseStartedAt: now,
			raceStartedAt: null,
			raceCount: this.state?.raceCount ?? 0,
			cars: [],
			oils: [],
			fx: [],
			feed: [],
			feedSeq: 0,
			fxSeq: 0,
			winner: null,
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

	/** Cars ordered by current standing (finished cars keep their place). */
	standings() {
		return [...this.state.cars].sort((a, b) => {
			if (a.place && b.place) return a.place - b.place;
			if (a.place) return -1;
			if (b.place) return 1;
			return b.dist - a.dist;
		});
	}

	/** km/h shown on the car plate */
	kmhOf(car) {
		return Math.min(this.kmhCap, Math.round(car.speed * this.kmhFactor));
	}

	// ==========================================
	// EVENT HANDLERS (called by game.js)
	// ==========================================

	/**
	 * Chat message → viewer enters the race (or is already in).
	 * @param {{user: {uniqueId: string, nickname: string}, comment: string}} data
	 * @param {number} [now]
	 */
	handleChat(data, now = Date.now()) {
		if (!this._canJoin()) return;
		const car = this._carOf(data.user) || this._addCar(data.user, now);
		if (car) this._addFeed("chat", this.config.ui.feedJoin(car.name));
	}

	/**
	 * Like → fills the driver's turbo bar (persistent speed bonus).
	 * @param {{user: {uniqueId: string, nickname: string}, likeCount: number}} data
	 * @param {number} [now]
	 */
	handleLike(data, now = Date.now()) {
		const car = this._carOf(data.user);
		if (!car) return;

		const count = Math.max(1, data.likeCount || 1);
		car.likes += count;
		if (count >= 10) {
			this._addFeed("like", this.config.ui.feedLike(car.name, count));
		}
	}

	/**
	 * Share → counts as a like bundle for the sharer's car.
	 * @param {{user: {uniqueId: string, nickname: string}}} data
	 * @param {number} [now]
	 */
	handleShare(data, now = Date.now()) {
		const car = this._carOf(data.user);
		if (!car) return;
		car.likes += this.config.speed.shareLikeValue;
		this._addFeed("share", this.config.ui.feedShare(car.name));
	}

	/**
	 * Gift → instant effect resolved from gift name / diamond value.
	 * @param {{user: Object, giftName: string, giftValue: number, repeatCount: number}} data
	 * @param {number} [now]
	 */
	handleGift(data, now = Date.now()) {
		if (!this._canJoin()) return;

		const car = this._carOf(data.user) || this._addCar(data.user, now);
		if (!car) return;

		car.gifts += 1;
		const effect = this.config.effectForGift(data.giftName, data.giftValue);
		const repeat = Math.min(Math.max(data.repeatCount || 1, 1), 3);
		const phase = this.state.phase;

		// During the countdown, gifts build a head start for the green light.
		if (phase === "waiting" || phase === "countdown") {
			const power = this.config.effects[effect]?.power ?? 1;
			car.startPower = Math.min(car.startPower + power * repeat, 6);
			this._addFx(effect, car);
			this._addFeed("gift", this._effectFeedText(effect, car.name));
			return;
		}

		if (phase !== "racing") return;

		if (effect === "overtake") {
			this._applyOvertake(car, repeat);
			this._addFx("overtake", car);
			this._addFeed("gift", this.config.ui.feedOvertake(car.name));
			return;
		}

		if (effect === "oil") {
			this._dropOil(car, repeat, now);
			this._addFx("oil", car);
			this._addFeed("gift", this.config.ui.feedOil(car.name));
			return;
		}

		// nitro / turbo → temporary speed burst (repeat extends duration)
		const spec = this.config.effects[effect] || this.config.effects.nitro;
		const duration = Math.min(spec.durationMs + (repeat - 1) * 700, 6_000);
		car.boostBonus = Math.max(car.boostBonus, spec.speedBonus);
		car.boostUntil = Math.max(car.boostUntil, now + duration);
		this._addFx(effect, car);
		this._addFeed("gift", this._effectFeedText(effect, car.name));
	}

	// ==========================================
	// TICK — call from requestAnimationFrame
	// ==========================================

	/**
	 * Advance simulation. Handles phase timeouts, movement, effects.
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
			this._startRace(now);
		} else if (phase === "racing" && this.phaseRemaining(now) <= 0) {
			this._resolveTimeout(now);
		} else if (phase === "finished" && this.phaseRemaining(now) <= 0) {
			this._setPhase("cooldown", now);
		} else if (phase === "cooldown" && this.phaseRemaining(now) <= 0) {
			this.state.raceCount += 1;
			this.reset(now);
			this.lastTick = now;
			return this.state;
		}

		if (this.state.phase === "racing") {
			this._moveCars(dt, now);
		}

		// Age out old road slicks
		if (this.state.oils.length) {
			this.state.oils = this.state.oils.filter((o) => now < o.until);
		}

		return this.state;
	}

	// ==========================================
	// INTERNAL — RACE FLOW
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

	/** @private — green light: countdown power becomes a real speed boost */
	_startRace(now) {
		this.state.raceStartedAt = now;
		for (const car of this.state.cars) {
			if (car.startPower > 0) {
				car.boostBonus = Math.max(car.boostBonus, car.startPower * 9);
				car.boostUntil = Math.max(car.boostUntil, now + 4_000);
				car.startPower = 0;
				this._addFx("go", car);
			}
		}
		this._setPhase("racing", now);
	}

	/** @private — nobody crossed the line: leader wins on time */
	_resolveTimeout(now) {
		const leader = this.standings()[0];
		if (leader) {
			this._finishRace(leader, now);
		} else {
			this._setPhase("finished", now);
		}
	}

	/** @private — first car to cross the line wins */
	_checkFinish(now) {
		const crossed = this.state.cars.filter(
			(c) => !c.place && c.dist >= this.config.finishLine,
		);
		if (!crossed.length) return;

		// Tie-break inside the same frame: the car that was furthest along
		// when the frame started (entryDist) crossed first.
		crossed.sort((a, b) => b.entryDist - a.entryDist || b.speed - a.speed);
		this._finishRace(crossed[0], now);

		// Everyone else keeps their current standing
		let place = 2;
		for (const car of this.standings()) {
			if (car.place) continue;
			car.place = place;
			place += 1;
		}
	}

	/** @private */
	_finishRace(winner, now) {
		winner.place = 1;
		this.state.winner = {
			uniqueId: winner.uniqueId,
			name: winner.name,
			color: winner.color,
			number: winner.number,
			kmh: this.kmhOf(winner),
			likes: Math.round(winner.likes),
			gifts: winner.gifts,
			timeSec: this.state.raceStartedAt
				? Math.round(((now - this.state.raceStartedAt) / 1000) * 100) / 100
				: 0,
		};
		this._addFeed("winner", this.config.ui.feedWinner(winner.name));
		this._setPhase("finished", now);
		this._emit("winner", this.state.winner);
	}

	// ==========================================
	// INTERNAL — MOVEMENT & EFFECTS
	// ==========================================

	/** @private */
	_moveCars(dt, now) {
		const { speed: S, finishLine } = this.config;

		for (const car of this.state.cars) {
			if (car.place) continue;

			// Likes decay slowly: a like is worth the whole race
			car.likes = Math.max(0, car.likes * (1 - S.likeDecayPerSec * dt));

			const likeBonus =
				(Math.min(car.likes, S.likeMeterCap) / S.likeMeterCap) *
				S.maxLikeBonus;
			const boost = now < car.boostUntil ? car.boostBonus : 0;
			car.speed = now < car.spinUntil ? 0 : S.base + likeBonus + boost;

			const prevDist = car.dist;
			car.dist += car.speed * dt;
			car.entryDist = prevDist;

			// Oil slicks spin out whoever crosses them
			for (const slick of this.state.oils) {
				if (
					prevDist < slick.dist &&
					car.dist >= slick.dist &&
					now < slick.until
				) {
					car.spinUntil = now + this.config.effects.oil.spinMs;
					car.boostBonus = 0;
					car.boostUntil = 0;
					slick.until = 0;
					this._addFx("spin", car);
					this._addFeed("spin", this.config.ui.feedSpin(car.name));
					break;
				}
			}
		}

		this._checkFinish(now);
	}

	/** @private — jump ahead of the car in front (never through the finish line) */
	_applyOvertake(car, repeat = 1) {
		const { overtake } = this.config.effects;
		const cap = this.config.finishLine * overtake.maxProgress;
		const margin = overtake.overtakeMargin + (repeat - 1) * 6;
		const leadGain = overtake.leadGain + (repeat - 1) * 6;
		const ahead = this.state.cars
			.filter((c) => c !== car && !c.place && c.dist > car.dist)
			.sort((a, b) => a.dist - b.dist)[0];

		const target = ahead
			? Math.min(ahead.dist + margin, cap)
			: Math.min(car.dist + leadGain, cap);

		car.dist = Math.max(car.dist, target);
	}

	/** @private */
	_dropOil(car, repeat, now) {
		const { oil } = this.config.effects;
		for (let i = 0; i < repeat; i += 1) {
			this.state.oils.push({
				dist: Math.max(car.dist - oil.dropBehind - i * 8, -40),
				until: now + oil.slickLifeMs,
				owner: car.uniqueId,
			});
		}
		if (this.state.oils.length > oil.maxSlicks) {
			this.state.oils.splice(0, this.state.oils.length - oil.maxSlicks);
		}
	}

	/** @private */
	_effectFeedText(effect, name) {
		const ui = this.config.ui;
		if (effect === "turbo") return ui.feedTurbo(name);
		if (effect === "overtake") return ui.feedOvertake(name);
		if (effect === "oil") return ui.feedOil(name);
		return ui.feedNitro(name);
	}

	// ==========================================
	// INTERNAL — CARS
	// ==========================================

	/** @private */
	_carOf(user) {
		const uniqueId = user?.uniqueId;
		if (!uniqueId) return null;
		return this.state.cars.find((c) => c.uniqueId === uniqueId) || null;
	}

	/** @private */
	_addCar(user, now) {
		if (this.state.cars.length >= this.config.maxCars) {
			// Track is full: the car furthest behind leaves
			const behind = [...this.state.cars].sort((a, b) => a.dist - b.dist)[0];
			if (behind) {
				this.state.cars = this.state.cars.filter((c) => c !== behind);
				this._addFeed(
					"leave",
					`🚪 ${behind.name} saiu da pista (pista cheia)`,
				);
			}
		}

		const index = this.state.cars.length;
		const lane = index % this.config.lanes;
		const column = Math.floor(index / this.config.lanes);

		const car = {
			uniqueId: user.uniqueId,
			name: String(user.nickname || user.uniqueId).slice(0, 18),
			number: (this.nextCarNumber++ % 99) + 1,
			lane,
			color: this.config.nextColor(),
			dist: -(
				column * this.config.gridColumnGap + this.config.gridStartOffset
			),
			speed: 0,
			entryDist: 0,
			likes: 0,
			gifts: 0,
			boostBonus: 0,
			boostUntil: 0,
			spinUntil: 0,
			startPower: 0,
			place: 0,
		};

		this.state.cars.push(car);

		// First driver wakes the race
		if (this.state.phase === "waiting") {
			this._setPhase("countdown", now);
		}
		return car;
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
	_addFx(kind, car) {
		this.state.fxSeq += 1;
		this.state.fx.push({ seq: this.state.fxSeq, kind, carId: car.uniqueId });
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
				console.error(`[CorridaEngine] Error in ${event} listener:`, e);
			}
		});
	}
}

// Export for browser global
if (typeof module !== "undefined" && module.exports) {
	module.exports = CorridaEngine;
} else {
	window.CorridaEngine = CorridaEngine;
}
