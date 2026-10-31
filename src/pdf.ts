import * as pdfjs from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { orderedLines, union, intersects } from "./geometry.mjs";
import type { Rect, Line } from "./types";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
type Matrix = number[];
const multiply = (a: Matrix, b: Matrix) => pdfjs.Util.transform(a, b);
function boxOf(
  matrix: Matrix,
  viewport: pdfjs.PageViewport,
  bounds = [0, 0, 1, 1],
): Rect {
  const apply = (p: number[], m: number[]) => [
    m[0] * p[0] + m[2] * p[1] + m[4],
    m[1] * p[0] + m[3] * p[1] + m[5],
  ];
  const points = [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[1]],
    [bounds[0], bounds[3]],
    [bounds[2], bounds[3]],
  ].map((p) => apply(apply(p, matrix), viewport.transform));
  const x = Math.min(...points.map((p) => p[0])) / viewport.width,
    y = Math.min(...points.map((p) => p[1])) / viewport.height;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    w: Math.min(
      1 - x,
      Math.max(...points.map((p) => p[0])) / viewport.width - x,
    ),
    h: Math.min(
      1 - y,
      Math.max(...points.map((p) => p[1])) / viewport.height - y,
    ),
  };
}
export async function pageGeometry(
  page: pdfjs.PDFPageProxy,
  viewport: pdfjs.PageViewport,
): Promise<{ lines: Line[]; figures: Rect[] }> {
  const [content, operators] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
  ]);
  const items: Line[] = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const height = Math.hypot(tx[2], tx[3]);
    const style = content.styles[item.fontName];
    const ascent = style?.ascent ?? 0.8;
    items.push({
      x: tx[4] / viewport.width,
      y: (tx[5] - height * ascent) / viewport.height,
      w: (item.width * viewport.scale) / viewport.width,
      h: height / viewport.height,
      text: item.str,
      baseline: tx[5] / viewport.height,
      fontHeight: height / viewport.height,
      angle: Math.atan2(tx[1], tx[0]),
    });
  }
  const figures: Rect[] = [],
    paths: Rect[] = [];
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const OPS = pdfjs.OPS;
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i],
      a = operators.argsArray[i] ?? [];
    if (op === OPS.save) {
      stack.push([...matrix]);
    } else if (op === OPS.restore) {
      matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (op === OPS.transform) {
      matrix = multiply(matrix, a);
    } else if (op === OPS.paintFormXObjectBegin) {
      stack.push([...matrix]);
      if (a[0]) matrix = multiply(matrix, a[0]);
    } else if (op === OPS.paintFormXObjectEnd) {
      matrix = stack.pop() ?? matrix;
    } else if (
      [
        OPS.paintImageXObject,
        OPS.paintInlineImageXObject,
        OPS.paintImageMaskXObject,
        OPS.paintSolidColorImageMask,
      ].includes(op)
    ) {
      figures.push(boxOf(matrix, viewport));
    } else if (
      op === OPS.paintImageXObjectRepeat ||
      op === OPS.paintImageMaskXObjectRepeat
    ) {
      const positions = a[3] ?? [];
      for (let j = 0; j < positions.length; j += 2)
        figures.push(
          boxOf(
            multiply(matrix, [
              a[1],
              0,
              0,
              a[2],
              positions[j],
              positions[j + 1],
            ]),
            viewport,
          ),
        );
    } else if (op === OPS.paintInlineImageXObjectGroup) {
      for (const entry of a[1] ?? [])
        if (entry.transform)
          figures.push(boxOf(multiply(matrix, entry.transform), viewport));
    } else if (op === OPS.paintImageMaskXObjectGroup) {
      for (const entry of a[0] ?? [])
        if (entry.transform)
          figures.push(boxOf(multiply(matrix, entry.transform), viewport));
    } else if (op === OPS.constructPath && a[2]?.length === 4) {
      const rect = boxOf(matrix, viewport, a[2]);
      if (rect.w * rect.h < 0.5 && rect.w > 0.001 && rect.h > 0.001)
        paths.push(rect);
    }
  }
  // Cluster vector paths as a best-effort figure detector. Manual figure regions cover ambiguous PDFs.
  const clusters: { rect: Rect; count: number }[] = [];
  for (const p of paths.slice(0, 5000)) {
    let hits = clusters.filter((c) => intersects(c.rect, p, 0.008));
    if (!hits.length) clusters.push({ rect: p, count: 1 });
    else {
      const root = hits[0];
      root.rect = union(root.rect, p);
      root.count++;
      for (const other of hits.slice(1)) {
        root.rect = union(root.rect, other.rect);
        root.count += other.count;
        clusters.splice(clusters.indexOf(other), 1);
      }
    }
  }
  figures.push(
    ...clusters
      .filter(
        (c) =>
          c.count >= 4 &&
          c.rect.w > 0.1 &&
          c.rect.h > 0.035 &&
          c.rect.w * c.rect.h > 0.008 &&
          c.rect.w * c.rect.h < 0.65,
      )
      .map((c) => c.rect),
  );
  return {
    lines: orderedLines(items),
    figures: figures.filter((r) => r.w > 0.005 && r.h > 0.005),
  };
}
export async function renderedTextLines(
  page: pdfjs.PDFPageProxy,
  viewport: pdfjs.PageViewport,
  textLayer: pdfjs.TextLayer,
  container: HTMLElement,
): Promise<Line[]> {
  const content = await page.getTextContent();
  const items = content.items.filter((item): item is TextItem => "str" in item);
  const bounds = container.getBoundingClientRect();
  const fragments: Line[] = [];
  items.forEach((item, index) => {
    if (!item.str.trim()) return;
    const span = textLayer.textDivs[index];
    if (!span?.isConnected) return;
    const rect = span.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const tx = pdfjs.Util.transform(viewport.transform, item.transform);
    const angle =
      Math.atan2(tx[1], tx[0]) +
      (content.styles[item.fontName]?.vertical ? Math.PI / 2 : 0);
    if (Math.abs(angle) > Math.PI / 12) return;
    fragments.push({
      text: item.str,
      x: (rect.left - bounds.left) / bounds.width,
      y: (rect.top - bounds.top) / bounds.height,
      w: rect.width / bounds.width,
      h: rect.height / bounds.height,
      baseline: tx[5] / viewport.height,
      fontHeight: Math.hypot(tx[2], tx[3]) / viewport.height,
      angle,
    });
  });
  return orderedLines(fragments);
}
