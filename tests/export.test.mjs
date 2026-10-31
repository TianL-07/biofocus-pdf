import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
import { PDFDocument, PDFName, PDFArray, PDFDict, degrees } from "pdf-lib";

test("PDF export retains notes and correctly maps highlights on cropped, rotated pages", async () => {
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "biofocus-export-test-"),
  );
  try {
    const source = await fs.readFile(
      new URL("../src/export.ts", import.meta.url),
      "utf8",
    );
    let module = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const resolved = pathToFileURL(
      createRequire(import.meta.url).resolve("pdf-lib"),
    ).href;
    module = module.replace(
      'from "pdf-lib"',
      `from ${JSON.stringify(resolved)}`,
    );
    const target = path.join(folder, "export.mjs");
    await fs.writeFile(target, module);
    const { annotatedPdf } = await import(pathToFileURL(target).href);
    const original = await PDFDocument.create();
    const page = original.addPage([400, 500]);
    page.setCropBox(10, 20, 200, 300);
    page.setRotation(degrees(90));
    const bytes = await original.save();
    const result = await annotatedPdf(bytes, {
      highlights: [
        {
          page: 1,
          color: "#f3d763",
          text: "expression",
          note: "示例笔记",
          created: Date.now(),
          rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
        },
      ],
    });
    const exported = await PDFDocument.load(result);
    const annotations = exported
      .getPages()[0]
      .node.lookup(PDFName.of("Annots"), PDFArray);
    assert.equal(annotations.size(), 1);
    const annotation = exported.context.lookup(annotations.get(0), PDFDict);
    assert.equal(
      annotation.get(PDFName.of("Contents")).decodeText(),
      "示例笔记",
    );
    const quad = annotation.lookup(PDFName.of("QuadPoints"), PDFArray);
    assert.ok(Math.abs(quad.get(0).asNumber() - 50) < 0.001);
    assert.ok(Math.abs(quad.get(1).asNumber() - 50) < 0.001);
  } finally {
    const resolved = path.resolve(folder),
      base = path.resolve(os.tmpdir()) + path.sep;
    if (
      !resolved.startsWith(base) ||
      !path.basename(resolved).startsWith("biofocus-export-test-")
    )
      throw new Error("Unexpected test cleanup path");
    await fs.rm(resolved, { recursive: true, force: true });
  }
});
