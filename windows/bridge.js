(() => {
  if (location.origin !== "https://biofocus.local") return;
  const pending = new Map(),
    listeners = new Set();
  function invoke(method, input) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("操作超时，请手动重试。"));
      }, 120000);
      pending.set(id, { resolve, reject, timeout });
      chrome.webview.postMessage({ id, method, input });
    });
  }
  chrome.webview.addEventListener("message", (event) => {
    const message = event.data;
    if (message.kind === "library") {
      for (const fn of listeners) fn(message.result);
      return;
    }
    const result = message.result,
      entry = result && pending.get(result.id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    pending.delete(result.id);
    if (result.ok) entry.resolve(result.value);
    else entry.reject(new Error(result.error));
  });
  Object.defineProperty(window, "biofocus", {
    value: Object.freeze({
      platform: "desktop",
      youdaoStatus: () => invoke("youdao:status"),
      configureYoudao: (config) => invoke("youdao:configure", config),
      clearYoudao: () => invoke("youdao:clear"),
      translate: (q) => invoke("youdao:translate", q),
      testYoudao: () => invoke("youdao:test"),
      modelStatus: () => invoke("model:status"),
      configureModel: (config) => invoke("model:configure", config),
      clearModel: () => invoke("model:clear"),
      listModels: (apiKey) => invoke("model:models", apiKey || ""),
      testModel: () => invoke("model:test"),
      askModel: (input) => invoke("model:chat", input),
      getLibrary: () => invoke("library:get"),
      chooseLibrary: () => invoke("library:choose"),
      readLibraryFile: async (key) => {
        const info = await invoke("library:file-info", key);
        const bytes = new Uint8Array(info.size);
        for (let offset = 0; offset < info.size; offset += 512 * 1024) {
          const text = atob(
            await invoke("library:read-chunk", {
              key,
              offset,
              length: Math.min(512 * 1024, info.size - offset),
            }),
          );
          for (let i = 0; i < text.length; i++)
            bytes[offset + i] = text.charCodeAt(i);
        }
        return bytes.buffer;
      },
      onLibraryChanged: (callback) => {
        listeners.add(callback);
        return () => listeners.delete(callback);
      },
    }),
    writable: false,
    configurable: false,
  });
})();
