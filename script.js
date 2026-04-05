/* ═══════════════════════════════════════════════════════════════
   WatchTogether — script.js
   Pure vanilla JS + Firebase Realtime DB + YouTube Iframe API
   No backend required. Deploy directly to GitHub Pages.
═══════════════════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────────────────────
   SECTION 1: FIREBASE CONFIGURATION
   ✅ Credentials are filled in. One manual step still required:
   
   ACTION NEEDED — Add databaseURL:
     1. Go to: https://console.firebase.google.com
     2. Open project "watch-together-c98df"
     3. Build → Realtime Database → Create database
        • Choose a region (e.g. us-central1)
        • Start in TEST MODE (allows read/write without auth)
     4. After creation, copy the database URL shown at the top
        (looks like: https://watch-together-c98df-default-rtdb.firebaseio.com)
     5. Paste it as the databaseURL value below

   SECURITY NOTE: Before going public, update your Realtime Database
   rules to restrict access. For private couple use, test mode is fine.
────────────────────────────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBVCsAnQU1JBxbFCmDF1Mj7bbOrJHTrPiQ",
  authDomain:        "watch-together-c98df.firebaseapp.com",
  // ⬇️  PASTE YOUR REALTIME DATABASE URL HERE after creating it in Firebase console
  // It will look like: "https://watch-together-c98df-default-rtdb.firebaseio.com"
  // Or for non-US regions: "https://watch-together-c98df-default-rtdb.REGION.firebasedatabase.app"
  databaseURL:       "https://watch-together-c98df-default-rtdb.firebaseio.com",
  projectId:         "watch-together-c98df",
  storageBucket:     "watch-together-c98df.firebasestorage.app",
  messagingSenderId: "614738541836",
  appId:             "1:614738541836:web:92ec9f8e451af309a11d29",
  measurementId:     "G-H4WSQNM8DW"
};

/* ──────────────────────────────────────────────────────────────
   SECTION 2: APP STATE
   Central state object — all mutable state lives here
────────────────────────────────────────────────────────────── */
const state = {
  roomId:      null,          // Current room ID (string)
  userName:    null,          // This user's display name
  userId:      null,          // Unique ID for this browser session
  isHost:      false,         // Whether this user is the room host
  isReady:     false,         // Ready toggle state

  videoType:   null,          // 'youtube' | 'local' | null
  ytPlayer:    null,          // YouTube IFrame Player object
  localVideo:  null,          // Reference to <video> element

  isSyncing:   false,         // ← Critical flag: prevents infinite sync loops
  lastSyncTime: 0,            // Timestamp of last sync write (debounce)
  syncDebounceMs: 100,        // Min ms between sync writes (reduced for snappier response)

  // Latency compensation — tracks estimated one-way network delay
  networkLatencyMs: 0,        // Estimated one-way delay (ms), updated on every sync received
  serverTimeOffset: 0,        // Local clock vs Firebase server clock difference (ms)

  db:          null,          // Firebase database reference
  roomRef:     null,          // Firebase ref for /rooms/{roomId}
  stateRef:    null,          // Firebase ref for /rooms/{roomId}/state
  usersRef:    null,          // Firebase ref for /rooms/{roomId}/users
  chatRef:     null,          // Firebase ref for /rooms/{roomId}/chat
};

