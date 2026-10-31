import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
export class FolderLibrary {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.root = null;
    this.files = new Map();
    this.watcher = null;
    this.timer = null;
  }
  async connect(folder) {
    const info = await fs.lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("请选择普通文件夹。");
    this.close();
    this.root = await fs.realpath(folder);
    const result = await this.scan();
    try {
      this.watcher = watch(this.root, { recursive: true }, () => {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          void this.scan()
            .then(this.onChange)
            .catch(() => {});
        }, 800);
      });
      this.watcher.on("error", () => {});
    } catch {}
    return result;
  }
  async scan() {
    if (!this.root) return { folder: null, files: [] };
    const mapped = new Map(),
      files = [];
    const visit = async (dir, depth) => {
      if (depth > 10 || files.length >= 5000) return;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(absolute, depth + 1);
        } else if (
          entry.isFile() &&
          entry.name.toLowerCase().endsWith(".pdf")
        ) {
          const info = await fs.stat(absolute);
          const key = createHash("sha256").update(absolute).digest("hex");
          mapped.set(key, absolute);
          files.push({
            key,
            name: entry.name,
            relativePath: path.relative(this.root, absolute),
            size: info.size,
            modified: info.mtimeMs,
          });
        }
        if (files.length >= 5000) break;
      }
    };
    await visit(this.root, 0);
    this.files = mapped;
    return {
      folder: this.root,
      files: files.sort((a, b) => b.modified - a.modified),
      truncated: files.length >= 5000,
    };
  }
  async read(key) {
    const file = this.files.get(key);
    if (!file || !this.root)
      throw new Error("文件不在已连接的文献文件夹中，请刷新文献库。");
    const real = await fs.realpath(file);
    if (!real.startsWith(this.root + path.sep))
      throw new Error("文件路径超出已授权文件夹。");
    const info = await fs.stat(real);
    if (info.size > 150 * 1024 * 1024)
      throw new Error("请选择小于 150 MB 的 PDF。");
    const bytes = await fs.readFile(real);
    return bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
  }
  close() {
    clearTimeout(this.timer);
    this.watcher?.close();
    this.watcher = null;
  }
}
