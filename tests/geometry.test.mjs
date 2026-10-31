import { test } from "node:test";
import assert from "node:assert/strict";
import {
  orderedLines,
  focusWindows,
  csvCell,
  readingStep,
} from "../src/geometry.mjs";
const line = (x, y, text, w = 0.38) => ({ x, y, w, h: 0.015, text });

test("mixed font ascenders on a shared baseline remain one reading line", () => {
  const rows = orderedLines([
    {
      ...line(0.18, 0.2, "text before", 0.3),
      baseline: 0.215,
      fontHeight: 0.012,
    },
    { ...line(0.485, 0.204, ">", 0.01), baseline: 0.215, fontHeight: 0.012 },
    {
      ...line(0.498, 0.2, "text after", 0.3),
      baseline: 0.215,
      fontHeight: 0.012,
    },
    {
      ...line(0.18, 0.218, "bold prefix", 0.1),
      baseline: 0.233,
      fontHeight: 0.012,
    },
    {
      ...line(0.285, 0.214, "regular suffix", 0.51),
      baseline: 0.233,
      fontHeight: 0.012,
    },
  ]);
  assert.equal(rows.length, 2);
  assert.match(rows[0].text, /text before > text after/);
  assert.match(rows[1].text, /bold prefix regular suffix/);
  const windows = focusWindows(rows, 0, 2);
  assert.equal(windows.length, 1);
  for (const r of rows) {
    assert.ok(windows[0].y <= r.y);
    assert.ok(windows[0].y + windows[0].h >= r.y + r.h);
  }
});
test("vertical margin watermarks are excluded from line navigation", () => {
  const rows = orderedLines([
    line(0.1, 0.2, "body"),
    { ...line(0.94, 0.1, "Downloaded from journal", 0.05), angle: Math.PI / 2 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.text),
    ["body"],
  );
});
test("half-window movement rounds odd line counts down", () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, i) => readingStep(i + 1)),
    [1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6],
  );
});
test("two-column PDFs read down the left column, then the right", () => {
  const result = orderedLines([
    line(0.55, 0.2, "R2"),
    line(0.08, 0.1, "L1"),
    line(0.55, 0.1, "R1"),
    line(0.08, 0.2, "L2"),
  ]);
  assert.deepEqual(
    result.map((l) => l.text),
    ["L1", "L2", "R1", "R2"],
  );
});
test("full-width headings divide two-column sections", () => {
  const result = orderedLines([
    line(0.08, 0.02, "Heading", 0.8),
    line(0.55, 0.1, "Right"),
    line(0.08, 0.1, "Left"),
    line(0.08, 0.25, "Next section", 0.8),
    line(0.08, 0.3, "Second left"),
    line(0.55, 0.3, "Second right"),
  ]);
  assert.deepEqual(
    result.map((l) => l.text),
    ["Heading", "Left", "Right", "Next section", "Second left", "Second right"],
  );
});
test("adjacent text fragments on one line are combined", () => {
  const result = orderedLines([
    line(0.1, 0.1, "immune", 0.1),
    line(0.205, 0.1, "cells", 0.08),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].text, "immune cells");
});
test("focus windows do not expose the space between columns", () => {
  const rects = focusWindows(
    [line(0.08, 0.3, "last left"), line(0.55, 0.1, "first right")],
    0,
    2,
  );
  assert.equal(rects.length, 2);
  assert.ok(rects.every((r) => r.w < 0.45));
});
test("adjacent focus lines form one continuous reading window", () => {
  const rects = focusWindows(
    [line(0.1, 0.1, "a"), line(0.1, 0.12, "b"), line(0.1, 0.14, "c")],
    0,
    3,
  );
  assert.equal(rects.length, 1);
  assert.ok(rects[0].h > 0.05);
});
test("CSV exports quote commas and protect against formula execution", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
});