/* ──────────────────────────────────────────────────────────────
   SECTION 3: DOM REFERENCES
────────────────────────────────────────────────────────────── */
const dom = {
  // Screens
  lobbyScreen:    document.getElementById('lobby-screen'),
  appScreen:      document.getElementById('app-screen'),

  // Lobby
  tabs:           document.querySelectorAll('.tab'),
  tabPanels:      document.querySelectorAll('.tab-panel'),
  createName:     document.getElementById('create-name'),
  btnCreate:      document.getElementById('btn-create'),
  joinName:       document.getElementById('join-name'),
  joinRoomId:     document.getElementById('join-room-id'),
  btnJoin:        document.getElementById('btn-join'),
  lobbyError:     document.getElementById('lobby-error'),

  // Topbar
  displayRoomId:  document.getElementById('display-room-id'),
  btnCopyLink:    document.getElementById('btn-copy-link'),
  connectionDot:  document.getElementById('connection-status'),
  statusLabel:    document.getElementById('status-label'),
  btnLeave:       document.getElementById('btn-leave'),

  // Video input
  ytInput:        document.getElementById('yt-input'),
  btnLoadYt:      document.getElementById('btn-load-yt'),
  localFileInput: document.getElementById('local-file-input'),

  // Player area
  syncBanner:     document.getElementById('sync-banner'),
  syncBannerText: document.getElementById('sync-banner-text'),
  playerWrap:     document.getElementById('player-wrap'),
  noVideoPlaceholder: document.getElementById('no-video-placeholder'),
  ytPlayerContainer:  document.getElementById('yt-player-container'),
  localVideo:     document.getElementById('local-video'),

  // Playback status
  playbackStatus: document.getElementById('playback-status'),
  statusIcon:     document.getElementById('status-icon'),
  statusText:     document.getElementById('status-text'),

  // Sidebar
  viewersList:    document.getElementById('viewers-list'),
  btnReady:       document.getElementById('btn-ready'),
  readyBtnText:   document.getElementById('ready-btn-text'),
  readyStatus:    document.getElementById('ready-status'),

  // Chat
  chatMessages:   document.getElementById('chat-messages'),
  chatInput:      document.getElementById('chat-input'),
  btnSend:        document.getElementById('btn-send'),

  // Toast
  toast:          document.getElementById('toast'),
};

/* ──────────────────────────────────────────────────────────────
   SECTION 4: UTILITY FUNCTIONS
────────────────────────────────────────────────────────────── */

/** Generate a short random room ID (6 alphanumeric chars) */
function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

/** Generate a unique user session ID */
function generateUserId() {
  return 'user_' + Math.random().toString(36).substring(2, 10);
}

/** Extract YouTube video ID from various URL formats */
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
    /(?:youtu\.be\/)([^?\s]+)/,
    /(?:youtube\.com\/embed\/)([^?\s]+)/,
    /(?:youtube\.com\/shorts\/)([^?\s]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/** Show a brief toast notification */
let toastTimer;
function showToast(msg, duration = 2500) {
  clearTimeout(toastTimer);
  dom.toast.textContent = msg;
  dom.toast.classList.remove('hidden');
  requestAnimationFrame(() => dom.toast.classList.add('show'));
  toastTimer = setTimeout(() => {
    dom.toast.classList.remove('show');
    setTimeout(() => dom.toast.classList.add('hidden'), 300);
  }, duration);
}

/** Show/hide the syncing banner */
function showSyncBanner(msg = 'Syncing…') {
  dom.syncBannerText.textContent = msg;
  dom.syncBanner.classList.remove('hidden');
}
function hideSyncBanner() {
  dom.syncBanner.classList.add('hidden');
}

/** Update the connection status indicator */
function setConnectionStatus(connected) {
  if (connected) {
    dom.connectionDot.className = 'status-dot connected';
    dom.statusLabel.textContent = 'Connected';
  } else {
    dom.connectionDot.className = 'status-dot disconnected';
    dom.statusLabel.textContent = 'Disconnected';
  }
}

/** Set playback status text in UI */
function setPlaybackStatus(icon, text) {
  dom.statusIcon.textContent = icon;
  dom.statusText.textContent = text;
  dom.playbackStatus.classList.remove('hidden');
}

/** Show lobby error */
function showLobbyError(msg) {
  dom.lobbyError.textContent = msg;
  dom.lobbyError.classList.remove('hidden');
}
function hideLobbyError() {
  dom.lobbyError.classList.add('hidden');
}

/* ──────────────────────────────────────────────────────────────
   SECTION 5: FIREBASE INITIALIZATION
────────────────────────────────────────────────────────────── */

function initFirebase() {
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    state.db = firebase.database();
    console.log('[Firebase] Initialized');

    // Monitor connection state
    const connRef = state.db.ref('.info/connected');
    connRef.on('value', (snap) => {
      setConnectionStatus(snap.val() === true);
    });

    // Measure clock offset between local machine and Firebase server
    // Used for latency compensation when applying remote seek positions
    const offsetRef = state.db.ref('.info/serverTimeOffset');
    offsetRef.on('value', (snap) => {
      state.serverTimeOffset = snap.val() || 0;
    });

    return true;
  } catch (err) {
    console.error('[Firebase] Init failed:', err);
    showLobbyError('Firebase initialization failed. Please check your config.');
    return false;
  }
}

