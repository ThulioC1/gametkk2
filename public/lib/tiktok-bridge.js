/**
 * tiktok-bridge.js
 * A lightweight SDK to bridge TikTok Live events to HTML5 games.
 *
 * Usage:
 * 1. Include this script in your game's index.html
 * 2. TikTokBridge.connect(username)
 * 3. TikTokBridge.on('chat', (data) => { ... })
 *
 * Events: chat, gift, like, share, connected, disconnected, reconnecting, error
 */
((global) => {
	class TikTokBridge {
		constructor() {
			this.socket = null;
			this.username = null;
			this.eventHandlers = {
				chat: [],
				gift: [],
				like: [],
				share: [],
				connected: [],
				disconnected: [],
				reconnecting: [],
				error: [],
			};
			this.isInitialized = false;

			// Auto-connect if URL params are present (id or username)
			window.addEventListener("load", () => {
				const params = new URLSearchParams(window.location.search);
				const user = params.get("id") || params.get("username");
				if (user) {
					console.log(`[TikTokBridge] Auto-connecting for user: ${user}`);
					this.connect(user);
				}
			});
		}

		/**
		 * Initialize connection to the gateway
		 * @param {string} username TikTok Username
		 * @param {string} serverUrl Socket.io Server URL (optional)
		 */
		connect(username, serverUrl = window.location.origin) {
			if (this.isInitialized || !username) return;

			this.username = username;
			this.socket = io(serverUrl);

			this.socket.on("connect", () => {
				console.log("[TikTokBridge] Connected to server");
				this.socket.emit("join-room", username);
			});

			this.socket.on("room-joined", (data) => {
				console.log(`[TikTokBridge] Joined room: ${data.room}`);
				this._dispatch("connected", data);
			});

			// Event relay — canonical events only (no legacy duplicates)
			this.socket.on("tiktok_chat", (data) => this._dispatch("chat", data));
			this.socket.on("tiktok_gift", (data) => this._dispatch("gift", data));
			this.socket.on("tiktok_like", (data) => this._dispatch("like", data));
			this.socket.on("tiktok_share", (data) => this._dispatch("share", data));

			this.socket.on("tiktok_disconnected", () => {
				console.log("[TikTokBridge] TikTok disconnected");
				this._dispatch("disconnected");
			});

			this.socket.on("tiktok_reconnecting", (data) => {
				console.log(
					`[TikTokBridge] Reconnecting attempt ${data.attempt} in ${data.delayMs}ms`,
				);
				this._dispatch("reconnecting", data);
			});

			this.socket.on("tiktok_error", (data) => {
				console.error("[TikTokBridge] Error:", data.message);
				this._dispatch("error", data);
			});

			this.socket.on("connection-error", (err) => {
				console.error("[TikTokBridge] Connection error:", err.message);
				this._dispatch("error", err);
			});

			this.isInitialized = true;
		}

		/**
		 * Register event handler
		 * @param {string} event 'chat', 'gift', 'like', 'share', 'connected', 'disconnected', 'reconnecting', 'error'
		 * @param {function} callback
		 */
		on(event, callback) {
			if (this.eventHandlers[event]) {
				this.eventHandlers[event].push(callback);
			}
		}

		_dispatch(event, data) {
			if (this.eventHandlers[event]) {
				this.eventHandlers[event].forEach((handler) => {
					try {
						handler(data);
					} catch (e) {
						console.error(`[TikTokBridge] Error in ${event} handler:`, e);
					}
				});
			}
		}
	}

	// Export to global scope
	global.TikTokBridge = new TikTokBridge();
})(window);
