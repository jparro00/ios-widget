# Rotating Messages — Scriptable Lock Screen Widget

A tiny [Scriptable](https://scriptable.app) widget for the **iOS 16+ lock screen**
that displays a rotating text message or quote. It fetches a list of messages from
a URL you control, falls back to built-in defaults if the network fails, and picks
which message to show **deterministically from the current time** — so it advances
on every iOS refresh without storing any state.

- **Primary family:** `accessoryRectangular` (multi-line box under the clock)
- **Also handled:** `accessoryInline` (single line by the clock) and `accessoryCircular` (tiny)

> ⚠️ **Refresh timing is controlled by iOS, not this script.** iOS budgets widget
> updates and does not guarantee real-time or on-the-minute refreshes. The widget is
> designed to be *correct whenever* iOS decides to refresh, not to tick like a clock.
> See [Refresh timing](#refresh-timing-important).

---

## Files

| File | Purpose |
| --- | --- |
| `widget.js` | The Scriptable widget script. Copy this into the Scriptable app. |
| `messages.json` | Sample payload — a JSON array of strings you host somewhere. |
| `test/rotation.test.js` | Node test for the pure rotation logic (no iOS needed). |
| `package.json` | Lets you run `npm test`. |

---

## Quick start

1. **Host your messages JSON** (see [Hosting the JSON](#hosting-the-json)).
2. **Install Scriptable** and add `widget.js` (see [Install the script](#install-the-script)).
3. **Set `MESSAGES_URL`** in the script's CONFIG block to your hosted URL.
4. **Add the lock screen widget** and assign the script (see [Add the lock screen widget](#add-the-lock-screen-widget)).

---

## Install Scriptable and the script

### Install Scriptable

1. Open the **App Store** on your iPhone and install **Scriptable** (free, by Simon B. Støvring).
2. Launch it once so it creates its scripts folder.

### Install the script

**Option A — copy/paste (simplest):**
1. In Scriptable, tap the **＋** (top-right) to create a new script.
2. Delete the placeholder, then paste the entire contents of `widget.js`.
3. Tap the script's title (top) and rename it to something memorable, e.g. **Rotating Messages**.
4. Tap **Done**.

**Option B — from a file:**
1. Put `widget.js` in your iCloud Drive **Scriptable** folder (`iCloud Drive → Scriptable`).
2. It will appear in the Scriptable app automatically.

### Configure

Open the script and edit the **CONFIG** block at the top:

```js
const CONFIG = {
  MESSAGES_URL: "https://gist.githubusercontent.com/USERNAME/GIST_ID/raw/messages.json",
  ROTATE_MINUTES: 15,          // how often the message advances
  MODE: "sequential",          // "sequential" or "random"
  FONT_SIZE: 14,
  // ...styling...
};
```

At minimum, set `MESSAGES_URL` to your hosted JSON (next section). If you skip this,
the widget still works and shows the built-in `DEFAULT_MESSAGES`.

### Test it inside the app

With the script open, tap the **▶ (Play)** button. Because it's running inside the
app (not as a widget), it prints the chosen message to the console and shows an
**accessory rectangular preview**. This confirms your URL and rotation work before
you place the widget.

---

## Hosting the JSON

The widget expects a URL that returns a **JSON array of strings**:

```json
["Stay steady.", "One thing at a time.", "Breathe. Then begin."]
```

An object form is also accepted: `{ "messages": ["...", "..."] }`.

`messages.json` already lives in this repo, so you have two ready-made ways to
host it without leaving GitHub. To change your messages later, just edit
`messages.json` and commit — the widget picks up the new list on its next fetch.

### Option 1 — GitHub raw URL (zero setup, already works)

The file is served straight from the repo at:

```
https://raw.githubusercontent.com/jparro00/ios-widget/claude/scriptable-lockscreen-widget-jui7kx/messages.json
```

This is the **default `MESSAGES_URL`** already set in `widget.js`, so it works out
of the box. Notes:

- `raw.githubusercontent.com` serves with `Content-Type: text/plain`, but
  Scriptable's `loadJSON()` parses it regardless — no problem.
- GitHub's raw CDN caches for ~5 minutes, so edits take a few minutes to show up.
- The URL pins the branch name. If you rename the branch (e.g. to `main`), update
  the URL to match.

### Option 2 — GitHub Pages (cleaner, stable URL)

Pages gives you a short URL and a proper `application/json` content type.

1. On GitHub, go to the repo **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Set **Branch** to `claude/scriptable-lockscreen-widget-jui7kx` (or `main` if you
   rename it) and folder to **`/ (root)`**, then **Save**.
4. Wait ~1 minute for the first build. Your file is then at:

   ```
   https://jparro00.github.io/ios-widget/messages.json
   ```

5. Paste that into `MESSAGES_URL` in `widget.js`.

> Pages only publishes the repo's default branch (or whichever branch you pick).
> Since `messages.json` sits at the repo root, root is the correct folder.

### Option 3 — Anywhere else

Any static host works — the widget just needs an HTTPS URL returning the JSON array.

#### GitHub Gist (separate from this repo)

1. Go to <https://gist.github.com>, create a new **public** gist.
2. Name the file `messages.json` and paste your array.
3. Create the gist, then click **Raw**.
4. Copy that URL — it looks like
   `https://gist.githubusercontent.com/USERNAME/GIST_ID/raw/messages.json` —
   and paste it into `MESSAGES_URL`.

> Tip: the `/raw/` URL *without* a commit hash always serves the latest version, so
> you can edit the gist later and the widget will pick up new messages.

#### Other hosts

- **Amazon S3 / Cloudflare R2:** upload `messages.json`, make it public, use its object URL.
- **Netlify / Vercel / any static host:** drop the file in and use its URL.
- **Your own server:** just return the JSON array with `Content-Type: application/json`.

Whatever you pick, make sure it's reachable over **HTTPS** and publicly readable.

---

## Add the lock screen widget

1. **Lock your iPhone**, then **touch and hold the lock screen** and tap **Customize**.
   (Or: Settings → Wallpaper → Customize.)
2. Tap the **lock screen** preview, then tap the area **below the clock** to add
   accessory widgets.
3. In the widget picker, scroll to **Scriptable** and choose a size:
   - **Rectangular** (recommended) → maps to `accessoryRectangular`.
   - **Inline** (the slot *above* the clock) → `accessoryInline`.
   - **Circular** → `accessoryCircular`.
4. The placed widget will say "Select" / show the Scriptable icon. **Tap it** to
   open its settings.
5. Set **Script** to your **Rotating Messages** script.
6. Leave **When Interacting** as **Run Script** (default) if you want tapping it to
   open Scriptable; it's optional.
7. Tap **Done** / **✕** to save, then **Done** on the lock screen.

The widget now shows a message and advances over time as iOS refreshes it.

---

## Rotation modes

`MODE` in CONFIG controls how the current message is chosen. The script divides
time into buckets `ROTATE_MINUTES` wide (`bucket = floor(now / ROTATE_MINUTES)`):

- **`"sequential"`** — walks the list in order, one message per bucket, wrapping
  around at the end. Predictable and orderly.
- **`"random"`** — hashes the bucket number to pick a pseudo-random message. It's
  **stable within a bucket** (same message all 15 minutes) but jumps around between
  buckets. No persistent storage needed because the bucket number is the seed.

Both modes are **deterministic**: the same moment in time always yields the same
message, which is what lets the widget be stateless.

---

## Refresh timing (important)

iOS — not this script — decides when a lock screen widget actually re-renders. It
uses a system refresh budget and may update less often than `ROTATE_MINUTES`,
especially in Low Power Mode or when the phone is idle. The script:

- sets `widget.refreshAfterDate = now + ROTATE_MINUTES` as a **hint** to iOS, and
- is **correct at whatever time it runs** (message derived from the clock),

but you should treat rotation as "roughly every `ROTATE_MINUTES`," not exact.

### Optional: nudge refreshes with a Shortcuts automation

You can gently encourage more frequent updates by running the script on a schedule.
This does **not** override iOS's budget, but running the script can prompt a refresh.

1. Open the **Shortcuts** app → **Automation** tab → **＋** → **Create Personal Automation**.
2. Choose **Time of Day** (or **App**, etc.), pick a schedule (e.g. every hour), tap **Next**.
3. Add action **Run Script** (from Scriptable) and select **Rotating Messages**.
4. Tap **Next**, turn **off** *Ask Before Running*, and **Done**.

Note: Time-of-Day automations fire at a single time; for multiple times per day,
create several automations. This is a best-effort nudge, not a guarantee.

---

## Development / testing

The rotation logic (choosing a message index from a timestamp + config) is factored
into pure functions at the bottom of `widget.js` and exported for Node. Scriptable's
globals aren't needed to test it.

```bash
npm test
# or:
node test/rotation.test.js
```

The test verifies that:
- buckets advance every `ROTATE_MINUTES` and are stable within a window,
- **sequential** mode walks the list in order and wraps,
- **random** mode is deterministic and stable within a bucket but varies across buckets,
- the chosen index is always in range `[0, count)` for both modes,
- edge cases (0 or 1 messages) never throw,
- `sanitizeMessages` cleans arbitrary payloads into usable strings.

---

## License

MIT