/* ──────────────────────────────────────────────────────────────
   SECTION 6: ROOM MANAGEMENT
────────────────────────────────────────────────────────────── */

/**
 * Create a new room and join it as host.
 */
async function createRoom(userName) {
  const roomId = generateRoomId();
  const userId = generateUserId();

  state.roomId   = roomId;
  state.userName = userName;
  state.userId   = userId;
  state.isHost   = true;

  // Setup Firebase refs
  state.roomRef  = state.db.ref(`rooms/${roomId}`);
  state.stateRef = state.db.ref(`rooms/${roomId}/state`);
  state.usersRef = state.db.ref(`rooms/${roomId}/users`);
  state.chatRef  = state.db.ref(`rooms/${roomId}/chat`);

  // Initialize room state in Firebase
  await state.stateRef.set({
    status:    'pause',
    time:      0,
    videoId:   '',
    videoType: '',
    updatedBy: userId,
    updatedAt: Date.now(),
  });

  // Register this user
  const userRef = state.usersRef.child(userId);
  await userRef.set({ name: userName, isHost: true, isReady: false, joinedAt: Date.now() });

  // Remove user on disconnect
  userRef.onDisconnect().remove();

  // Update URL with room ID for easy sharing
  window.history.replaceState(null, '', `?room=${roomId}`);

  enterRoom();
}

/**
 * Join an existing room as a guest.
 */
async function joinRoom(userName, roomId) {
  const userId = generateUserId();
  roomId = roomId.trim().toUpperCase();

  // Verify room exists
  const snapshot = await state.db.ref(`rooms/${roomId}`).once('value');
  if (!snapshot.exists()) {
    showLobbyError(`Room "${roomId}" not found. Check the ID and try again.`);
    return;
  }

  state.roomId   = roomId;
  state.userName = userName;
  state.userId   = userId;
  state.isHost   = false;

  state.roomRef  = state.db.ref(`rooms/${roomId}`);
  state.stateRef = state.db.ref(`rooms/${roomId}/state`);
  state.usersRef = state.db.ref(`rooms/${roomId}/users`);
  state.chatRef  = state.db.ref(`rooms/${roomId}/chat`);

  // Register this user
  const userRef = state.usersRef.child(userId);
  await userRef.set({ name: userName, isHost: false, isReady: false, joinedAt: Date.now() });
  userRef.onDisconnect().remove();

  window.history.replaceState(null, '', `?room=${roomId}`);

  enterRoom();
  postSystemChat(`${userName} joined the room`);
}

/**
 * Enter the room UI — transition from lobby to app screen.
 */
function enterRoom() {
  dom.lobbyScreen.classList.remove('active');
  dom.appScreen.classList.add('active');
  dom.displayRoomId.textContent = state.roomId;

  // Attach all Firebase listeners
  listenToRoomState();
  listenToUsers();
  listenToChat();

  // Post join message
  if (state.isHost) {
    postSystemChat(`${state.userName} created the room`);
  }

  console.log(`[Room] Entered room: ${state.roomId} as ${state.isHost ? 'host' : 'guest'}`);
}

/**
 * Leave the current room and go back to lobby.
 */
