/**
 * game.js
 * Corrida na Live — Canvas renderer + TikTokBridge wiring.
 * Reads state from CorridaEngine and draws the road, cars and HUD.
 *
 * @module games/corrida/game
 */

(() => {
	const config = window.CORRIDA_CONFIG;
	const engine = new window.CorridaEngine(config);

	const canvas = document.getElementById("raceCanvas");
	const ctx = canvas.getContext("2d");

	// DOM HUD elements
	const phaseBanner = document.getElementById("phaseBanner");
	const phaseText = document.getElementById("phaseText");
	const phaseTimer = document.getElementById("phaseTimer");
	const leaderboard = document.getElementById("leaderboard");
	const legendTitle = document.getElementById("legendTitle");
	const legendList = document.getElementById("legendList");
	const eventFeed = document.getElementById("eventFeed");
	const winnerOverlay = document.getElementById("winnerOverlay");
	const winnerName = document.getElementById("winnerName");
	const winnerSub = document.getElementById("winnerSub");
	const winnerColor = document.getElementById("winnerColor");

	// ==========================================
	// SIZING
	// ==========================================
	function resize() {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	}
	window.addEventListener("resize", resize);
	resize();

	// ==========================================
	// BRIDGE → ENGINE WIRING
	// ==========================================
	TikTokBridge.on("chat", (data) => engine.handleChat(data));
	TikTokBridge.on("gift", (data) => engine.handleGift(data));
	TikTokBridge.on("like", (data) => engine.handleLike(data));
	TikTokBridge.on("share", (data) => engine.handleShare(data));

	// ==========================================
	// STATIC HUD (legend)
	// ==========================================
	legendTitle.textContent = config.ui.legendTitle;
	config.ui.legend.forEach((line) => {
		const el = document.createElement("div");
		el.className = "legend-item";
		el.textContent = line;
		legendList.appendChild(el);
	});

	// ==========================================
	// LAYOUT MATH
	// ==========================================
	/** World units visible across the current canvas width */
	const VISIBLE_UNITS = 300;

	function layout() {
		const W = canvas.width;
		const H = canvas.height;
		const trackTop = H * 0.16;
		const trackBottom = H * 0.92;
		const trackHeight = trackBottom - trackTop;
		const laneH = trackHeight / config.lanes;
		const scale = W / VISIBLE_UNITS;
		return { W, H, trackTop, trackBottom, trackHeight, laneH, scale };
	}

	function cameraX(state, scale, W) {
		const leader = state.cars.reduce((best, c) => (c.dist > best ? c.dist : best), 0);
		const racing = state.phase === "racing";
		let cam = leader - (racing ? VISIBLE_UNITS * 0.55 : VISIBLE_UNITS * 0.3);
		cam = Math.max(cam, -140);
		cam = Math.min(cam, config.finishLine - VISIBLE_UNITS * 0.5);
		return cam;
	}

	// ==========================================
	// RENDER LOOP
	// ==========================================
	let lastFeedSeq = -1;
	let lastBoardUpdate = 0;

	function frame() {
		const state = engine.tick();
		draw(state);
		updateHUD(state);
		requestAnimationFrame(frame);
	}

	// ==========================================
	// CANVAS DRAWING
	// ==========================================
	function draw(state) {
		const L = layout();
		const cam = cameraX(state, L.scale, L.W);
		const toX = (dist) => (dist - cam) * L.scale;

		ctx.clearRect(0, 0, L.W, L.H);

		drawRoad(L);
		drawStartLine(L, toX(0));
		drawFinishLine(L, toX(config.finishLine));
		drawOils(state, L, toX);
		drawCars(state, L, toX);
		drawCountdown(state);

		if (state.cars.length === 0) {
			drawWaitingHint(L);
		}
		return cam;
	}

	function drawRoad(L) {
		const { W, trackTop, trackHeight } = L;
		// Asphalt
		ctx.fillStyle = "rgba(24, 26, 32, 0.85)";
		ctx.beginPath();
		ctx.roundRect(0, trackTop - 12, W, trackHeight + 24, 14);
		ctx.fill();

		// Curbs (top/bottom striped edges, subtle)
		const stripe = 26;
		for (let x = 0; x < W; x += stripe * 2) {
			ctx.fillStyle = "rgba(255, 60, 60, 0.55)";
			ctx.fillRect(x, trackTop - 12, stripe, 5);
			ctx.fillRect(x + stripe, trackTop - 12, stripe, 5);
			ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
			ctx.fillRect(x, trackTop + trackHeight + 7, stripe, 5);
			ctx.fillRect(x + stripe, trackTop + trackHeight + 7, stripe, 5);
		}

		// Lane separators
		ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
		ctx.lineWidth = 2;
		ctx.setLineDash([14, 16]);
		for (let i = 1; i < config.lanes; i += 1) {
			const y = L.trackTop + i * L.laneH;
			ctx.beginPath();
			ctx.moveTo(0, y);
			ctx.lineTo(W, y);
			ctx.stroke();
		}
		ctx.setLineDash([]);
	}

	function drawStartLine(L, x) {
		if (x < -30 || x > L.W + 30) return;
		ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(x, L.trackTop - 12);
		ctx.lineTo(x, L.trackBottom + 12);
		ctx.stroke();
	}

	function drawFinishLine(L, x) {
		if (x < -60 || x > L.W + 60) return;
		const { trackTop, trackBottom } = L;
		const cell = 12;
		for (let y = trackTop - 12; y < trackBottom + 12; y += cell) {
			for (let k = 0; k < 2; k += 1) {
				ctx.fillStyle = (Math.floor((y - trackTop) / cell) + k) % 2
					? "#ffffff"
					: "#111";
				ctx.fillRect(x + k * cell, y, cell, cell);
			}
		}
		// Banner
		ctx.fillStyle = "#ffd700";
		ctx.font = "bold 16px sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("🏁 CHEGADA", x + 12, trackTop - 24);
	}

	function drawOils(state, L, toX) {
		state.oils.forEach((oil) => {
			const x = toX(oil.dist);
			if (x < -60 || x > L.W + 60) return;
			const y = L.trackTop + L.trackHeight * 0.55;
			ctx.fillStyle = "rgba(10, 10, 14, 0.85)";
			ctx.beginPath();
			ctx.ellipse(x, y, 34, 14, 0, 0, Math.PI * 2);
			ctx.fill();
			ctx.fillStyle = "rgba(120, 90, 200, 0.25)";
			ctx.beginPath();
			ctx.ellipse(x - 8, y - 3, 14, 6, 0.4, 0, Math.PI * 2);
			ctx.fill();
		});
	}

	function drawCars(state, L, toX) {
		const now = Date.now();
		const standings = engine.standings();
		const leaderId = standings[0]?.uniqueId;

		// Draw lane by lane (lower lanes overlap upper ones, top-down feel)
		const cars = [...state.cars].sort(
			(a, b) => a.lane - b.lane || a.dist - b.dist,
		);

		for (const car of cars) {
			const x = toX(car.dist);
			if (x < -140 || x > L.W + 140) continue;
			const y = L.trackTop + car.lane * L.laneH + L.laneH / 2;
			drawCar(car, x, y, L.laneH, now, car.uniqueId === leaderId);
		}
	}

	function drawCar(car, x, y, laneH, now, isLeader) {
		const h = Math.min(laneH * 0.62, 46);
		const w = h * 1.75;
		const boosting = now < car.boostUntil;
		const spinning = now < car.spinUntil;
		const left = x - w / 2;
		const top = y - h / 2;

		ctx.save();

		if (spinning) {
			const wobble = Math.sin(now / 60) * 0.35;
			ctx.translate(x, y);
			ctx.rotate(wobble);
			ctx.translate(-x, -y);
		}

		// Shadow
		ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
		ctx.beginPath();
		ctx.ellipse(x, top + h + 4, w * 0.48, 5, 0, 0, Math.PI * 2);
		ctx.fill();

		// Boost flame behind the car
		if (boosting && !spinning) {
			const flame = (Math.sin(now / 45) + 1) * 6 + 14;
			const grad = ctx.createLinearGradient(left - flame, 0, left, 0);
			grad.addColorStop(0, "rgba(255, 200, 0, 0)");
			grad.addColorStop(0.6, "rgba(255, 140, 0, 0.7)");
			grad.addColorStop(1, "rgba(255, 240, 120, 0.95)");
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.moveTo(left - flame, y);
			ctx.lineTo(left, top + h * 0.2);
			ctx.lineTo(left, top + h * 0.8);
			ctx.closePath();
			ctx.fill();

			// Speed lines
			ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
			ctx.lineWidth = 2;
			for (let k = 0; k < 3; k += 1) {
				const ly = top + (h / 4) * (k + 1);
				ctx.beginPath();
				ctx.moveTo(left - flame - 10 - k * 8, ly);
				ctx.lineTo(left - flame - 30 - k * 12, ly);
				ctx.stroke();
			}
		}

		// Wheels
		ctx.fillStyle = "#0d0d0d";
		ctx.beginPath();
		ctx.arc(left + w * 0.2, top + h - 2, h * 0.16, 0, Math.PI * 2);
		ctx.arc(left + w * 0.8, top + h - 2, h * 0.16, 0, Math.PI * 2);
		ctx.fill();

		// Body
		ctx.fillStyle = car.color;
		ctx.beginPath();
		ctx.roundRect(left, top + h * 0.3, w, h * 0.6, 8);
		ctx.fill();

		// Cabin
		ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
		ctx.beginPath();
		ctx.roundRect(left + w * 0.18, top + h * 0.05, w * 0.5, h * 0.4, 6);
		ctx.fill();
		ctx.fillStyle = "#bfe9ff";
		ctx.beginPath();
		ctx.roundRect(left + w * 0.22, top + h * 0.1, w * 0.42, h * 0.28, 5);
		ctx.fill();

		// Headlight + taillight
		ctx.fillStyle = "#ffe680";
		ctx.beginPath();
		ctx.arc(left + w - 4, top + h * 0.5, 3.4, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = "#ff3b30";
		ctx.beginPath();
		ctx.arc(left + 4, top + h * 0.5, 3, 0, Math.PI * 2);
		ctx.fill();

		// Leader crown
		if (isLeader) {
			ctx.font = `${Math.round(h * 0.5)}px serif`;
			ctx.textAlign = "center";
			ctx.fillText("👑", x, top - h * 0.28);
		}

		// Spin indicator
		if (spinning) {
			ctx.font = `${Math.round(h * 0.55)}px serif`;
			ctx.textAlign = "center";
			ctx.fillText("💫", x, top - h * 0.3);
		}

		ctx.restore();

		// Name plate (billboard style)
		const plateW = Math.max(96, w + 46);
		const plateX = x - plateW / 2;
		const plateY = top - h * 1.05;
		ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
		ctx.beginPath();
		ctx.roundRect(plateX, plateY, plateW, 20, 6);
		ctx.fill();
		ctx.strokeStyle = car.color;
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.fillStyle = "#fff";
		ctx.font = "bold 11px 'Segoe UI', sans-serif";
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.fillText(`${car.number} ${car.name}`.slice(0, 21), plateX + 8, plateY + 10);

		ctx.fillStyle = "#ffd700";
		ctx.textAlign = "right";
		ctx.fillText(`${engine.kmhOf(car)} km/h`, plateX + plateW - 8, plateY + 10);
		ctx.textBaseline = "alphabetic";
	}

	function drawCountdown(state) {
		if (state.phase !== "countdown") return;
		const seconds = Math.ceil(engine.phaseRemaining() / 1000);
		const W = canvas.width;
		const H = canvas.height;

		ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
		ctx.beginPath();
		ctx.roundRect(W / 2 - 90, H / 2 - 110, 180, 220, 24);
		ctx.fill();

		ctx.fillStyle = "#ffd700";
		ctx.font = "bold 120px 'Segoe UI', sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(seconds), W / 2, H / 2 - 20);

		ctx.fillStyle = "#fff";
		ctx.font = "bold 20px 'Segoe UI', sans-serif";
		ctx.fillText(
			state.cars.length > 0 ? "QUEM ENTRA, ACELERA!" : "COMENTE PRA ENTRAR!",
			W / 2,
			H / 2 + 70,
		);
		ctx.textBaseline = "alphabetic";
	}

	function drawWaitingHint(L) {
		ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
		ctx.font = "bold 26px 'Segoe UI', sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(
			config.ui.waiting,
			L.W / 2,
			L.trackTop + L.trackHeight / 2,
		);
	}

	// ==========================================
	// DOM HUD UPDATE
	// ==========================================
	const phaseLabels = {
		waiting: () => config.ui.waiting,
		countdown: () => config.ui.countdown,
		racing: () => config.ui.racing,
		finished: () => config.ui.finished,
		cooldown: () => config.ui.cooldown,
	};

	function updateHUD(state) {
		// Phase banner
		phaseText.textContent = (phaseLabels[state.phase] || (() => state.phase))();
		const remaining = engine.phaseRemaining();
		phaseTimer.textContent =
			state.phase !== "waiting" && Number.isFinite(remaining)
				? `${Math.ceil(remaining / 1000)}s`
				: "";
		phaseBanner.classList.toggle("countdown", state.phase === "countdown");

		// Leaderboard (throttled: twice per second)
		const now = performance.now();
		if (now - lastBoardUpdate > 500) {
			lastBoardUpdate = now;
			renderLeaderboard(state);
		}

		// Feed
		if (state.feedSeq !== lastFeedSeq) {
			lastFeedSeq = state.feedSeq;
			renderFeed(state.feed);
		}

		// Winner overlay
		if (state.phase === "finished" && state.winner) {
			showWinner(state.winner);
		} else {
			winnerOverlay.classList.add("hidden");
		}
	}

	function renderLeaderboard(state) {
		leaderboard.innerHTML = "";
		const title = document.createElement("div");
		title.className = "board-title";
		title.textContent = config.ui.leaderboardTitle;
		leaderboard.appendChild(title);

		const standings = engine.standings().slice(0, 6);
		if (standings.length === 0) {
			const empty = document.createElement("div");
			empty.className = "board-empty";
			empty.textContent = config.ui.noCars;
			leaderboard.appendChild(empty);
			return;
		}

		standings.forEach((car, idx) => {
			const row = document.createElement("div");
			row.className = "board-row";

			const pos = document.createElement("span");
			pos.className = "board-pos";
			pos.textContent = `${idx + 1}º`;

			const chip = document.createElement("span");
			chip.className = "board-chip";
			chip.style.background = car.color;

			const name = document.createElement("span");
			name.className = "board-name";
			name.textContent = car.name;

			const speed = document.createElement("span");
			speed.className = "board-speed";
			speed.textContent = `${engine.kmhOf(car)} km/h`;

			row.append(pos, chip, name, speed);
			leaderboard.appendChild(row);
		});
	}

	function renderFeed(feed) {
		eventFeed.innerHTML = "";
		feed.slice(0, 9).forEach((item) => {
			const el = document.createElement("div");
			el.className = `feed-item ${item.type}`;
			el.textContent = item.text;
			eventFeed.appendChild(el);
		});
	}

	function showWinner(winner) {
		winnerOverlay.classList.remove("hidden");
		winnerName.textContent = winner.name;
		winnerName.style.color = winner.color;
		winnerColor.style.background = winner.color;
		winnerSub.textContent = config.ui.winnerSubtitle(
			winner.kmh,
			winner.likes,
			winner.gifts,
		);
	}

	// ==========================================
	// START
	// ==========================================
	requestAnimationFrame(frame);
	console.log("[Corrida] Game loaded, waiting for TikTokBridge connection...");
})();
