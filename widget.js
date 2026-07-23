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
  // 1440 = once per day (rolls over at LOCAL midnight). Other handy values:
  // 60 = hourly, 15 = every 15 min. iOS decides *when* to actually refresh;
  // this only controls which message maps to a given moment in time.
  ROTATE_MINUTES: 1440,

  // "sequential" -> walk through the list in order, one per time bucket.
  // "random"     -> pseudo-random pick, but STABLE within a single time bucket
  //                 (seeded by the bucket number, so no persistent state needed).
  MODE: "sequential",

  // Text styling.
  FONT_SIZE: 15, // rectangular / circular body font size
  INLINE_FONT_SIZE: 12, // accessoryInline font size
  MIN_SCALE_FACTOR: 0.7, // shrink long text to fit rather than truncating hard
  TEXT_COLOR: "#FFFFFF", // lock screen tints this monochrome anyway
  LINE_LIMIT: 3, // max lines in the rectangular family

  // Frosted rectangle behind the text. false = transparent, so the text sits
  // directly on your wallpaper and uses the full widget frame (like the
  // calendar/weather text widgets). true = opaque rounded box for legibility.
  USE_ACCESSORY_BACKGROUND: false,

  // Whole-message styling defaults. These apply to EVERY message. You can also
  // style individual messages (or parts of them) with inline markup in the text
  // itself: **bold**, *italic*, or <b>…</b> / <i>…</i>. A message that is
  // entirely one style wraps across multiple lines; a message that MIXES styles
  // renders on a single line (WidgetKit can't wrap mixed-style runs).
  BOLD: false, // make all text bold
  ITALIC: true, // make all text italic (nice for quotes)

  // Networking.
  REQUEST_TIMEOUT_SECONDS: 8,

  // Fallback shown if the network fails or the URL returns nothing usable.
  // The widget must NEVER render blank or an error, so keep this non-empty.
  DEFAULT_MESSAGES: [
    "The only way to do great work is to love what you do. — Steve Jobs",
    "In the middle of difficulty lies opportunity. — Albert Einstein",
    "Not all those who wander are lost. — J.R.R. Tolkien",
    "The obstacle is the way. — Marcus Aurelius",
    "It is never too late to be what you might have been. — George Eliot",
    "Follow your bliss. — Joseph Campbell",
    "Do one thing every day that scares you. — Eleanor Roosevelt",
    "Creativity takes courage. — Henri Matisse",
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

/**
 * Pick the right system font for a bold/italic combination. Scriptable has no
 * bold-italic system helper, so bold wins when both are requested.
 */
function fontFor(size, bold, italic) {
  if (bold) return Font.boldSystemFont(size);
  if (italic) return Font.italicSystemFont(size);
  return Font.systemFont(size);
}

/**
 * Apply one styled run to a text element created by `add`, with the given size.
 * Baseline BOLD/ITALIC from CONFIG combine with the run's own inline markup.
 */
function styleText(t, run, size, color) {
  t.font = fontFor(size, CONFIG.BOLD || run.bold, CONFIG.ITALIC || run.italic);
  t.textColor = color;
}

function buildWidget(message, family, refreshAfterDate) {
  const widget = new ListWidget();

  // Frosted background: opt-in. When off, the text sits directly on the
  // wallpaper and uses the whole widget frame.
  if (
    CONFIG.USE_ACCESSORY_BACKGROUND &&
    typeof widget.addAccessoryWidgetBackground !== "undefined"
  ) {
    widget.addAccessoryWidgetBackground = true;
  }

  // Nudge iOS to refresh when the content next changes (the start of the next
  // rotation bucket, e.g. next local midnight for daily). Timing is only a hint.
  widget.refreshAfterDate = refreshAfterDate;

  const color = new Color(CONFIG.TEXT_COLOR);

  // Reduce inline markup (**bold**, *italic*, <b>, <i>) to a WHOLE-MESSAGE style
  // and strip the markers. WidgetKit has no attributed-string API, so it cannot
  // wrap a line that mixes styles — trying to do so truncates ("Progress ov…")
  // and wastes the other lines. So emphasis applies to the entire message, which
  // lets it wrap across all available lines and never truncate mid-word.
  const style = mergedStyle(parseRuns(message));
  const text = style.text;

  if (family === "accessoryInline") {
    // Single line rendered next to the clock; keep it terse.
    const t = widget.addText(text);
    styleText(t, style, CONFIG.INLINE_FONT_SIZE, color);
    t.lineLimit = 1;
    t.minimumScaleFactor = CONFIG.MIN_SCALE_FACTOR;
  } else if (family === "accessoryCircular") {
    // Tiny circular slot; center a very short snippet.
    widget.setPadding(2, 2, 2, 2);
    const stack = widget.addStack();
    stack.addSpacer();
    const inner = stack.addStack();
    inner.addSpacer();
    const t = inner.addText(text);
    styleText(t, style, CONFIG.FONT_SIZE - 3, color);
    t.lineLimit = 2;
    t.minimumScaleFactor = 0.5;
    t.centerAlignText();
    inner.addSpacer();
    stack.addSpacer();
  } else {
    // Default: accessoryRectangular (also the fallback for unknown families).
    // One wrapping text element filling the full frame across up to LINE_LIMIT
    // lines. The trailing spacer forces the row out to the full width.
    widget.setPadding(0, 0, 0, 0);
    const row = widget.addStack();
    row.layoutHorizontally();
    const t = row.addText(text);
    styleText(t, style, CONFIG.FONT_SIZE, color);
    t.lineLimit = CONFIG.LINE_LIMIT;
    t.minimumScaleFactor = CONFIG.MIN_SCALE_FACTOR;
    t.leftAlignText();
    row.addSpacer();
  }

  return widget;
}

// ============================================================================
// Entry point
// ============================================================================

async function main() {
  const messages = await loadMessages();

  // Bucket by LOCAL time so a daily rotation flips at local midnight rather than
  // UTC. getTimezoneOffset() is (UTC - local) in minutes, so subtracting it from
  // the real time gives a "local" clock we can bucket; we add it back to convert
  // a bucket boundary into a real refresh timestamp.
  const offsetMs = new Date().getTimezoneOffset() * 60 * 1000;
  const nowLocal = Date.now() - offsetMs;

  // Deterministically choose the message from the current (local) time.
  const index = pickIndex(nowLocal, messages.length, CONFIG);
  const message = messages[index];

  // Hint iOS to refresh at the start of the next bucket (e.g. next midnight).
  const refreshAfterDate = new Date(
    nextBoundaryMs(nowLocal, CONFIG.ROTATE_MINUTES) + offsetMs
  );

  // The family iOS is rendering (only meaningful inside a real widget).
  const family = config.widgetFamily || "accessoryRectangular";
  const widget = buildWidget(message, family, refreshAfterDate);

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
 * Epoch ms at the START of the bucket AFTER the one containing `nowMs`.
 * Used as the iOS refresh hint — the next moment the message changes.
 * @param {number} nowMs
 * @param {number} rotateMinutes
 * @returns {number}
 */
function nextBoundaryMs(nowMs, rotateMinutes) {
  const windowMs = Math.max(1, rotateMinutes) * 60 * 1000;
  return (bucketFor(nowMs, rotateMinutes) + 1) * windowMs;
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
// Inline text markup -> styled runs (pure; no Scriptable globals).
// ----------------------------------------------------------------------------

/**
 * Parse lightweight inline markup into an array of styled runs.
 * Supported: **bold**, *italic*, <b>…</b>, <strong>…</strong>, <i>…</i>,
 * <em>…</em>. `**` toggles bold, a lone `*` toggles italic; HTML tags open/close
 * explicitly. Unknown/stray markers are treated as literal text.
 * Always returns at least one run (possibly empty text) so callers are simple.
 * @param {string} input
 * @returns {Array<{text:string, bold:boolean, italic:boolean}>}
 */
function parseRuns(input) {
  const s = String(input == null ? "" : input);
  const runs = [];
  let bold = false;
  let italic = false;
  let buf = "";
  const flush = () => {
    if (buf.length > 0) {
      runs.push({ text: buf, bold, italic });
      buf = "";
    }
  };
  // Ordered so multi-char tokens are tested before their single-char prefixes.
  const tags = [
    { m: "<b>", set: () => (bold = true) },
    { m: "</b>", set: () => (bold = false) },
    { m: "<strong>", set: () => (bold = true) },
    { m: "</strong>", set: () => (bold = false) },
    { m: "<i>", set: () => (italic = true) },
    { m: "</i>", set: () => (italic = false) },
    { m: "<em>", set: () => (italic = true) },
    { m: "</em>", set: () => (italic = false) },
    { m: "**", set: () => (bold = !bold) },
    { m: "*", set: () => (italic = !italic) },
  ];
  let i = 0;
  outer: while (i < s.length) {
    for (const tag of tags) {
      if (s.startsWith(tag.m, i)) {
        flush();
        tag.set();
        i += tag.m.length;
        continue outer;
      }
    }
    buf += s[i];
    i += 1;
  }
  flush();
  return runs.length > 0 ? runs : [{ text: "", bold: false, italic: false }];
}

/** Concatenate run texts back into a plain string (markup stripped). */
function plainText(runs) {
  return runs.map((r) => r.text).join("");
}

/** Collapse runs into one style: bold/italic if ANY run is bold/italic. */
function mergedStyle(runs) {
  return {
    text: plainText(runs),
    bold: runs.some((r) => r.bold),
    italic: runs.some((r) => r.italic),
  };
}

// ----------------------------------------------------------------------------
// Export pure logic for Node tests; guarded so Scriptable (no `module`) ignores.
// ----------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    pickIndex,
    bucketFor,
    nextBoundaryMs,
    hashInt,
    sanitizeMessages,
    parseRuns,
    plainText,
    mergedStyle,
  };
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