function leaveRoom() {
  // Cleanup Firebase listeners
  if (state.stateRef) state.stateRef.off();
  if (state.usersRef) state.usersRef.off();
  if (state.chatRef)  state.chatRef.off();

  // Remove user from users list
  if (state.usersRef && state.userId) {
    state.usersRef.child(state.userId).remove();
  }

  // Destroy YT player if exists
  if (state.ytPlayer) {
    state.ytPlayer.destroy();
    state.ytPlayer = null;
  }

  // Reset local video
  dom.localVideo.src = '';
  dom.localVideo.classList.add('hidden');
  dom.ytPlayerContainer.classList.add('hidden');
  dom.noVideoPlaceholder.classList.remove('hidden');

  // Reset state
  state.roomId = state.userName = state.userId = null;
  state.isHost = false;
  state.videoType = null;
  state.isReady = false;

  // Reset UI
  dom.viewersList.innerHTML = '';
  dom.chatMessages.innerHTML = '';
  dom.playbackStatus.classList.add('hidden');
  dom.readyBtnText.textContent = "I'm Ready ✓";
  dom.btnReady.classList.remove('ready-on');

  // Back to lobby
  dom.appScreen.classList.remove('active');
  dom.lobbyScreen.classList.add('active');
  window.history.replaceState(null, '', window.location.pathname);
}

/* ──────────────────────────────────────────────────────────────
   SECTION 7: FIREBASE REAL-TIME LISTENERS
────────────────────────────────────────────────────────────── */

/**
 * Listen to /rooms/{roomId}/state for playback sync.
 * This is the heart of the sync system.
 */
function listenToRoomState() {
  state.stateRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    // Ignore updates we wrote ourselves (prevents echo loops)
    if (data.updatedBy === state.userId) return;

    // If a new video was loaded by someone else, load it here too
    if (data.videoId && data.videoId !== getCurrentVideoId()) {
      loadVideoFromSync(data.videoId, data.videoType);
    }

    // Apply the synced playback state
    applyRemoteState(data);
  });
}

/**
 * Listen to /rooms/{roomId}/users for presence updates.
 */
function listenToUsers() {
  state.usersRef.on('value', (snapshot) => {
    const users = snapshot.val() || {};
    renderViewers(users);
  });
}

/**
 * Listen to /rooms/{roomId}/chat for new messages.
 */
function listenToChat() {
  // Only listen to new messages (not old history)
  const chatQuery = state.chatRef.orderByChild('timestamp').limitToLast(50);
  chatQuery.on('child_added', (snapshot) => {
    const msg = snapshot.val();
    if (msg) appendChatMessage(msg);
  });
}

/* ──────────────────────────────────────────────────────────────
   SECTION 8: SYNC — WRITING TO FIREBASE
────────────────────────────────────────────────────────────── */

/**
 * Push the current playback state to Firebase.
 * Play/pause events are sent instantly (no debounce).
 * Seek events are debounced to avoid spamming during scrubbing.
 *
 * @param {string} status   - 'play' | 'pause'
 * @param {number} time     - Current video time in seconds
 * @param {boolean} isSeek  - True when triggered by a seek action
 */
function pushStateToFirebase(status, time, isSeek = false) {
  // Only debounce seek events — play/pause should fire immediately
  if (isSeek) {
    const now = Date.now();
    if (now - state.lastSyncTime < state.syncDebounceMs) return;
    state.lastSyncTime = now;
  }

  if (!state.stateRef) return;

  state.stateRef.update({
    status,
    time,
    updatedBy: state.userId,
    updatedAt: Date.now(),
  }).catch((err) => {
    console.error('[Sync] Failed to push state:', err);
    showToast('⚠️ Sync error — check connection');
  });
}

/**
 * Push video change to Firebase (new video loaded by host/user).
 */
function pushVideoToFirebase(videoId, videoType) {
  if (!state.stateRef) return;

  state.stateRef.update({
    videoId,
    videoType,
    status:    'pause',
    time:      0,
    updatedBy: state.userId,
    updatedAt: Date.now(),
  });
}

