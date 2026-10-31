import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeNotices } from "./notices.mjs";
const root = process.cwd(),
  cache = path.join(root, ".native");
await fs.mkdir(cache, { recursive: true });
const version = "1.0.4314.35",
  folder = path.join(cache, version),
  archive = path.join(cache, version + ".zip");
const base = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${version}/microsoft.web.webview2.${version}.nupkg`;
if (
  !(await fs
    .stat(path.join(folder, "lib/net462/Microsoft.Web.WebView2.Core.dll"))
    .catch(() => null))
) {
  const [response, registration] = await Promise.all([
    fetch(base),
    fetch(
      `https://api.nuget.org/v3/registration5-gz-semver2/microsoft.web.webview2/${version}.json`,
    ),
  ]);
  if (!response.ok || !registration.ok)
    throw new Error("Microsoft WebView2 SDK download failed.");
  const metadata = await registration.json(),
    catalog = await (await fetch(metadata.catalogEntry)).json();
  const bytes = Buffer.from(await response.arrayBuffer()),
    expected = catalog.packageHash;
  if (
    !expected ||
    createHash("sha512").update(bytes).digest("base64") !== expected
  )
    throw new Error("NuGet SHA-512 verification failed.");
  await fs.writeFile(archive, bytes);
  const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
  const extraction = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(folder)} -Force`,
    ],
    { stdio: "inherit", windowsHide: true },
  );
  if (extraction.status !== 0) throw new Error("SDK extraction failed.");
}
const outputIndex = process.argv.indexOf("--output");
const releaseBase = path.join(root, "release");
const release = path.resolve(
  releaseBase,
  outputIndex >= 0 ? process.argv[outputIndex + 1] : "BioFocus-Windows",
);
if (!release.startsWith(path.resolve(releaseBase) + path.sep))
  throw new Error("Output must stay inside the project release folder.");
await fs.mkdir(release, { recursive: true });
const csc = path.join(
  process.env.WINDIR || "C:/Windows",
  "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
);
const refs = [
  "System.dll",
  "System.Core.dll",
  "System.Windows.Forms.dll",
  "System.Drawing.dll",
  "System.Security.dll",
  "System.Net.Http.dll",
  "System.Web.Extensions.dll",
  path.join(folder, "lib/net462/Microsoft.Web.WebView2.Core.dll"),
  path.join(folder, "lib/net462/Microsoft.Web.WebView2.WinForms.dll"),
];
const result = spawnSync(
  csc,
  [
    "/nologo",
    "/target:winexe",
    "/platform:x64",
    "/optimize+",
    "/utf8output",
    "/win32manifest:" + path.join(root, "windows/app.manifest"),
    "/out:" + path.join(release, "BioFocus.exe"),
    ...refs.map((r) => "/reference:" + r),
    path.join(root, "windows/BioFocus.cs"),
    path.join(root, "windows/ModelService.cs"),
  ],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) throw new Error("Windows compilation failed.");
for (const name of [
  "Microsoft.Web.WebView2.Core.dll",
  "Microsoft.Web.WebView2.WinForms.dll",
])
  await fs.copyFile(
    path.join(folder, "lib/net462", name),
    path.join(release, name),
  );
await fs.copyFile(
  path.join(folder, "build/native/x64/WebView2Loader.dll"),
  path.join(release, "WebView2Loader.dll"),
);
await fs.copyFile(
  path.join(root, "windows/bridge.js"),
  path.join(release, "bridge.js"),
);
await fs.cp(path.join(root, "dist"), path.join(release, "app"), {
  recursive: true,
});
await fs.writeFile(
  path.join(release, "BioFocus.exe.config"),
  '<?xml version="1.0"?><configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8"/></startup><runtime><AppContextSwitchOverrides value="Switch.System.Windows.Forms.DoNotSupportSelectAllShortcutInMultilineTextBox=false"/></runtime></configuration>',
);
await fs.writeFile(
  path.join(release, "使用说明.txt"),
  "双击 BioFocus.exe 启动。请保留整个文件夹的文件。\r\n需要 Windows 10/11、.NET Framework 4.8 与 Microsoft Edge WebView2 Runtime。\r\n默认连接桌面“文献阅读”文件夹（含子目录）。可在左侧更换文件夹。\r\n翻译与答疑共用 OpenAI API Key，默认模型 gpt-6.1-sol。\r\n上/下按半框移动，奇数向下取整；左/右调整聚焦行数。阅读记录保存在本机；翻译与答疑会将所选内容或问题发给 OpenAI。\r\n在设置中填写 OpenAI API Key，选择模型，保存并测试后即可翻译和问答。记录不自动同步到 ChatGPT App。\r\n",
);
await writeNotices(root, release, folder);
console.log("Windows application built: " + path.join(release, "BioFocus.exe"));
