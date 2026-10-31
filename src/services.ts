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
export type ModelConfig = { apiKey: string; model: string };
export type ModelStatus = {
  configured: boolean;
  model?: string;
  verifiedAt?: string;
};
export type ChatInput = {
  messages: { role: "user" | "assistant"; content: string }[];
  context?: string;
  page?: number;
};
export type ModelAnswer = {
  text: string;
  model: string;
  provider: string;
  incomplete: boolean;
};
declare global {
  interface Window {
    biofocus?: {
      platform: string;
      configureYoudao: (c: YoudaoConfig) => Promise<{ configured: boolean }>;
      youdaoStatus: () => Promise<{ configured: boolean }>;
      translate: (q: string) => Promise<Translation>;
      clearYoudao: () => Promise<void>;
      testYoudao: () => Promise<{ translation: string; verifiedAt: string }>;
      modelStatus: () => Promise<ModelStatus>;
      configureModel: (c: ModelConfig) => Promise<ModelStatus>;
      clearModel: () => Promise<void>;
      listModels: (apiKey?: string) => Promise<{ models: string[] }>;
      testModel: () => Promise<ModelAnswer & { verifiedAt: string }>;
      askModel: (input: ChatInput) => Promise<ModelAnswer>;
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
  const result = await response.json().catch(() => ({
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
  test: async () =>
    window.biofocus
      ? window.biofocus.testYoudao()
      : localApi("youdao/test", {}),
};
export const assistant = {
  status: async (): Promise<ModelStatus> => {
    if (window.biofocus) return window.biofocus.modelStatus();
    try {
      return await localApi("model/status");
    } catch {
      return { configured: false };
    }
  },
  configure: async (config: ModelConfig): Promise<ModelStatus> =>
    window.biofocus
      ? window.biofocus.configureModel(config)
      : localApi("model/config", config),
  clear: async () =>
    window.biofocus
      ? window.biofocus.clearModel()
      : localApi("model/config", { clear: true }),
  models: async (apiKey?: string): Promise<{ models: string[] }> =>
    window.biofocus
      ? window.biofocus.listModels(apiKey)
      : localApi("model/models", { apiKey }),
  test: async () =>
    window.biofocus ? window.biofocus.testModel() : localApi("model/test", {}),
  ask: async (input: ChatInput): Promise<ModelAnswer> =>
    window.biofocus
      ? window.biofocus.askModel(input)
      : localApi("model/chat", input),
};