/* ──────────────────────────────────────────────────────────────
   SECTION 9: SYNC — READING FROM FIREBASE (APPLYING REMOTE STATE)
────────────────────────────────────────────────────────────── */

/**
 * Apply a remote playback state update to the local player.
 * Uses the isSyncing flag to prevent event echo.
 * Compensates for network latency when seeking so both players
 * land at the same effective playback position.
 *
 * @param {object} data  - Firebase state snapshot value
 */
function applyRemoteState(data) {
  const player = getActivePlayer();
  if (!player) return;

  // Calculate how long this update spent in transit:
  // (our local clock + server offset) - time the sender wrote it
  const localNow = Date.now() + state.serverTimeOffset;
  const transitMs = data.updatedAt ? Math.max(0, localNow - data.updatedAt) : 0;
  const transitSec = transitMs / 1000;

  // Update our running latency estimate (smoothed average)
  state.networkLatencyMs = state.networkLatencyMs
    ? state.networkLatencyMs * 0.7 + transitMs * 0.3
    : transitMs;

  // If the remote player was playing, the video has advanced by transitSec
  // while the message was in flight — seek to the compensated position
  const compensatedTime = data.status === 'play'
    ? data.time + transitSec
    : data.time;

  // Set the syncing flag — our own event listeners will check this
  state.isSyncing = true;

  try {
    if (state.videoType === 'youtube' && state.ytPlayer) {
      const currentTime = state.ytPlayer.getCurrentTime();

      // Tighter threshold: correct if drift > 0.5s (was 1s)
      if (Math.abs(currentTime - compensatedTime) > 0.5) {
        state.ytPlayer.seekTo(compensatedTime, true);
      }

      if (data.status === 'play') {
        state.ytPlayer.playVideo();
        setPlaybackStatus('▶', 'Playing…');
      } else {
        state.ytPlayer.pauseVideo();
        setPlaybackStatus('⏸', 'Paused');
      }

    } else if (state.videoType === 'local') {
      const vid = dom.localVideo;
      const currentTime = vid.currentTime;

      if (Math.abs(currentTime - compensatedTime) > 0.5) {
        vid.currentTime = compensatedTime;
      }

      if (data.status === 'play') {
        vid.play().catch(() => {});
        setPlaybackStatus('▶', 'Playing…');
      } else {
        vid.pause();
        setPlaybackStatus('⏸', 'Paused');
      }
    }
  } finally {
    // Release the syncing flag after player events have fired
    setTimeout(() => { state.isSyncing = false; }, 200);
  }
}

/** Get current video ID from state */
function getCurrentVideoId() {
  return state.stateRef ? (state._currentVideoId || '') : '';
}

/* ──────────────────────────────────────────────────────────────
   SECTION 10: VIDEO LOADING
────────────────────────────────────────────────────────────── */

/**
 * Called when user pastes a YouTube URL and clicks Load.
 */
function handleYouTubeLoad() {
  const input = dom.ytInput.value.trim();
  if (!input) { showToast('Paste a YouTube URL first'); return; }

  const videoId = extractYouTubeId(input);
  if (!videoId) {
    showToast('❌ Invalid YouTube URL');
    return;
  }

  loadYouTubeVideo(videoId);
  pushVideoToFirebase(videoId, 'youtube');
}

/**
 * Load a YouTube video by ID into the Iframe player.
 */
function loadYouTubeVideo(videoId) {
  state.videoType = 'youtube';
  state._currentVideoId = videoId;

  // Hide local video, show YT container
  dom.localVideo.classList.add('hidden');
  dom.noVideoPlaceholder.classList.add('hidden');
  dom.ytPlayerContainer.classList.remove('hidden');

  if (state.ytPlayer) {
    // If player already exists, just load the new video
    state.ytPlayer.loadVideoById(videoId);
  } else {
    // Create the YouTube player for the first time
    // YT.Player is available because we loaded the iframe_api script
    state.ytPlayer = new YT.Player('yt-player-container', {
      videoId: videoId,
      playerVars: {
        autoplay: 0,
        controls: 1,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onReady:       onYTPlayerReady,
        onStateChange: onYTStateChange,
      },
    });
  }

  dom.playbackStatus.classList.remove('hidden');
  showToast('🎬 Video loaded');
}

