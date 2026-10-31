import fs from "node:fs/promises";
import path from "node:path";
export async function writeNotices(root, destination, sdk) {
  const packages = [
    "react",
    "react-dom",
    "scheduler",
    "pdfjs-dist",
    "pdf-lib",
    "lucide-react",
    "@pdf-lib/standard-fonts",
    "@pdf-lib/upng",
    "pako",
    "tslib",
  ];
  let text = "BioFocus — third-party notices\n\n";
  for (const name of packages) {
    const directory = path.join(root, "node_modules", name);
    const metadata = await fs
      .readFile(path.join(directory, "package.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (!metadata) continue;
    const names = await fs.readdir(directory);
    for (const file of names.filter((n) =>
      /^(license|copyrightnotice)(\.|$)/i.test(n),
    )) {
      text +=
        "\n" +
        "=".repeat(72) +
        "\n" +
        name +
        " " +
        metadata.version +
        " — " +
        file +
        "\n" +
        "=".repeat(72) +
        "\n";
      text += await fs.readFile(path.join(directory, file), "utf8");
      text += "\n";
    }
  }
  for (const file of ["LICENSE.txt", "NOTICE.txt"]) {
    text +=
      "\n" +
      "=".repeat(72) +
      "\nMicrosoft WebView2 SDK — " +
      file +
      "\n" +
      "=".repeat(72) +
      "\n";
    text += await fs.readFile(path.join(sdk, file), "utf8");
    text += "\n";
  }
  await fs.writeFile(
    path.join(destination, "THIRD-PARTY-NOTICES.txt"),
    text,
    "utf8",
  );
  await fs.copyFile(
    path.join(root, "LICENSE"),
    path.join(destination, "LICENSE.txt"),
  );
}
