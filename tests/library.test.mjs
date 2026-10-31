import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FolderLibrary } from "../server/library.mjs";
test("folder library discovers nested PDFs, reads originals, and rejects unknown files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "biofocus-test-"));
  const library = new FolderLibrary();
  try {
    await fs.mkdir(path.join(dir, "papers"));
    await fs.writeFile(
      path.join(dir, "papers", "example.PDF"),
      "%PDF test bytes",
    );
    await fs.writeFile(path.join(dir, "ignore.txt"), "not a paper");
    const result = await library.connect(dir);
    assert.equal(result.files.length, 1);
    assert.equal(
      result.files[0].relativePath,
      path.join("papers", "example.PDF"),
    );
    assert.equal(
      Buffer.from(await library.read(result.files[0].key)).toString(),
      "%PDF test bytes",
    );
    await assert.rejects(library.read("not-a-scanned-file"), /不在已连接/);
    await fs.writeFile(path.join(dir, "second.pdf"), "another");
    const next = await library.scan();
    assert.equal(next.files.length, 2);
  } finally {
    library.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