/** Called when YouTube player is ready */
function onYTPlayerReady(event) {
  console.log('[YT] Player ready');
  setPlaybackStatus('⏸', 'Ready to play');
}

/**
 * Called when YouTube player state changes (play, pause, buffer, etc.)
 * This is where we push to Firebase when local user interacts.
 */
function onYTStateChange(event) {
  // If we're currently applying a remote sync, don't re-broadcast
  if (state.isSyncing) return;

  const YT_PLAYING = 1;
  const YT_PAUSED  = 2;

  const currentTime = state.ytPlayer.getCurrentTime();

  if (event.data === YT_PLAYING) {
    setPlaybackStatus('▶', 'Playing…');
    pushStateToFirebase('play', currentTime);
  } else if (event.data === YT_PAUSED) {
    setPlaybackStatus('⏸', `Paused at ${formatTime(currentTime)}`);
    pushStateToFirebase('pause', currentTime);
  }
}

/**
 * Handle local video file upload.
 */
function handleLocalFileUpload(file) {
  if (!file || !file.type.startsWith('video/')) {
    showToast('❌ Please select a valid video file');
    return;
  }

  const url = URL.createObjectURL(file);
  state.videoType = 'local';
  state._currentVideoId = file.name;

  // Hide YT player, show HTML5 video
  dom.ytPlayerContainer.classList.add('hidden');
  dom.noVideoPlaceholder.classList.add('hidden');
  dom.localVideo.src = url;
  dom.localVideo.classList.remove('hidden');
  dom.localVideo.load();

  // Destroy YT player if it exists
  if (state.ytPlayer) {
    state.ytPlayer.destroy();
    state.ytPlayer = null;
  }

  attachLocalVideoListeners();
  pushVideoToFirebase(file.name, 'local');
  showToast(`🎬 Loaded: ${file.name}`);
  setPlaybackStatus('⏸', 'Ready to play');
}

/**
 * When a remote user loads a video and we receive it via Firebase sync.
 */
function loadVideoFromSync(videoId, videoType) {
  if (videoType === 'youtube') {
    dom.ytInput.value = `https://youtu.be/${videoId}`;
    loadYouTubeVideo(videoId);
  } else if (videoType === 'local') {
    // Can't load the other person's local file — show a notice
    showToast('⚠️ Other user loaded a local file — upload the same file to sync');
    setPlaybackStatus('📂', 'Local file (upload yours too)');
  }
}

/**
 * Attach play/pause/seek listeners to the HTML5 video element.
 */
function attachLocalVideoListeners() {
  const vid = dom.localVideo;

  vid.addEventListener('play', () => {
    if (state.isSyncing) return;
    setPlaybackStatus('▶', 'Playing…');
    pushStateToFirebase('play', vid.currentTime, false); // instant — no debounce
  });

  vid.addEventListener('pause', () => {
    if (state.isSyncing) return;
    setPlaybackStatus('⏸', `Paused at ${formatTime(vid.currentTime)}`);
    pushStateToFirebase('pause', vid.currentTime, false); // instant — no debounce
  });

  vid.addEventListener('seeked', () => {
    if (state.isSyncing) return;
    const status = vid.paused ? 'pause' : 'play';
    pushStateToFirebase(status, vid.currentTime, true); // debounced — user may still be scrubbing
  });
}

/** Return whichever player is currently active */
function getActivePlayer() {
  if (state.videoType === 'youtube' && state.ytPlayer) return state.ytPlayer;
  if (state.videoType === 'local') return dom.localVideo;
  return null;
}

/** Format seconds as MM:SS */
function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/* ──────────────────────────────────────────────────────────────
   SECTION 11: VIEWERS LIST RENDERING
────────────────────────────────────────────────────────────── */

