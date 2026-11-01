import { orderedLines, inferGutter, union } from "./geometry.mjs";

const area = (r) => Math.max(0, r.w) * Math.max(0, r.h);
const overlap = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const inRegion = (r, region) =>
  overlap(r, region) / Math.max(area(r), 1e-8) > 0.35;
const expand = (r, x = 0.005, y = 0.003) => ({
  x: Math.max(0, r.x - x),
  y: Math.max(0, r.y - y),
  w: Math.min(1, r.x + r.w + x) - Math.max(0, r.x - x),
  h: Math.min(1, r.y + r.h + y) - Math.max(0, r.y - y),
});
const bounding = (items) =>
  items.reduce((a, b) => (a ? union(a, b) : { ...b }), null);
const fontOf = (i) => i.fontSize || 0;
const fingerprint = (text) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
const captionStart =
  /^(?:(?:extended\s+data|supplementary|supplemental)\s+)?(?:fig(?:ure)?\.?|图)\s*[sS]?\d+\s*(?:[.:：|｜]|$)/i;
const marginMetadata =
  /(?:https?:\/\/(?:dx\.)?doi\.org|^doi\s*:|downloaded from|copyright|©|all rights reserved|^research article$|^aacrjournals\.org|^bioRxiv|^medRxiv)/i;

/** A bounded document-wide sample distinguishes recurring furniture from body text. */
export function buildDocumentProfile(pages) {
  const repeated = new Map(),
    fonts = new Map();
  for (const page of pages) {
    const seen = new Set(),
      seenFonts = new Set();
    for (const line of orderedLines(page.fragments, { gutter: null })) {
      if (line.y < 0.075 || line.y > 0.92) {
        const key = fingerprint(line.text);
        if (key.length >= 4) seen.add(key);
      }
    }
    for (const item of page.fragments) {
      if (
        item.y < 0.08 ||
        item.y > 0.91 ||
        item.w < 0.14 ||
        item.text.length < 30 ||
        Math.abs(item.angle || 0) > 0.2
      )
        continue;
      const key = Math.round(fontOf(item) * 2) / 2;
      if (key < 6) continue;
      const bucket = fonts.get(key) || { weight: 0, pages: 0 };
      bucket.weight += Math.min(200, item.text.length);
      fonts.set(key, bucket);
      seenFonts.add(key);
    }
    for (const key of seen) repeated.set(key, (repeated.get(key) || 0) + 1);
    for (const key of seenFonts) fonts.get(key).pages++;
  }
  const bodyFont =
    [...fonts].sort(
      (a, b) =>
        b[1].weight * (0.5 + b[1].pages / pages.length) -
        a[1].weight * (0.5 + a[1].pages / pages.length),
    )[0]?.[0] || 10;
  return {
    bodyFont,
    runningText: [...repeated]
      .filter(([, n]) => n >= Math.max(2, Math.ceil(pages.length * 0.3)))
      .map(([key]) => key),
  };
}

