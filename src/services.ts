import type { FolderState } from "./types";
export type YoudaoConfig = {
  appKey: string;
  appSecret: string;
  vocabId?: string;
  domain?: "general" | "medicine";
};
export type Translation = {
  translation: string;
  explains: string[];
  provider: string;
};
declare global {
  interface Window {
    biofocus?: {
      platform: string;
      configureYoudao: (c: YoudaoConfig) => Promise<{ configured: boolean }>;
      youdaoStatus: () => Promise<{ configured: boolean }>;
      translate: (q: string) => Promise<Translation>;
      clearYoudao: () => Promise<void>;
      getLibrary: () => Promise<FolderState>;
      chooseLibrary: () => Promise<FolderState>;
      readLibraryFile: (key: string) => Promise<ArrayBuffer>;
      onLibraryChanged: (callback: (state: FolderState) => void) => () => void;
    };
  }
}
async function localApi(path: string, body?: unknown) {
  const response = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response
    .json()
    .catch(() => ({
      error: "网页版的本地服务尚未启动，请使用桌面版或 npm run dev。",
    }));
  if (!response.ok) throw new Error(result.error || "服务请求失败");
  return result;
}
export const translator = {
  status: async () => {
    if (window.biofocus) return window.biofocus.youdaoStatus();
    try {
      return await localApi("youdao/status");
    } catch {
      return { configured: false };
    }
  },
  configure: async (config: YoudaoConfig) =>
    window.biofocus
      ? window.biofocus.configureYoudao(config)
      : localApi("youdao/config", config),
  translate: async (q: string): Promise<Translation> =>
    window.biofocus
      ? window.biofocus.translate(q)
      : localApi("youdao/translate", { q }),
  clear: async () =>
    window.biofocus
      ? window.biofocus.clearYoudao()
      : localApi("youdao/config", { clear: true }),
};