function renderViewers(users) {
  dom.viewersList.innerHTML = '';

  const entries = Object.entries(users);
  entries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));

  entries.forEach(([uid, user]) => {
    const li = document.createElement('li');
    li.className = 'viewer-item';

    const initial = (user.name || '?').charAt(0).toUpperCase();
    const isSelf  = uid === state.userId;

    li.innerHTML = `
      <div class="viewer-avatar">${initial}</div>
      <span>${user.name}${isSelf ? ' (you)' : ''}</span>
      ${user.isHost ? '<span class="viewer-badge">HOST</span>' : ''}
      ${user.isReady && !user.isHost ? '<span class="viewer-ready">✓ Ready</span>' : ''}
    `;
    dom.viewersList.appendChild(li);
  });

  // Update ready status count
  const total    = entries.length;
  const readyCount = entries.filter(([, u]) => u.isReady).length;
  dom.readyStatus.textContent = total > 1
    ? `${readyCount} / ${total} ready`
    : 'Waiting for others…';
}

/* ──────────────────────────────────────────────────────────────
   SECTION 12: CHAT SYSTEM
────────────────────────────────────────────────────────────── */

function sendChatMessage() {
  const text = dom.chatInput.value.trim();
  if (!text) return;
  dom.chatInput.value = '';

  const msg = {
    name:      state.userName,
    text,
    timestamp: Date.now(),
    userId:    state.userId,
    isSystem:  false,
  };

  state.chatRef.push(msg);
}

function postSystemChat(text) {
  if (!state.chatRef) return;
  state.chatRef.push({
    name:      '',
    text,
    timestamp: Date.now(),
    isSystem:  true,
  });
}

function appendChatMessage(msg) {
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.isSystem ? ' system' : '');

  if (!msg.isSystem) {
    div.innerHTML = `
      <span class="chat-msg-name">${escapeHtml(msg.name)}</span>
      <span class="chat-msg-text">${escapeHtml(msg.text)}</span>
    `;
  } else {
    div.innerHTML = `<span class="chat-msg-text">${escapeHtml(msg.text)}</span>`;
  }

  dom.chatMessages.appendChild(div);
  // Auto-scroll to bottom
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ──────────────────────────────────────────────────────────────
   SECTION 13: READY BUTTON
────────────────────────────────────────────────────────────── */

function toggleReady() {
  state.isReady = !state.isReady;

  if (state.isReady) {
    dom.readyBtnText.textContent = '✓ Ready!';
    dom.btnReady.classList.add('ready-on');
    showToast('You marked yourself as ready');
  } else {
    dom.readyBtnText.textContent = "I'm Ready ✓";
    dom.btnReady.classList.remove('ready-on');
  }

  // Update ready status in Firebase
  if (state.usersRef && state.userId) {
    state.usersRef.child(state.userId).update({ isReady: state.isReady });
  }
}

/* ──────────────────────────────────────────────────────────────
   SECTION 14: URL PARAMS — Auto-join room from URL
────────────────────────────────────────────────────────────── */

function checkUrlForRoom() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('room');
  if (roomId) {
    // Pre-fill join room field and switch to join tab
    dom.joinRoomId.value = roomId.toUpperCase();
    activateTab('join');
    showToast(`Room ID pre-filled: ${roomId.toUpperCase()}`);
  }
}

function activateTab(name) {
  dom.tabs.forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  dom.tabPanels.forEach(p => {
    p.classList.toggle('active', p.id === `tab-${name}`);
  });
}

/* ──────────────────────────────────────────────────────────────
   SECTION 15: COPY ROOM LINK
────────────────────────────────────────────────────────────── */

