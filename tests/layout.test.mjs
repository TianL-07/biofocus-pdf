import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzePageLayout, buildDocumentProfile } from "../src/layout.mjs";
import {
  orderedLines,
  focusWindows,
  advanceReadingIndex,
} from "../src/geometry.mjs";
const fragment = (text, x, y, w = 0.4, fontSize = 10) => ({
  text,
  x,
  y,
  w,
  h: fontSize / 800,
  fontHeight: fontSize / 800,
  fontSize,
  baseline: y + (fontSize / 800) * 0.8,
  angle: 0,
});
const identify = (items) => items.map((item, id) => ({ ...item, id }));
const body = (x, y, prefix = "Body", rows = 5) =>
  Array.from({ length: rows }, (_, i) =>
    fragment(
      prefix +
        " " +
        i +
        " describes the experimental observations in this study.",
      x,
      y + i * 0.02,
    ),
  );
const profile = { bodyFont: 10, runningText: [] };
test("a narrow gutter splits matching baselines and focus remains in one column", () => {
  const lines = orderedLines(
    identify([...body(0.07, 0.2, "Left"), ...body(0.49, 0.2, "Right")]),
  );
  assert.deepEqual(
    lines.map((l) => l.text.split(" ")[0]),
    [...Array(5).fill("Left"), ...Array(5).fill("Right")],
  );
  assert.ok(lines.every((l) => l.w < 0.43));
  const focus = focusWindows(lines, 4, 6);
  assert.equal(focus.length, 1);
  assert.ok(focus[0].x + focus[0].w < 0.49);
  assert.equal(advanceReadingIndex(lines, 4, 3), 5);
  assert.equal(advanceReadingIndex(lines, 5, -3), 4);
});
test("columns with offset baselines still read left to bottom then right to bottom", () => {
  const lines = orderedLines(
    identify([...body(0.07, 0.2, "Left", 6), ...body(0.51, 0.211, "Right", 6)]),
  );
  assert.equal(lines.length, 12);
  assert.ok(lines.slice(0, 6).every((l) => l.column === "left"));
  assert.ok(lines.slice(6).every((l) => l.column === "right"));
});
test("the last short line of a full-width abstract does not become the left column", () => {
  const lines = orderedLines(
    identify([
      fragment("Full width abstract text", 0.08, 0.12, 0.82),
      fragment("Short abstract ending", 0.08, 0.137, 0.24),
      ...body(0.07, 0.22, "Left"),
      ...body(0.51, 0.22, "Right"),
    ]),
  );
  assert.equal(lines[1].column, "full");
  assert.equal(focusWindows(lines, 1, 6).length, 1);
  assert.equal(advanceReadingIndex(lines, 1, 3), 2);
});
test("running headers, DOI and page numbers are removed without dropping real headings", () => {
  const pages = Array.from({ length: 3 }, (_, i) => ({
    fragments: identify([
      fragment("Journal Example | volume 12", 0.08, 0.03, 0.65, 8),
      fragment("https://doi.org/10.0000/example", 0.53, 0.03, 0.4, 8),
      fragment(String(i + 1), 0.9, 0.96, 0.03, 8),
      fragment("Results", 0.08, 0.18, 0.2, 12),
      ...body(0.08, 0.22),
    ]),
  }));
  const detected = buildDocumentProfile(pages);
  const layout = analyzePageLayout(pages[1].fragments, [], detected);
  assert.ok(layout.lines.some((l) => l.text === "Results"));
  assert.ok(
    layout.lines.every(
      (l) =>
        !l.text.includes("Journal") &&
        !l.text.includes("doi.org") &&
        l.text !== "2",
    ),
  );
});
test("image text and the complete caption stay bright, with nearby body text still navigable", () => {
  const items = identify([
    fragment("panel A", 0.1, 0.15, 0.12, 7),
    fragment("Gene expression", 0.13, 0.25, 0.18, 7),
    fragment("Figure 1. Experimental result.", 0.08, 0.42, 0.75, 8),
    fragment(
      "The complete caption continues with a biomedical explanation.",
      0.08,
      0.435,
      0.75,
      8,
    ),
    ...body(0.08, 0.5),
  ]);
  const layout = analyzePageLayout(
    items,
    [{ x: 0.08, y: 0.1, w: 0.8, h: 0.3 }],
    profile,
  );
  assert.ok(
    layout.captionRegions.some((r) => r.y <= 0.42 && r.y + r.h >= 0.445),
  );
  assert.deepEqual(
    layout.lines.map((l) => l.text.split(" ")[0]),
    Array(5).fill("Body"),
  );
});
test("a larger inline equation does not truncate a figure legend", () => {
  const items = identify([
    fragment("Figure 2. Signal measurement.", 0.08, 0.4, 0.8, 8),
    fragment(
      "The explanation includes an inline rate constant ",
      0.08,
      0.416,
      0.5,
      8,
    ),
    fragment("k", 0.59, 0.414, 0.01, 10),
    fragment("and further interpretation.", 0.605, 0.416, 0.25, 8),
    fragment("Caption ending.", 0.08, 0.432, 0.4, 8),
    ...body(0.08, 0.51),
  ]);
  const layout = analyzePageLayout(items, [], profile);
  assert.ok(
    layout.lines.every(
      (l) => !l.text.includes("Caption") && !l.text.includes("rate constant"),
    ),
  );
  assert.ok(layout.captionRegions[0].y + layout.captionRegions[0].h > 0.44);
});
test("references to a figure inside body prose are not caption labels", () => {
  const text = "Fig. S3B) and related observations support further testing.";
  const layout = analyzePageLayout(
    identify([fragment(text, 0.08, 0.3, 0.8), ...body(0.08, 0.34)]),
    [],
    profile,
  );
  assert.ok(layout.lines.some((l) => l.text === text));
  assert.equal(layout.captionRegions.length, 0);
});
test("two-column legends are protected independently from neighboring body text", () => {
  const items = identify([
    fragment("Fig. 3 | Biomedical schematic.", 0.07, 0.4, 0.4, 8),
    fragment("Caption left continuation.", 0.07, 0.415, 0.4, 8),
    fragment("Right caption continuation.", 0.51, 0.4, 0.4, 8),
    fragment("Right caption ending.", 0.51, 0.415, 0.4, 8),
    ...body(0.07, 0.5, "Left"),
    ...body(0.51, 0.5, "Right"),
  ]);
  const layout = analyzePageLayout(
    items,
    [{ x: 0.07, y: 0.12, w: 0.84, h: 0.25 }],
    profile,
  );
  assert.equal(layout.captionRegions.length, 2);
  assert.ok(layout.lines.every((l) => /^(Left|Right) \d/.test(l.text)));
  assert.ok(layout.figures.every((r) => r.y + r.h < 0.5));
});
test("a pure vector figure page without a caption has no body navigation", () => {
  const labels = Array.from({ length: 50 }, (_, i) =>
    fragment(
      "label " + i,
      0.1 + (i % 5) * 0.16,
      0.1 + Math.floor(i / 5) * 0.06,
      0.07,
      6,
    ),
  );
  const layout = analyzePageLayout(
    identify([fragment("A", 0.08, 0.07, 0.02, 12), ...labels]),
    [],
    profile,
  );
  assert.equal(layout.lines.length, 0);
  assert.ok(layout.figures.some((r) => r.x <= 0.08 && r.y <= 0.07));
});
test("ordinary small-font reference paragraphs are not mistaken for plot labels", () => {
  const refs = Array.from({ length: 35 }, (_, i) =>
    fragment(
      "Reference " +
        i +
        " describes the biological results and published experimental findings.",
      0.08,
      0.1 + i * 0.02,
      0.8,
      7,
    ),
  );
  const layout = analyzePageLayout(identify(refs), [], profile);
  assert.equal(layout.lines.length, 35);
});
test("publishing footnotes beneath a separator are excluded while the other column remains", () => {
  const items = identify([
    ...body(0.07, 0.2, "Left"),
    ...body(0.51, 0.2, "Right"),
    fragment(
      "1 Department of Biomedical Sciences at Example University.",
      0.07,
      0.66,
      0.4,
      7,
    ),
    fragment(
      "Corresponding author and supplementary publication information.",
      0.07,
      0.68,
      0.4,
      7,
    ),
    ...body(0.51, 0.66, "Right lower"),
  ]);
  const layout = analyzePageLayout(
    items,
    [],
    profile,
    [],
    [{ x: 0.07, y: 0.65, w: 0.12, h: 0 }],
  );
  assert.ok(
    layout.lines.every(
      (l) =>
        !l.text.includes("Department") && !l.text.includes("Corresponding"),
    ),
  );
  assert.ok(layout.lines.some((l) => l.text.startsWith("Right lower")));
});
test("manual bright regions remove enclosed text from navigation", () => {
  const items = identify([
    ...body(0.08, 0.2),
    fragment("Unusual graphic label", 0.08, 0.5, 0.3),
  ]);
  const layout = analyzePageLayout(items, [], profile, [
    { x: 0.06, y: 0.48, w: 0.5, h: 0.06 },
  ]);
  assert.equal(layout.lines.length, 5);
  assert.ok(layout.figures.some((r) => r.y === 0.48));
});
