// Standalone Node test for the pure rotation logic in ../widget.js.
//
// Scriptable's globals (ListWidget, Request, config, Font, Color, Script) do not
// exist in Node, so widget.js only runs main() when those globals are present.
// Under Node it just exports the pure functions, which we exercise here.
//
// Run with:  node test/rotation.test.js
// Exits non-zero if any assertion fails.

const assert = require("assert");
const {
  pickIndex,
  bucketFor,
  nextBoundaryMs,
  hashInt,
  sanitizeMessages,
  parseRuns,
  plainText,
  mergedStyle,
} = require("../widget.js");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log("  ok - " + name);
}

const MIN = 60 * 1000;

console.log("bucketFor:");

check("bucket advances every ROTATE_MINUTES", () => {
  const rotate = 15;
  const t0 = 0;
  assert.strictEqual(bucketFor(t0, rotate), 0);
  assert.strictEqual(bucketFor(t0 + 14 * MIN, rotate), 0); // same bucket
  assert.strictEqual(bucketFor(t0 + 15 * MIN, rotate), 1); // next bucket
  assert.strictEqual(bucketFor(t0 + 30 * MIN, rotate), 2);
});

check("bucket is stable anywhere inside the window", () => {
  const rotate = 15;
  const base = 15 * MIN; // start of bucket 1
  for (let m = 0; m < 15; m++) {
    assert.strictEqual(bucketFor(base + m * MIN, rotate), 1);
  }
});

console.log("pickIndex (sequential):");

check("sequential walks the list in order and wraps", () => {
  const cfg = { ROTATE_MINUTES: 15, MODE: "sequential" };
  const count = 4;
  const seq = [];
  for (let b = 0; b < 6; b++) {
    seq.push(pickIndex(b * 15 * MIN, count, cfg));
  }
  assert.deepStrictEqual(seq, [0, 1, 2, 3, 0, 1]); // wraps after `count`
});

check("sequential is deterministic for the same time", () => {
  const cfg = { ROTATE_MINUTES: 15, MODE: "sequential" };
  const t = 1_700_000_000_000;
  assert.strictEqual(pickIndex(t, 5, cfg), pickIndex(t, 5, cfg));
});

check("sequential is stable within one bucket", () => {
  const cfg = { ROTATE_MINUTES: 15, MODE: "sequential" };
  const base = 3 * 15 * MIN;
  const first = pickIndex(base, 7, cfg);
  for (let m = 0; m < 15; m++) {
    assert.strictEqual(pickIndex(base + m * MIN, 7, cfg), first);
  }
});

console.log("daily rotation (ROTATE_MINUTES = 1440):");

const DAY = 24 * 60 * MIN;

check("index is constant for a whole day, then advances once", () => {
  const cfg = { ROTATE_MINUTES: 1440, MODE: "sequential" };
  const day0 = 5 * DAY; // start of some day
  // Stable all day: sample every hour.
  const first = pickIndex(day0, 7, cfg);
  for (let h = 0; h < 24; h++) {
    assert.strictEqual(pickIndex(day0 + h * 60 * MIN, 7, cfg), first);
  }
  // Next day advances by exactly one.
  assert.strictEqual(pickIndex(day0 + DAY, 7, cfg), (first + 1) % 7);
});

console.log("nextBoundaryMs:");

check("returns the start of the next bucket", () => {
  assert.strictEqual(nextBoundaryMs(0, 15), 15 * MIN);
  assert.strictEqual(nextBoundaryMs(14 * MIN, 15), 15 * MIN);
  assert.strictEqual(nextBoundaryMs(15 * MIN, 15), 30 * MIN);
});

check("for daily rotation, boundary is the next midnight-of-bucket", () => {
  const day0 = 10 * DAY;
  assert.strictEqual(nextBoundaryMs(day0, 1440), 11 * DAY);
  assert.strictEqual(nextBoundaryMs(day0 + 12 * 60 * MIN, 1440), 11 * DAY);
});

check("boundary is always strictly in the future", () => {
  for (const rotate of [15, 60, 1440]) {
    for (let t = 0; t < 5_000_000; t += 123457) {
      assert.ok(nextBoundaryMs(t, rotate) > t);
    }
  }
});

console.log("pickIndex (random):");

check("random is deterministic and stable within a bucket", () => {
  const cfg = { ROTATE_MINUTES: 15, MODE: "random" };
  const base = 42 * 15 * MIN;
  const first = pickIndex(base, 10, cfg);
  for (let m = 0; m < 15; m++) {
    assert.strictEqual(pickIndex(base + m * MIN, 10, cfg), first);
  }
});

check("random changes across buckets (not a constant)", () => {
  const cfg = { ROTATE_MINUTES: 15, MODE: "random" };
  const seen = new Set();
  for (let b = 0; b < 50; b++) {
    seen.add(pickIndex(b * 15 * MIN, 10, cfg));
  }
  assert.ok(seen.size > 1, "random mode should not always pick the same index");
});