function copyRoomLink() {
  const url = `${window.location.origin}${window.location.pathname}?room=${state.roomId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('🔗 Link copied to clipboard!');
  }).catch(() => {
    showToast(`Share this link: ${url}`);
  });
}

/* ──────────────────────────────────────────────────────────────
   SECTION 16: EVENT LISTENERS
────────────────────────────────────────────────────────────── */

function attachEventListeners() {

  // ── Lobby tabs ──────────────────────────────────────
  dom.tabs.forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab.dataset.tab));
  });

  // ── Create Room ─────────────────────────────────────
  dom.btnCreate.addEventListener('click', async () => {
    hideLobbyError();
    const name = dom.createName.value.trim();
    if (!name) { showLobbyError('Please enter your name'); return; }
    dom.btnCreate.disabled = true;
    dom.btnCreate.querySelector('span').textContent = 'Creating…';
    try {
      await createRoom(name);
    } catch (err) {
      console.error('[Create Room]', err);
      showLobbyError('Failed to create room. Check your Firebase config.');
      dom.btnCreate.disabled = false;
      dom.btnCreate.querySelector('span').textContent = 'Create Room';
    }
  });

  // ── Join Room ───────────────────────────────────────
  dom.btnJoin.addEventListener('click', async () => {
    hideLobbyError();
    const name   = dom.joinName.value.trim();
    const roomId = dom.joinRoomId.value.trim();
    if (!name)   { showLobbyError('Please enter your name'); return; }
    if (!roomId) { showLobbyError('Please enter a room ID'); return; }
    dom.btnJoin.disabled = true;
    dom.btnJoin.querySelector('span').textContent = 'Joining…';
    try {
      await joinRoom(name, roomId);
    } catch (err) {
      console.error('[Join Room]', err);
      showLobbyError('Failed to join room. Check the room ID.');
      dom.btnJoin.disabled = false;
      dom.btnJoin.querySelector('span').textContent = 'Join Room';
    }
  });

  // Enter key in lobby inputs
  dom.createName.addEventListener('keydown', e => { if (e.key === 'Enter') dom.btnCreate.click(); });
  dom.joinRoomId.addEventListener('keydown', e => { if (e.key === 'Enter') dom.btnJoin.click(); });
  dom.joinName.addEventListener('keydown', e => { if (e.key === 'Enter') dom.btnJoin.click(); });

  // ── Leave Room ──────────────────────────────────────
  dom.btnLeave.addEventListener('click', () => {
    if (confirm('Leave this room?')) leaveRoom();
  });

  // ── Copy Room Link ──────────────────────────────────
  dom.btnCopyLink.addEventListener('click', copyRoomLink);

  // ── YouTube Load ────────────────────────────────────
  dom.btnLoadYt.addEventListener('click', handleYouTubeLoad);
  dom.ytInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleYouTubeLoad(); });

  // ── Local File Upload ───────────────────────────────
  dom.localFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleLocalFileUpload(file);
  });

  // ── Ready Button ─────────────────────────────────────
  dom.btnReady.addEventListener('click', toggleReady);

  // ── Chat ─────────────────────────────────────────────
  dom.btnSend.addEventListener('click', sendChatMessage);
  dom.chatInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChatMessage();
  });
}

/* ──────────────────────────────────────────────────────────────
   SECTION 17: YOUTUBE IFRAME API CALLBACK
   The YouTube API calls this global function when it's ready.
────────────────────────────────────────────────────────────── */

// This must be a global function — the YT API looks for window.onYouTubeIframeAPIReady
window.onYouTubeIframeAPIReady = function() {
  console.log('[YT] Iframe API ready');
  // We don't need to do anything here; player creation happens on demand
};

/* ──────────────────────────────────────────────────────────────
   SECTION 18: APP INITIALIZATION
────────────────────────────────────────────────────────────── */

function init() {
  console.log('[WatchTogether] Initializing…');

  // Initialize Firebase
  const firebaseOk = initFirebase();
  if (!firebaseOk) return;

  // Attach all UI event listeners
  attachEventListeners();

  // Check if URL contains a room ID (e.g. shared link)
  checkUrlForRoom();

  console.log('[WatchTogether] Ready');
}

// Boot the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
