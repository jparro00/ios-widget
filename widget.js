// rotating-messages.js
// -----------------------------------------------------------------------------
// Scriptable (iOS) lock-screen widget that shows a rotating text message/quote.
//
// Target: iOS 16+ lock screen accessory widgets.
//   - Primary family:  accessoryRectangular (multi-line box under the clock)
//   - Also handles:     accessoryInline (single line) and accessoryCircular (tiny)
//
// The script is STATELESS and DETERMINISTIC: given the current time it always
// picks the same message, so it advances on each iOS refresh without needing any
// persistent storage. Refresh timing is controlled by iOS and is NOT guaranteed
// or real-time (see README).
//
// The pure rotation logic (pickIndex / bucketFor) is factored out at the bottom
// and exported under Node for testing. Scriptable ignores that export.
// -----------------------------------------------------------------------------

// ============================================================================
// CONFIG  — all tunables live here
// ============================================================================
const CONFIG = {
  // URL returning a JSON array of strings, e.g. ["Stay steady.", "Breathe."]
  // Default: messages.json hosted from this repo via GitHub's raw endpoint
  // (works with no extra setup). Swap for your GitHub Pages URL, Gist, S3, or
  // any static host — see README "Hosting the JSON".
  MESSAGES_URL:
    "https://raw.githubusercontent.com/jparro00/ios-widget/claude/scriptable-lockscreen-widget-jui7kx/messages.json",

  // How often (in minutes) the displayed message advances to the next one.
  // iOS decides *when* to actually refresh; this only controls which message
  // maps to a given moment in time.
  ROTATE_MINUTES: 15,

  // "sequential" -> walk through the list in order, one per time bucket.
  // "random"     -> pseudo-random pick, but STABLE within a single time bucket
  //                 (seeded by the bucket number, so no persistent state needed).
  MODE: "sequential",

  // Text styling.
  FONT_SIZE: 14, // rectangular / circular body font size
  INLINE_FONT_SIZE: 12, // accessoryInline font size
  MIN_SCALE_FACTOR: 0.7, // shrink long text to fit rather than truncating hard
  TEXT_COLOR: "#FFFFFF", // lock screen tints this monochrome anyway
  LINE_LIMIT: 3, // max lines in the rectangular family

  // Networking.
  REQUEST_TIMEOUT_SECONDS: 8,

  // Fallback shown if the network fails or the URL returns nothing usable.
  // The widget must NEVER render blank or an error, so keep this non-empty.
  DEFAULT_MESSAGES: [
    "Stay steady.",
    "One thing at a time.",
    "Breathe. Then begin.",
    "Progress over perfection.",
    "You've done hard things before.",
    "Small steps still count.",
  ],
};

// ============================================================================
// Data fetching
// ============================================================================

/**
 * Fetch the messages array from CONFIG.MESSAGES_URL.
 * Always resolves to a non-empty array of trimmed strings; on any failure
 * (network error, bad JSON, empty/invalid payload) it falls back to
 * CONFIG.DEFAULT_MESSAGES so the widget can never render blank.
 */
async function loadMessages() {
  try {
    const req = new Request(CONFIG.MESSAGES_URL);
    req.timeoutInterval = CONFIG.REQUEST_TIMEOUT_SECONDS;
    const data = await req.loadJSON();

    const cleaned = sanitizeMessages(data);
    if (cleaned.length > 0) return cleaned;
  } catch (e) {
    // Swallow and fall through to defaults; log for in-app debugging only.
    console.log("loadMessages failed, using defaults: " + e);
  }
  return CONFIG.DEFAULT_MESSAGES.slice();
}

/**
 * Coerce an arbitrary JSON payload into a clean array of non-empty strings.
 * Accepts either a raw array of strings, or an object with a `messages` array.
 */