console.log("pickIndex (range / edge cases):");

check("index always in [0, count) across many buckets, both modes", () => {
  for (const mode of ["sequential", "random"]) {
    const cfg = { ROTATE_MINUTES: 15, MODE: mode };
    for (const count of [1, 2, 3, 7, 13, 100]) {
      for (let b = 0; b < 300; b++) {
        const i = pickIndex(b * 15 * MIN + 123456, count, cfg);
        assert.ok(
          Number.isInteger(i) && i >= 0 && i < count,
          `mode=${mode} count=${count} bucket=${b} -> ${i} out of range`
        );
      }
    }
  }
});

check("count of 0 or missing returns 0 (never throws)", () => {
  const cfg = { ROTATE_MINUTES: 15, MODE: "sequential" };
  assert.strictEqual(pickIndex(Date.now(), 0, cfg), 0);
  assert.strictEqual(pickIndex(Date.now(), undefined, cfg), 0);
});

check("count of 1 always returns 0", () => {
  for (const mode of ["sequential", "random"]) {
    const cfg = { ROTATE_MINUTES: 15, MODE: mode };
    for (let b = 0; b < 20; b++) {
      assert.strictEqual(pickIndex(b * 15 * MIN, 1, cfg), 0);
    }
  }
});

check("different ROTATE_MINUTES changes bucketing", () => {
  const t = 20 * MIN;
  assert.strictEqual(bucketFor(t, 15), 1); // 20min / 15 -> bucket 1
  assert.strictEqual(bucketFor(t, 10), 2); // 20min / 10 -> bucket 2
  assert.strictEqual(bucketFor(t, 30), 0); // 20min / 30 -> bucket 0
});

console.log("hashInt:");

check("hashInt is a pure, unsigned 32-bit function", () => {
  assert.strictEqual(hashInt(12345), hashInt(12345));
  const h = hashInt(987654321);
  assert.ok(h >= 0 && h <= 0xffffffff);
});

console.log("sanitizeMessages:");

check("accepts a plain array of strings, trims and drops empties", () => {
  assert.deepStrictEqual(
    sanitizeMessages(["  a  ", "b", "", "   ", "c"]),
    ["a", "b", "c"]
  );
});

check("accepts an object with a messages array", () => {
  assert.deepStrictEqual(
    sanitizeMessages({ messages: ["x", " y "] }),
    ["x", "y"]
  );
});

check("rejects non-arrays and non-string entries", () => {
  assert.deepStrictEqual(sanitizeMessages(null), []);
  assert.deepStrictEqual(sanitizeMessages(42), []);
  assert.deepStrictEqual(sanitizeMessages(["ok", 5, null, {}, "yes"]), ["ok", "yes"]);
});

console.log("parseRuns (inline markup):");

check("plain text is a single unstyled run", () => {
  assert.deepStrictEqual(parseRuns("Stay steady."), [
    { text: "Stay steady.", bold: false, italic: false },
  ]);
});

check("**bold** produces a bold run and strips markers", () => {
  const runs = parseRuns("Stay **steady**.");
  assert.deepStrictEqual(runs, [
    { text: "Stay ", bold: false, italic: false },
    { text: "steady", bold: true, italic: false },
    { text: ".", bold: false, italic: false },
  ]);
  assert.strictEqual(plainText(runs), "Stay steady.");
});

check("*italic* produces an italic run", () => {
  const runs = parseRuns("Be *here* now");
  assert.deepStrictEqual(runs.map((r) => r.italic), [false, true, false]);
  assert.strictEqual(plainText(runs), "Be here now");
});

check("HTML <b> and <i> tags style and strip", () => {
  const runs = parseRuns("<b>Do</b> the <i>next</i> thing");
  assert.strictEqual(plainText(runs), "Do the next thing");
  assert.strictEqual(runs.find((r) => r.text === "Do").bold, true);
  assert.strictEqual(runs.find((r) => r.text === "next").italic, true);
});

check("nested/overlapping bold+italic yields a run that is both", () => {
  const runs = parseRuns("**<i>whoa</i>**");
  assert.strictEqual(plainText(runs), "whoa");
  assert.strictEqual(runs.length, 1);
  assert.deepStrictEqual(
    { bold: runs[0].bold, italic: runs[0].italic },
    { bold: true, italic: true }
  );
});

check("empty / nullish input returns one empty run (never throws)", () => {
  assert.deepStrictEqual(parseRuns(""), [
    { text: "", bold: false, italic: false },
  ]);
  assert.deepStrictEqual(parseRuns(null), [
    { text: "", bold: false, italic: false },
  ]);
});

check("mergedStyle is bold/italic if ANY run is", () => {
  const runs = parseRuns("plain **b** and *i*");
  const m = mergedStyle(runs);
  assert.strictEqual(m.text, "plain b and i");
  assert.strictEqual(m.bold, true);
  assert.strictEqual(m.italic, true);
});

console.log("\nAll " + passed + " checks passed.");
