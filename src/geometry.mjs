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
export function orderedLines(items) {
  const rows = [];
  const baseline = (item) => item.baseline ?? item.y + item.h * 0.8;
  const fontHeight = (item) => item.fontHeight ?? item.h;
  for (const item of [...items]
    .filter(
      (i) => i.text?.trim() && i.w > 0 && Math.abs(i.angle ?? 0) < Math.PI / 12,
    )
    .sort((a, b) => baseline(a) - baseline(b) || a.x - b.x)) {
    let row = rows.find(
      (r) =>
        Math.abs(r.baseline - baseline(item)) <
        Math.min(r.fontHeight, fontHeight(item)) * 0.38,
    );
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
  const lines = [];
  for (const row of rows) {
    let current = null;
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      if (!current || item.x - (current.x + current.w) > 0.055) {
        current = { ...item };
        lines.push(current);
      } else {
        const box = union(current, item);
        current.text += " " + item.text;
        Object.assign(current, box);
        current.fontHeight = Math.max(fontHeight(current), fontHeight(item));
      }
    }
  }
  // Full-width lines divide sections; read each section's left column before its right.
  const sorted = lines.sort((a, b) => baseline(a) - baseline(b) || a.x - b.x),
    result = [],
    pending = [];
  const flush = () => {
    const hasColumns =
      pending.some((l) => l.x > 0.49) &&
      pending.some((l) => l.x < 0.3 && l.x + l.w < 0.55);
    if (hasColumns)
      result.push(
        ...pending
          .filter((l) => l.x < 0.49)
          .sort((a, b) => baseline(a) - baseline(b)),
        ...pending
          .filter((l) => l.x >= 0.49)
          .sort((a, b) => baseline(a) - baseline(b)),
      );
    else result.push(...pending);
    pending.length = 0;
  };
  for (const line of sorted) {
    if (line.x < 0.35 && line.x + line.w > 0.67) {
      flush();
      result.push(line);
    } else pending.push(line);
  }
  flush();
  return result;
}
export function focusWindows(lines, index, count) {
  const rects = [];
  for (const line of lines.slice(index, index + count)) {
    const paddingY = Math.min(0.0015, line.h * 0.12);
    const box = {
      x: Math.max(0, line.x - 0.008),
      y: Math.max(0, line.y - paddingY),
      w: Math.min(1 - Math.max(0, line.x - 0.008), line.w + 0.016),
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
