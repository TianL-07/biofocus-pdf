import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFNumber,
  PDFString,
  PDFHexString,
} from "pdf-lib";
import type { Paper } from "./types";
export function download(
  data: Blob | Uint8Array | string,
  name: string,
  type = "application/octet-stream",
) {
  const blob =
    data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function annotatedPdf(bytes: ArrayBuffer, paper: Paper) {
  const doc = await PDFDocument.load(bytes);
  const context = doc.context;
  for (const h of paper.highlights) {
    const p = doc.getPages()[h.page - 1];
    if (!p) continue;
    const crop = p.getCropBox(),
      { width, height } = crop;
    const angle = ((p.getRotation().angle % 360) + 360) % 360;
    const toPdf = (x: number, y: number): [number, number] => {
      const point =
        angle === 90
          ? [y * width, x * height]
          : angle === 180
            ? [(1 - x) * width, y * height]
            : angle === 270
              ? [(1 - y) * width, (1 - x) * height]
              : [x * width, (1 - y) * height];
      return [point[0] + crop.x, point[1] + crop.y];
    };
    const quads: number[] = [],
      all: number[][] = [];
    for (const r of h.rects) {
      const points = [
        toPdf(r.x, r.y),
        toPdf(r.x + r.w, r.y),
        toPdf(r.x, r.y + r.h),
        toPdf(r.x + r.w, r.y + r.h),
      ];
      quads.push(...points.flat());
      all.push(...points);
    }
    if (!all.length) continue;
    const xs = all.map((p) => p[0]),
      ys = all.map((p) => p[1]);
    const hex = h.color.slice(0, 7);
    const color = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const annotation = context.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [
        Math.min(...xs),
        Math.min(...ys),
        Math.max(...xs),
        Math.max(...ys),
      ],
      QuadPoints: quads,
      C: color,
      CA: 0.35,
      F: 4,
      T: PDFHexString.fromText("BioFocus"),
      Contents: PDFHexString.fromText(h.note || h.text),
      M: PDFString.fromDate(new Date(h.created)),
    });
    const ref = context.register(annotation);
    let annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) {
      annots = context.obj([]);
      p.node.set(PDFName.of("Annots"), annots);
    }
    annots.push(ref);
  }
  return doc.save();
}