function sanitizeMessages(data) {
  let arr = data;
  if (data && !Array.isArray(data) && Array.isArray(data.messages)) {
    arr = data.messages;
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ============================================================================
// Widget rendering
// ============================================================================

function buildWidget(message, family) {
  const widget = new ListWidget();

  // Frosted background improves legibility of tinted lock-screen widgets.
  if (typeof widget.addAccessoryWidgetBackground !== "undefined") {
    widget.addAccessoryWidgetBackground = true;
  }

  // Nudge iOS about when the content next changes. Timing is only a hint.
  widget.refreshAfterDate = new Date(
    Date.now() + CONFIG.ROTATE_MINUTES * 60 * 1000
  );

  const color = new Color(CONFIG.TEXT_COLOR);

  if (family === "accessoryInline") {
    // Single line rendered next to the clock; keep it terse.
    const t = widget.addText(message);
    t.font = Font.systemFont(CONFIG.INLINE_FONT_SIZE);
    t.textColor = color;
    t.lineLimit = 1;
    t.minimumScaleFactor = CONFIG.MIN_SCALE_FACTOR;
  } else if (family === "accessoryCircular") {
    // Tiny circular slot; center a very short snippet.
    widget.setPadding(2, 2, 2, 2);
    const stack = widget.addStack();
    stack.addSpacer();
    const inner = stack.addStack();
    inner.addSpacer();
    const t = inner.addText(message);
    t.font = Font.systemFont(CONFIG.FONT_SIZE - 2);
    t.textColor = color;
    t.lineLimit = 2;
    t.minimumScaleFactor = 0.5;
    t.centerAlignText();
    inner.addSpacer();
    stack.addSpacer();
  } else {
    // Default: accessoryRectangular (also a safe fallback for unknown families).
    // The slot has a fixed frame, but by default text hugs its own width. To
    // make content span the FULL width, put the text in a horizontal stack and
    // add a trailing spacer: the spacer eats all leftover space, forcing the
    // stack (and thus the text's wrap width) out to the edges.
    widget.setPadding(2, 0, 2, 0);
    const row = widget.addStack();
    row.layoutHorizontally();
    const t = row.addText(message);
    t.font = Font.systemFont(CONFIG.FONT_SIZE);
    t.textColor = color;
    t.lineLimit = CONFIG.LINE_LIMIT;
    t.minimumScaleFactor = CONFIG.MIN_SCALE_FACTOR;
    t.leftAlignText();
    row.addSpacer(); // expand the row to the full available width
  }

  return widget;
}

// ============================================================================
// Entry point
// ============================================================================

async function main() {
  const messages = await loadMessages();

  // Deterministically choose the message from the current time.
  const index = pickIndex(Date.now(), messages.length, CONFIG);
  const message = messages[index];

  // The family iOS is rendering (only meaningful inside a real widget).
  const family = config.widgetFamily || "accessoryRectangular";
  const widget = buildWidget(message, family);

  if (config.runsInWidget) {
    // Running as an actual lock-screen widget.
    Script.setWidget(widget);
  } else {
    // Running inside the Scriptable app for testing / preview.
    console.log("Message (" + (index + 1) + "/" + messages.length + "): " + message);
    if (typeof widget.presentAccessoryRectangular === "function") {
      widget.presentAccessoryRectangular();
    } else if (typeof widget.presentSmall === "function") {
      // Older Scriptable builds: fall back to the small preview.
      widget.presentSmall();
    }
  }

  Script.complete();
}

// ============================================================================
// PURE ROTATION LOGIC  (no Scriptable globals — unit-testable in Node)
// ============================================================================

/**
 * Which time bucket does `nowMs` fall into?
 * A bucket is `rotateMinutes` wide; it increments every rotateMinutes.
 * @param {number} nowMs        - epoch milliseconds (e.g. Date.now())
 * @param {number} rotateMinutes
 * @returns {number} non-negative integer bucket index
 */
function bucketFor(nowMs, rotateMinutes) {
  const windowMs = Math.max(1, rotateMinutes) * 60 * 1000;
  return Math.floor(nowMs / windowMs);
}

/**
 * Deterministic 32-bit hash of an integer (xorshift-style avalanche).
 * Used to spread sequential bucket numbers across the message list in
 * "random" mode while staying stable within a bucket.
 * @param {number} n
 * @returns {number} unsigned 32-bit integer
 */
function hashInt(n) {
  let x = n >>> 0;
  x ^= x << 13;
  x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;
  x >>>= 0;
  return x >>> 0;
}

/**
 * Choose the message index deterministically from the current time.
 * Guaranteed to return an integer in [0, count) for count > 0.
 * @param {number} nowMs  - epoch milliseconds
 * @param {number} count  - number of available messages
 * @param {{ROTATE_MINUTES:number, MODE:string}} cfg
 * @returns {number}
 */
function pickIndex(nowMs, count, cfg) {
  if (!count || count <= 0) return 0;
  const bucket = bucketFor(nowMs, cfg.ROTATE_MINUTES);
  if (cfg.MODE === "random") {
    return hashInt(bucket) % count;
  }
  // sequential (default): walk the list in order, wrapping around.
  return ((bucket % count) + count) % count;
}

// ----------------------------------------------------------------------------
// Export pure logic for Node tests; guarded so Scriptable (no `module`) ignores.
// ----------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = { pickIndex, bucketFor, hashInt, sanitizeMessages };
}

// ----------------------------------------------------------------------------
// Run only inside Scriptable (where the globals actually exist). We deliberately
// avoid top-level `await` so the file stays a plain CommonJS module that Node's
// require() can load for testing; Scriptable keeps its event loop alive for the
// pending promise and Script.complete() (inside main) finishes the run.
// ----------------------------------------------------------------------------
if (typeof config !== "undefined" && typeof ListWidget !== "undefined") {
  main().catch((e) => {
    console.log("widget error: " + e);
    if (typeof Script !== "undefined") Script.complete();
  });
}
