export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function union(a, b) {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}
export function intersects(a, b, gap = 0) {
  return (
    a.x <= b.x + b.w + gap &&
    a.x + a.w + gap >= b.x &&
    a.y <= b.y + b.h + gap &&
    a.y + a.h + gap >= b.y
  );
}
export function normalizeRect(r, width, height) {
  return { x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height };
}
export function textRows(items) {
  const rows = [];
  const baseline = (item) => item.baseline ?? item.y + item.h * 0.8;
  const fontHeight = (item) => item.fontHeight ?? item.h;
  for (const item of [...items]
    .filter(
      (i) => i.text?.trim() && i.w > 0 && Math.abs(i.angle ?? 0) < Math.PI / 12,
    )
    .sort(
      (a, b) => fontHeight(b) - fontHeight(a) || baseline(a) - baseline(b),
    )) {
    let row = rows
      .filter(
        (r) =>
          Math.abs(r.baseline - baseline(item)) <
            Math.min(r.fontHeight, fontHeight(item)) * 0.5 ||
          (fontHeight(item) < r.fontHeight * 0.8 &&
            baseline(item) >= r.baseline - r.fontHeight * 0.8 &&
            baseline(item) <= r.baseline + r.fontHeight * 0.5),
      )
      .sort(
        (a, b) =>
          Math.abs(a.baseline - baseline(item)) -
          Math.abs(b.baseline - baseline(item)),
      )[0];
    if (!row) {
      row = {
        baseline: baseline(item),
        fontHeight: fontHeight(item),
        items: [],
      };
      rows.push(row);
    }
    row.items.push(item);
  }
  return rows.sort((a, b) => a.baseline - b.baseline);
}
// Find a repeated vertical gap, before joining fonts/words on the same baseline.
export function inferGutter(items) {
  const rows = textRows(items),
    candidates = [];
  for (let cut = 0.3; cut <= 0.7; cut += 0.005) {
    let support = 0,
      gapSum = 0;
    const leftRows = [],
      rightRows = [];
    for (const row of rows) {
      if (row.items.some((i) => i.x < cut && i.x + i.w > cut)) continue;
      const left = row.items.filter((i) => i.x + i.w <= cut),
        right = row.items.filter((i) => i.x >= cut);
      if (
        left.length &&
        Math.min(...left.map((i) => i.x)) < 0.32 &&
        left.reduce((n, i) => n + i.w, 0) >= 0.17
      )
        leftRows.push({ ...row, end: Math.max(...left.map((i) => i.x + i.w)) });
      if (
        right.length &&
        Math.min(...right.map((i) => i.x)) >= 0.35 &&
        right.reduce((n, i) => n + i.w, 0) >= 0.17
      )
        rightRows.push({ ...row, start: Math.min(...right.map((i) => i.x)) });
      if (!left.length || !right.length) continue;
      const end = Math.max(...left.map((i) => i.x + i.w)),
        start = Math.min(...right.map((i) => i.x));
      if (
        start - end < 0.012 ||
        start - end > 0.22 ||
        Math.min(...left.map((i) => i.x)) > 0.32 ||
        start < 0.35
      )
        continue;
      if (
        left.reduce((n, i) => n + i.w, 0) < 0.17 ||
        right.reduce((n, i) => n + i.w, 0) < 0.17
      )
        continue;
      support++;
      gapSum += Math.min(cut - end, start - cut);
    }
    // The two columns need not use identical line spacing or aligned baselines.
    let paired = 0,
      pairedGap = 0;
    for (const left of leftRows) {
      const right = rightRows
        .filter(
          (r) =>
            Math.abs(r.baseline - left.baseline) <=
              Math.max(r.fontHeight, left.fontHeight) * 1.25 &&
            r.start - left.end >= 0.012 &&
            r.start - left.end <= 0.22,
        )
        .sort(
          (a, b) =>
            Math.abs(a.baseline - left.baseline) -
            Math.abs(b.baseline - left.baseline),
        )[0];
      if (right) {
        paired++;
        pairedGap += Math.min(cut - left.end, right.start - cut);
      }
    }
    if (paired >= 4 && paired > support) {
      support = paired;
      gapSum = pairedGap;
    }
    if (support >= 2) candidates.push({ cut, support, gap: gapSum / support });
  }
  candidates.sort((a, b) => b.support - a.support || b.gap - a.gap);
  return candidates[0]?.cut ?? null;
}
export function orderedLines(items, options = {}) {
  const rows = textRows(items),
    gutter = options.gutter === undefined ? inferGutter(items) : options.gutter;
  const baseline = (item) => item.baseline ?? item.y + item.h * 0.8;
  const fontHeight = (item) => item.fontHeight ?? item.h;
  const lines = [];
  for (const row of rows) {
    const spanning =
      gutter !== null &&
      row.items.some((i) => i.x < gutter && i.x + i.w > gutter);
    let current = null;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const column =
        gutter === null
          ? "single"
          : spanning
            ? "full"
            : item.x + item.w / 2 < gutter
              ? "left"
              : "right";
      if (
        !current ||
        current.column !== column ||
        item.x - (current.x + current.w) > 0.035
      ) {
        current = {
          ...item,
          column,
          baseline: row.baseline,
          sourceIds: item.id === undefined ? [] : [item.id],
        };
        lines.push(current);
      } else {
        const box = union(current, item);
        current.text += " " + item.text;
        Object.assign(current, box);
        current.fontHeight = Math.max(fontHeight(current), fontHeight(item));
        current.fontSize = Math.max(current.fontSize || 0, item.fontSize || 0);
        if (item.id !== undefined) current.sourceIds.push(item.id);
      }
    }
  }
  if (gutter === null)
    return lines
      .sort((a, b) => baseline(a) - baseline(b) || a.x - b.x)
      .map((l) => ({ ...l, flow: "single" }));
  // Full-width lines divide sections; read each section's left column before its right.
  const sorted = lines.sort((a, b) => baseline(a) - baseline(b) || a.x - b.x),
    result = [],
    pending = [];
  let section = 0;
  for (let i = 1; i < sorted.length; i++) {
    const line = sorted[i],
      previous = sorted[i - 1];
    if (
      previous.column === "full" &&
      line.column !== "full" &&
      baseline(line) - baseline(previous) > 0 &&
      baseline(line) - baseline(previous) <
        Math.max(fontHeight(line), fontHeight(previous)) * 1.7 &&
      !sorted.some(
        (other) =>
          other !== line &&
          other.column !== "full" &&
          other.column !== line.column &&
          Math.abs(baseline(other) - baseline(line)) < fontHeight(line) * 0.5,
      )
    )
      line.column = "full";
  }
  const flush = () => {
    for (const column of ["left", "right"])
      result.push(
        ...pending
          .filter((l) => l.column === column)
          .sort((a, b) => baseline(a) - baseline(b))
          .map((l) => ({
            ...l,
            flow: section + ":" + column,
            columnLeft: column === "right" ? gutter + 0.002 : 0,
            columnRight: column === "left" ? gutter - 0.002 : 1,
          })),
      );
    if (pending.length) section++;
    pending.length = 0;
  };
  for (const line of sorted) {
    if (line.column === "full") {
      flush();
      result.push({ ...line, flow: section + ":full" });
    } else pending.push(line);
  }
  flush();
  return result;
}
export function focusWindows(lines, index, count) {
  const rects = [];
  const flow = lines[index]?.flow;
  for (const line of lines.slice(index, index + count)) {
    if (flow !== undefined && line.flow !== flow) break;
    const paddingY = Math.min(0.0015, line.h * 0.12);
    const left = Math.max(line.columnLeft ?? 0, line.x - 0.008),
      right = Math.min(line.columnRight ?? 1, line.x + line.w + 0.008);
    const box = {
      x: left,
      y: Math.max(0, line.y - paddingY),
      w: Math.max(0, right - left),
      h: Math.min(1 - Math.max(0, line.y - paddingY), line.h + paddingY * 2),
    };
    const prev = rects.at(-1);
    if (
      prev &&
      (Math.abs(prev.x - box.x) < 0.12 ||
        Math.min(prev.x + prev.w, box.x + box.w) - Math.max(prev.x, box.x) >
          Math.min(prev.w, box.w) * 0.5) &&
      box.y >= prev.y - 0.002 &&
      box.y - (prev.y + prev.h) < 0.05
    )
      Object.assign(prev, union(prev, box));
    else rects.push(box);
  }
  return rects;
}
export const readingStep = (count) =>
  count >= 3 ? Math.max(1, Math.floor(count / 2)) : 1;
export function advanceReadingIndex(lines, index, distance) {
  const end = index + distance,
    direction = Math.sign(distance),
    flow = lines[index]?.flow;
  if (flow !== undefined)
    for (
      let i = index + direction;
      direction > 0 ? i <= end : i >= end;
      i += direction
    ) {
      if (lines[i] && lines[i].flow !== flow) return i;
    }
  return end;
}
export function lookupTerm(term, dictionary) {
  const clean = term
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[‐‑–—]/g, "-")
    .replace(/^[\s.,;:()"'“”]+|[\s.,;:()"'“”]+$/g, "")
    .replace(/\s+/g, " ");
  const candidates = [
    clean,
    clean.replace(/ies$/, "y"),
    clean.replace(/es$/, ""),
    clean.replace(/s$/, ""),
  ];
  return dictionary.find((d) =>
    candidates.some(
      (c) =>
        d.term.toLowerCase() === c ||
        d.aliases?.some((a) => a.toLowerCase() === c),
    ),
  );
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