/** Separate navigation text, figure/caption holes and page furniture. All coordinates are normalized. */
export function analyzePageLayout(
  fragments,
  graphics = [],
  profile = {},
  manualRegions = [],
  rules = [],
) {
  const running = new Set(profile.runningText || []),
    bodyFont = profile.bodyFont || 10;
  const initial = orderedLines(fragments, {
    gutter: inferGutter(fragments.filter((f) => fontOf(f) >= bodyFont * 0.92)),
  });
  const furniture = new Set(),
    excluded = [];
  for (const line of initial) {
    const peripheral = line.y < 0.09 || line.y > 0.91;
    const publicationLabel =
      line.y < 0.09 &&
      /^(?:researcharticle|naturemethods|naturecommunications|naturemedicine|science|scienceadvances|cell|cellreports|pnas|analysis)$/i.test(
        line.text.replace(/\s+/g, ""),
      );
    const pageNumber =
      /^\s*(?:[-–—|]\s*)?\d{1,5}\s*(?:[-–—|])?\s*$/.test(line.text) &&
      (line.y < 0.045 || line.y > 0.925);
    if (
      line.y < 0.018 ||
      line.y > 0.977 ||
      pageNumber ||
      publicationLabel ||
      (peripheral &&
        (running.has(fingerprint(line.text)) || marginMetadata.test(line.text)))
    ) {
      for (const id of line.sourceIds) furniture.add(id);
      excluded.push({ ...line, reason: "margin" });
    }
  }
  // Superscript affiliations and publishing footnotes under a short rule belong to page furniture.
  const footnoteRules = rules.filter(
    (r) =>
      r.y > 0.55 &&
      r.y < 0.94 &&
      r.w > 0.045 &&
      r.w < 0.48 &&
      r.h < 0.004 &&
      initial.some(
        (l) =>
          l.y >= r.y &&
          l.y < r.y + 0.03 &&
          l.x >= r.x - 0.02 &&
          l.x < r.x + r.w + 0.08 &&
          fontOf(l) < bodyFont * 0.88 &&
          l.text.length > 35 &&
          /^(?:\d|[†‡*]|note:|corresponding|e-mail|department|university|school|copyright)/i.test(
            l.text.trim(),
          ) &&
          !captionStart.test(l.text.trim()),
      ),
  );
  for (const item of fragments) {
    if (Math.abs(item.angle || 0) > Math.PI / 12) {
      furniture.add(item.id);
      excluded.push({ ...item, reason: "rotated" });
      continue;
    }
    if ((item.y < 0.11 || item.y > 0.88) && running.has(fingerprint(item.text)))
      furniture.add(item.id);
    if (
      footnoteRules.some(
        (r) =>
          item.y > r.y &&
          (fontOf(item) < bodyFont * 0.88 ||
            /^[^\p{L}\p{N}]+$/u.test(item.text.trim())) &&
          item.x >= r.x - 0.02 &&
          item.x < (r.x < 0.4 ? 0.5 : 0.98),
      )
    ) {
      furniture.add(item.id);
      excluded.push({ ...item, reason: "footnote" });
    }
  }
  const usable = fragments.filter(
    (f) => !furniture.has(f.id) && f.text?.trim(),
  );
  const byId = new Map(usable.map((f) => [f.id, f]));
  const typicalFont = (line) => {
    const weights = new Map();
    for (const id of line.sourceIds) {
      const f = byId.get(id);
      if (f) {
        const key = Math.round(fontOf(f) * 10) / 10;
        weights.set(key, (weights.get(key) || 0) + f.text.length);
      }
    }
    return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0] || fontOf(line);
  };
  const bodySized = (line) => {
    const members = line.sourceIds.map((id) => byId.get(id)).filter(Boolean);
    const total = members.reduce((n, f) => n + f.text.length, 0);
    return (
      members.reduce(
        (n, f) => n + (fontOf(f) >= bodyFont * 0.92 ? f.text.length : 0),
        0,
      ) >
      total * 0.65
    );
  };
  const gutter =
    inferGutter(usable.filter((f) => fontOf(f) >= bodyFont * 0.92)) ??
    inferGutter(usable);
  const rawLines = orderedLines(usable, { gutter });
  const drawings = graphics.filter(
    (r) =>
      area(r) < 0.82 &&
      r.y + r.h > 0.06 &&
      r.y < 0.94 &&
      r.w > 0.005 &&
      r.h > 0.005,
  );
  // Vector charts may consist of thousands of disconnected paths, with no image object.
  // Dense small labels can locate them, but never bridge over a body paragraph.
  const bodyProse = rawLines.filter(
    (l) => l.text.length >= 45 && l.w > 0.21 && bodySized(l),
  );
  const narrativeRows = rawLines.filter(
    (l) =>
      l.text.split(/\s+/).length >= 8 &&
      l.sourceIds.some((id) => {
        const f = byId.get(id);
        return f && f.text.length >= 45 && f.w > 0.17;
      }),
  );
  const narrativeIds = new Set(narrativeRows.flatMap((l) => l.sourceIds));
  const proseIds = new Set(bodyProse.flatMap((l) => l.sourceIds));
  const labels = usable.filter(
    (f) =>
      fontOf(f) < bodyFont * 0.9 &&
      f.text.length < 65 &&
      !proseIds.has(f.id) &&
      !narrativeIds.has(f.id),
  );
  const bands = [];
  for (const label of [...labels].sort((a, b) => a.y - b.y)) {
    let band = bands.at(-1);
    if (!band || label.y - band.bottom > 0.08) {
      band = { items: [], bottom: label.y };
      bands.push(band);
    }
    band.items.push(label);
    band.bottom = Math.max(band.bottom, label.y + label.h);
  }
  const addLabelRegion = (items) => {
    if (items.length < 12 || items.reduce((n, f) => n + f.text.length, 0) < 60)
      return;
    const rect = bounding(items);
    if (rect.w < 0.2 || rect.h < 0.06 || area(rect) < 0.02) return;
    if (bodyProse.some((l) => inRegion(l, rect))) return;
    drawings.push(expand(rect, 0.005, 0.005));
  };
  for (const band of bands) {
    addLabelRegion(band.items);
    if (gutter !== null) {
      addLabelRegion(band.items.filter((f) => f.x + f.w / 2 < gutter));
      addLabelRegion(band.items.filter((f) => f.x + f.w / 2 >= gutter));
    }
  }
  if (
    !bodyProse.length &&
    (rawLines.some((l) => captionStart.test(l.text.trim())) ||
      narrativeRows.reduce((n, l) => n + l.text.length, 0) < 200) &&
    labels.length >= 30 &&
    labels.reduce((n, l) => n + l.text.length, 0) > 150
  )
    drawings.push(expand(bounding(usable), 0.006, 0.004));
  const captionIds = new Set(),
    captionRegions = [],
    captionGroups = [];
  const seeds = rawLines.filter((l) => captionStart.test(l.text.trim()));
  for (const seed of seeds) {
    if (seed.sourceIds.some((id) => captionIds.has(id))) continue;
    const wide = seed.w > 0.52 || gutter === null;
    let lanes = wide
      ? [[0, 1]]
      : seed.x < gutter
        ? [[0, gutter]]
        : [[gutter, 1]];
    // A wide multi-panel figure often has a two-column caption, with a label only on the left.
    if (
      !wide &&
      seed.x < gutter &&
      drawings.some(
        (r) =>
          r.w > 0.55 &&
          r.y + r.h <= seed.y + 0.02 &&
          seed.y - (r.y + r.h) < 0.15,
      )
    )
      lanes = [
        [0, gutter],
        [gutter, 1],
      ];
    const group = [];
    for (const [left, right] of lanes) {
      const candidates = rawLines
        .filter(
          (l) =>
            l.x >= left - 0.015 &&
            l.x < right - 0.01 &&
            l.y >= seed.y - seed.h * 0.55,
        )
        .sort((a, b) => a.y - b.y || a.x - b.x);
      let bottom = seed.y,
        started = false;
      const accepted = [];
      for (const line of candidates) {
        if (line.y < seed.y - seed.h * 0.4) continue;
        if (!started && line.y > seed.y + seed.h * 0.75) break;
        if (started && line.y - bottom > Math.max(0.005, seed.h * 0.95)) break;
        if (line !== seed && captionStart.test(line.text.trim())) break;
        if (typicalFont(line) > typicalFont(seed) * 1.16) break;
        // Do not spread a narrow caption into an adjacent body column at a different font size.
        if (
          !started &&
          line !== seed &&
          Math.abs(typicalFont(line) - typicalFont(seed)) >
            Math.max(0.5, typicalFont(seed) * 0.1)
        )
          break;
        accepted.push(line);
        started = true;
        bottom = Math.max(bottom, line.y + line.h);
      }
      if (accepted.length) {
        const region = expand(bounding(accepted), 0.005, 0.002);
        captionRegions.push(region);
        group.push(...accepted);
        for (const line of accepted)
          for (const id of line.sourceIds) captionIds.add(id);
      }
    }
    if (group.length)
      captionGroups.push({ seed, rect: bounding(group), lines: group });
  }
  const imageRegions = drawings.map((r) => expand(r));
  const prose = bodyProse.filter(
    (l) =>
      !l.sourceIds.some((id) => captionIds.has(id)) &&
      !drawings.some((r) => inRegion(l, r)),
  );
  for (const group of captionGroups) {
    const caption = group.rect;
    const sameLane = (r) =>
      Math.min(r.x + r.w, caption.x + caption.w) - Math.max(r.x, caption.x) >
      Math.min(r.w, caption.w) * 0.3;
    const candidates = drawings.filter(
      (r) => sameLane(r) && r.y + r.h <= caption.y + 0.012,
    );
    const nearest = candidates.filter((r) => caption.y - r.y - r.h < 0.2);
    if (!nearest.length) continue;
    const firstY = Math.min(...nearest.map((r) => r.y));
    const aboveProse = prose.filter(
      (l) => sameLane(l) && l.y + l.h <= caption.y && l.y + l.h > firstY,
    );
    const barrier = Math.max(0.04, ...aboveProse.map((l) => l.y + l.h + 0.003));
    const parts = candidates.filter(
      (r) => r.y + r.h > barrier && r.y >= barrier - 0.01,
    );
    if (!parts.length) continue;
    let rect = bounding(parts);
    const labels = usable.filter(
      (f) =>
        !captionIds.has(f.id) &&
        f.y >= barrier &&
        f.y + f.h <= caption.y + 0.002 &&
        f.x + f.w > caption.x - 0.025 &&
        f.x < caption.x + caption.w + 0.025 &&
        (f.y >= rect.y - 0.035 || fontOf(f) < bodyFont * 0.92) &&
        !prose.some((p) => p.sourceIds.includes(f.id)),
    );
    if (labels.length) rect = union(rect, bounding(labels));
    imageRegions.push(expand(rect, 0.008, 0.006));
  }
  // Labels just outside an image/plot's axes also stay lit, without sweeping in body paragraphs.
  for (const figure of [...imageRegions]) {
    const nearby = usable.filter(
      (f) =>
        !captionIds.has(f.id) &&
        fontOf(f) < bodyFont * 0.9 &&
        f.text.length < 65 &&
        inRegion(f, expand(figure, 0.025, 0.018)),
    );
    if (nearby.length)
      imageRegions.push(expand(union(figure, bounding(nearby))));
  }
  const figures = [...imageRegions, ...captionRegions, ...manualRegions];
  const body = usable.filter(
    (f) => !captionIds.has(f.id) && !figures.some((r) => inRegion(f, r)),
  );
  for (const f of usable)
    if (captionIds.has(f.id) || figures.some((r) => inRegion(f, r)))
      excluded.push({
        ...f,
        reason: captionIds.has(f.id) ? "caption" : "figure",
      });
  return {
    lines: orderedLines(body),
    figures,
    captionRegions,
    excluded,
    gutter,
    allLines: rawLines,
  };
}
