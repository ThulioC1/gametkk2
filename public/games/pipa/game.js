/**
 * game.js
 * Pipa Arena — Canvas renderer + TikTokBridge wiring.
 * Reads state from PipaEngine and draws the sky, kites, lines and pieces.
 *
 * @module games/pipa/game
 */

(() => {
	const config = window.PIPA_CONFIG;
	const engine = new window.PipaEngine(config);

	const canvas = document.getElementById("skyCanvas");
	const ctx = canvas.getContext("2d");

	// DOM HUD elements
	const phaseBanner = document.getElementById("phaseBanner");
	const phaseText = document.getElementById("phaseText");
	const phaseTimer = document.getElementById("phaseTimer");
	const skyCount = document.getElementById("skyCount");
	const roundCount = document.getElementById("roundCount");
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
		buildStars();
	}
	window.addEventListener("resize", resize);

	// ==========================================
	// BRIDGE → ENGINE WIRING
	// ==========================================
	TikTokBridge.on("chat", (data) => engine.handleChat(data));
	TikTokBridge.on("gift", (data) => engine.handleGift(data));
	TikTokBridge.on("like", (data) => engine.handleLike(data));

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
	// DECOR (stars / clouds)
	// ==========================================
	let stars = [];
	const clouds = [
		{ x: 0.15, y: 0.2, s: 1.1, v: 6 },
		{ x: 0.55, y: 0.12, s: 0.8, v: 4 },
		{ x: 0.85, y: 0.3, s: 1.3, v: 5 },
	];

	function buildStars() {
		stars = [];
		let seed = 7;
		const rand = () => {
			seed = (seed * 16807) % 2147483647;
			return seed / 2147483647;
		};
		for (let i = 0; i < 90; i += 1) {
			stars.push({ x: rand(), y: rand() * 0.55, r: rand() * 1.4 + 0.4, a: rand() * 0.5 + 0.2 });
		}
	}

	// ==========================================
	// RENDERER-LOCAL PARTICLES (fx bursts)
	// ==========================================
	const particles = [];
	let lastFxSeq = 0;
	let lastFrame = performance.now();

	function spawnBurst(fx) {
		const count = fx.kind === "cut" ? 18 : 8;
		for (let i = 0; i < count; i += 1) {
			const angle = Math.random() * Math.PI * 2;
			const speed = fx.kind === "cut" ? 60 + Math.random() * 160 : 30 + Math.random() * 60;
			particles.push({
				x: fx.x,
				y: fx.y,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed,
				life: 1,
				color: fx.color,
				size: fx.kind === "cut" ? 3 : 2,
			});
		}
	}

	function drawParticles(dt, W, H) {
		const L = layout();
		for (const p of particles) {
			p.life -= dt * 1.4;
			p.x += p.vx * dt;
			p.y += p.vy * dt;
			p.vx *= 0.96;
			p.vy *= 0.96;
			const sx = worldToX(p.x, W);
			const sy = altToY(p.y, L, H);
			ctx.globalAlpha = Math.max(0, p.life);
			ctx.fillStyle = p.color;
			ctx.beginPath();
			ctx.arc(sx, sy, p.size, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
		for (let i = particles.length - 1; i >= 0; i -= 1) {
			if (particles[i].life <= 0) particles.splice(i, 1);
		}
	}

	// ==========================================
	// LAYOUT MATH
	// ==========================================
	function layout() {
		const W = canvas.width;
		const H = canvas.height;
		const groundY = H * 0.92;
		const skyTop = H * 0.1;
		return { W, H, groundY, skyTop, skyHeight: groundY - skyTop };
	}

	function worldToX(x, W) {
		return (x / config.world.width) * W;
	}

	function altToY(alt, L, H) {
		return L.groundY - (alt / config.world.ceiling) * L.skyHeight;
	}

	// ==========================================
	// RENDER LOOP
	// ==========================================
	let lastFeedSeq = -1;
	let lastBoardUpdate = 0;

	function frame(nowMs) {
		const dt = Math.min((nowMs - lastFrame) / 1000, 0.1);
		lastFrame = nowMs;

		const state = engine.tick();
		draw(state, dt);
		updateHUD(state);
		requestAnimationFrame(frame);
	}

	// ==========================================
	// CANVAS DRAWING
	// ==========================================
	function draw(state, dt) {
		const L = layout();
		const { W, H } = L;

		ctx.clearRect(0, 0, W, H);

		drawSky(L);
		drawGround(L);
		drawStrings(state, L);
		drawKites(state, L);
		drawPieces(state, L);
		drawParticles(dt, W, H);
		drawCountdown(state, L);

		// Consume engine fx queue → local particles
		for (const fx of state.fx) {
			if (fx.seq > lastFxSeq) spawnBurst(fx);
		}
		lastFxSeq = state.fxSeq;
	}

	function drawSky(L) {
		const { W, H } = L;
		const grad = ctx.createLinearGradient(0, 0, 0, H);
		grad.addColorStop(0, "rgba(10, 14, 38, 0.92)");
		grad.addColorStop(0.55, "rgba(35, 28, 76, 0.9)");
		grad.addColorStop(1, "rgba(90, 52, 110, 0.88)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, W, H);

		// Stars (twinkle with time)
		const t = performance.now() / 1000;
		for (const s of stars) {
			const twinkle = 0.6 + 0.4 * Math.sin(t * 1.5 + s.x * 40);
			ctx.globalAlpha = s.a * twinkle;
			ctx.fillStyle = "#fff";
			ctx.beginPath();
			ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;

		// Clouds
		for (const c of clouds) {
			c.x += (c.v * 0.0015 * L.W) / L.W;
			if (c.x > 1.2) c.x = -0.2;
			drawCloud(c.x * W, c.y * H, c.s);
		}
	}

	function drawCloud(x, y, s) {
		ctx.globalAlpha = 0.1;
		ctx.fillStyle = "#cdd6ff";
		ctx.beginPath();
		ctx.ellipse(x, y, 70 * s, 22 * s, 0, 0, Math.PI * 2);
		ctx.ellipse(x + 45 * s, y + 6 * s, 50 * s, 18 * s, 0, 0, Math.PI * 2);
		ctx.ellipse(x - 45 * s, y + 8 * s, 44 * s, 16 * s, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
	}

	function drawGround(L) {
		const { W, groundY, H } = L;
		const grad = ctx.createLinearGradient(0, groundY, 0, H);
		grad.addColorStop(0, "rgba(28, 74, 44, 0.95)");
		grad.addColorStop(1, "rgba(12, 34, 20, 0.95)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, groundY, W, H - groundY);
		ctx.fillStyle = "rgba(255, 200, 120, 0.12)";
		ctx.fillRect(0, groundY - 2, W, 3);
	}

	function drawStrings(state, L) {
		for (const kite of state.kites) {
			const kx = worldToX(kite.x, L.W);
			const ky = altToY(kite.y, L, L.H);
			const anchorX = worldToX(kite.targetX, L.W);
			const ctrlX = (anchorX + kx) / 2 + Math.sin(kite.seed) * 18;

			ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			ctx.moveTo(anchorX, L.groundY);
			ctx.quadraticCurveTo(ctrlX, (L.groundY + ky) / 2, kx, ky);
			ctx.stroke();
		}
	}

	function drawKites(state, L) {
		const t = performance.now() / 1000;
		for (const kite of state.kites) {
			const kx = worldToX(kite.x, L.W);
			const ky = altToY(kite.y, L, L.H);
			const tilt = Math.sin(t * 0.9 + kite.seed) * 0.14;
			const size = 30 + (kite.y / config.world.ceiling) * 8;
			drawKite(kx, ky, size, kite.color, tilt, t + kite.seed);
		}
	}

	function drawKite(x, y, size, color, tilt, t) {
		ctx.save();
		ctx.translate(x, y);
		ctx.rotate(tilt);

		// Tail (3 bows below)
		ctx.strokeStyle = color;
		ctx.globalAlpha = 0.75;
		ctx.lineWidth = 2;
		const tailLen = size * 1.6;
		for (let i = 0; i < 3; i += 1) {
			const ty = size + i * (tailLen / 3) + Math.sin(t * 2 + i) * 3;
			const side = i % 2 === 0 ? 1 : -1;
			ctx.beginPath();
			ctx.moveTo(0, size + (i * tailLen) / 3);
			ctx.lineTo(side * 7, ty + 6);
			ctx.lineTo(0, ty + 10);
			ctx.stroke();
		}
		ctx.globalAlpha = 1;

		// Diamond body
		ctx.beginPath();
		ctx.moveTo(0, -size);
		ctx.lineTo(size * 0.72, 0);
		ctx.lineTo(0, size);
		ctx.lineTo(-size * 0.72, 0);
		ctx.closePath();
		const grad = ctx.createLinearGradient(0, -size, 0, size);
		grad.addColorStop(0, color);
		grad.addColorStop(1, shade(color, -0.35));
		ctx.fillStyle = grad;
		ctx.fill();
		ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
		ctx.lineWidth = 2;
		ctx.stroke();

		// Sticks (cross)
		ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
		ctx.lineWidth = 1.4;
		ctx.beginPath();
		ctx.moveTo(0, -size);
		ctx.lineTo(0, size);
		ctx.moveTo(-size * 0.72, 0);
		ctx.lineTo(size * 0.72, 0);
		ctx.stroke();

		// Shine
		ctx.globalAlpha = 0.35;
		ctx.fillStyle = "#fff";
		ctx.beginPath();
		ctx.moveTo(0, -size * 0.85);
		ctx.lineTo(size * 0.3, -size * 0.1);
		ctx.lineTo(0, 0);
		ctx.closePath();
		ctx.fill();
		ctx.globalAlpha = 1;

		ctx.restore();
	}

	function drawPieces(state, L) {
		for (const piece of state.pieces) {
			const x = worldToX(piece.x, L.W);
			const y = altToY(piece.y, L, L.H);
			ctx.save();
			ctx.translate(x, y);
			ctx.rotate(piece.rot);
			ctx.globalAlpha = Math.max(0, piece.alpha);
			ctx.beginPath();
			ctx.moveTo(0, -14);
			ctx.lineTo(10, 0);
			ctx.lineTo(0, 14);
			ctx.lineTo(-10, 0);
			ctx.closePath();
			ctx.fillStyle = piece.color;
			ctx.fill();
			ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
			ctx.lineWidth = 1.5;
			ctx.stroke();
			ctx.restore();
		}
		ctx.globalAlpha = 1;
	}

	function drawCountdown(state, L) {
		if (state.phase !== "countdown") return;
		const seconds = Math.ceil(engine.phaseRemaining() / 1000);
		const { W, H } = L;

		ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
		ctx.beginPath();
		ctx.roundRect(W / 2 - 90, H / 2 - 110, 180, 220, 24);
		ctx.fill();

		ctx.fillStyle = "#25f4ee";
		ctx.font = "bold 120px 'Segoe UI', sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(seconds), W / 2, H / 2 - 20);

		ctx.fillStyle = "#fff";
		ctx.font = "bold 20px 'Segoe UI', sans-serif";
		ctx.fillText("SOLTE SUA PIPA!", W / 2, H / 2 + 70);
		ctx.textBaseline = "alphabetic";
	}

	/** Darken/lighten a hex color by amount (-1..1) */
	function shade(hex, amt) {
		const n = parseInt(hex.slice(1), 16);
		const clamp = (v) => Math.max(0, Math.min(255, v));
		const r = clamp(((n >> 16) & 255) + 255 * amt);
		const g = clamp(((n >> 8) & 255) + 255 * amt);
		const b = clamp((n & 255) + 255 * amt);
		return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
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

		// Stats
		skyCount.textContent = String(state.kites.length);
		roundCount.textContent = String(state.raceCount + 1);

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

		const leaders = engine.leaders(6);
		if (leaders.length === 0) {
			const empty = document.createElement("div");
			empty.className = "board-empty";
			empty.textContent = config.ui.noLeaders;
			leaderboard.appendChild(empty);
			return;
		}

		leaders.forEach((entry, idx) => {
			const row = document.createElement("div");
			row.className = "board-row";

			const pos = document.createElement("span");
			pos.className = "board-pos";
			pos.textContent = `${idx + 1}º`;

			const chip = document.createElement("span");
			chip.className = "board-chip";
			chip.style.background = entry.color || "#888";

			const name = document.createElement("span");
			name.className = "board-name";
			name.textContent = entry.name;

			const score = document.createElement("span");
			score.className = "board-score";
			score.textContent = `✂️ ${entry.cuts} • ${entry.points} pts`;

			row.append(pos, chip, name, score);
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
			winner.points,
			winner.cuts,
		);
	}

	// ==========================================
	// START
	// ==========================================
	resize();
	requestAnimationFrame(frame);
	console.log("[Pipa] Game loaded, waiting for TikTokBridge connection...");
})();
