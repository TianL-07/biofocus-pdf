import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Plus,
  Search,
  Sun,
  Moon,
  Settings2,
  PanelRightClose,
  PanelRightOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  Minus,
  Focus,
  Image,
  Highlighter,
  MessageSquare,
  Languages,
  StickyNote,
  Download,
  Upload,
  FileText,
  Trash2,
  X,
  Check,
  Send,
  ShieldCheck,
  ExternalLink,
  Keyboard,
  Maximize2,
  Scan,
  Bookmark,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PdfPage } from "./components/PdfPage";
import { pdfjs } from "./pdf";
import * as storage from "./storage";
import { createDemo } from "./demo";
import {
  clamp,
  csvCell,
  readingStep,
  advanceReadingIndex,
} from "./geometry.mjs";
import { download, annotatedPdf } from "./export";
import { translator, assistant } from "./services";
import { conversationHistory } from "./conversation.mjs";
import type {
  Paper,
  Line,
  SelectionInfo,
  Tab,
  Highlight,
  Word,
  FolderState,
  FolderFile,
  Rect,
} from "./types";

const EMPTY_REGIONS: Rect[] = [];
const readPaperBytes = (p: Paper) =>
  p.source && window.biofocus
    ? window.biofocus.readLibraryFile(p.source.key)
    : storage.getFile(p.id);
const colors = ["#f3d763", "#87cbaa", "#9fb9ed", "#eaa7bc"];
function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
    </button>
  );
}
function Empty({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export default function App() {
  const [folderLibrary, setFolderLibrary] = useState<FolderState>({
    folder: null,
    files: [],
  });
  const [papers, setPapers] = useState<Paper[]>([]),
    [paper, setPaper] = useState<Paper | null>(null),
    [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null),
    [loading, setLoading] = useState(true),
    [lines, setLines] = useState<Line[]>([]);
  const [theme, setTheme] = useState(
      () => localStorage.getItem("bf-theme") || "day",
    ),
    [focus, setFocus] = useState(
      () => localStorage.getItem("bf-focus") !== "false",
    ),
    [lineCount, setLineCount] = useState(() =>
      clamp(Number(localStorage.getItem("bf-count") || 3), 1, 12),
    ),
    [dim, setDim] = useState(() =>
      Number(localStorage.getItem("bf-dim") || 0.64),
    ),
    [zoom, setZoom] = useState(100),
    [availableWidth, setAvailableWidth] = useState(850);
  const [panel, setPanel] = useState(true),
    [tab, setTab] = useState<Tab>("words"),
    [selection, setSelection] = useState<SelectionInfo | null>(null),
    [regionMode, setRegionMode] = useState(false),
    [search, setSearch] = useState(""),
    [librarySearch, setLibrarySearch] = useState(""),
    [manualTerm, setManualTerm] = useState(""),
    [chatDraft, setChatDraft] = useState(""),
    [noteEditor, setNoteEditor] = useState<Highlight | null>(null),
    [showSettings, setShowSettings] = useState(location.hash === "#settings"),
    [showHelp, setShowHelp] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    [dragging, setDragging] = useState(false),
    [toast, setToast] = useState(""),
    [pageInput, setPageInput] = useState("1");
  const [wordFilter, setWordFilter] = useState("");
  const [modelReady, setModelReady] = useState(false),
    [modelName, setModelName] = useState("gpt-6.1-sol"),
    [modelKey, setModelKey] = useState(""),
    [modelOptions, setModelOptions] = useState<string[]>([]),
    [modelMessage, setModelMessage] = useState(""),
    [modelBusy, setModelBusy] = useState(false),
    [modelVerified, setModelVerified] = useState(""),
    [chatBusy, setChatBusy] = useState(false),
    [includePage, setIncludePage] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null),
    importRef = useRef<HTMLInputElement>(null),
    viewportRef = useRef<HTMLDivElement>(null),
    paperRef = useRef<Paper | null>(null),
    pdfRef = useRef<pdfjs.PDFDocumentProxy | null>(null),
    openSerial = useRef(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const update = useCallback(
    (fn: (p: Paper) => Paper) => {
      const prev = paperRef.current;
      if (!prev) return;
      const next = fn(prev);
      paperRef.current = next;
      setPaper(next);
      setPapers((ps) => ps.map((p) => (p.id === next.id ? next : p)));
      storage
        .savePaper(next)
        .catch(() => notify("本地保存失败，请导出备份并检查存储空间。"));
    },
    [notify],
  );
  const updateById = useCallback(
    async (id: string, fn: (p: Paper) => Paper) => {
      if (paperRef.current?.id === id) {
        update(fn);
        return;
      }
      const all = await storage.listPapers(),
        p = all.find((p) => p.id === id);
      if (p) {
        const next = fn(p);
        await storage.savePaper(next);
        setPapers((ps) => ps.map((p) => (p.id === id ? next : p)));
      }
    },
    [update],
  );
  const open = useCallback(
    async (p: Paper) => {
      const serial = ++openSerial.current;
      setLoading(true);
      setSelection(null);
      setLines([]);
      setRegionMode(false);
      setSearch("");
      try {
        const bytes = await readPaperBytes(p);
        if (!bytes) throw new Error("未找到文献文件，请重新导入 PDF。");
        const task = pdfjs.getDocument({
          data: new Uint8Array(bytes.slice(0)),
          isEvalSupported: false,
        });
        task.onPassword = (
          callback: (password: string) => void,
          reason: number,
        ) => {
          const entered = window.prompt(
            reason === pdfjs.PasswordResponses.NEED_PASSWORD
              ? "请输入此 PDF 的打开密码（不会保存）"
              : "密码不正确，请重新输入",
          );
          if (entered === null) {
            void task.destroy();
            setLoading(false);
            return;
          }
          callback(entered);
        };
        const doc = await task.promise;
        if (serial !== openSerial.current) {
          await doc.destroy();
          return;
        }
        const old = pdfRef.current;
        pdfRef.current = doc;
        setPdf(doc);
        const next = {
          ...p,
          pages: doc.numPages,
          page: clamp(p.page, 1, doc.numPages),
        };
        paperRef.current = next;
        setPaper(next);
        setPageInput(String(next.page));
        localStorage.setItem("bf-last-paper", p.id);
        setPapers((ps) =>
          ps.map((item) => (item.id === next.id ? next : item)),
        );
        void storage.savePaper(next);
        setLoading(false);
        if (old && old !== doc) void old.destroy();
      } catch (e) {
        if (serial !== openSerial.current) return;
        setLoading(false);
        notify(e instanceof Error ? e.message : "无法打开 PDF");
      }
    },
    [notify],
  );
  const importBytes = useCallback(
    async (bytes: ArrayBuffer, name: string, folderKey?: string) => {
      const id = await storage.fileHash(bytes);
      const all = await storage.listPapers();
      let p = all.find((p) => p.id === id);
      if (!p) {
        p = {
          id,
          name,
          size: bytes.byteLength,
          added: Date.now(),
          pages: 0,
          page: 1,
          line: 0,
          highlights: [],
          words: [],
          regions: {},
          chat: [],
        };
        if (folderKey) p.source = { kind: "folder", key: folderKey };
        else await storage.saveFile(id, bytes);
        await storage.savePaper(p);
        setPapers((prev) => [p!, ...prev]);
      } else if (folderKey) {
        p = { ...p, source: { kind: "folder", key: folderKey } };
        await storage.savePaper(p);
      }
      await open(p);
    },
    [open],
  );
  const addDemo = useCallback(async () => {
    setLoading(true);
    try {
      const bytes = await createDemo();
      await importBytes(
        bytes.slice().buffer as ArrayBuffer,
        "Reading the immune landscape · 示例.pdf",
      );
    } catch (e) {
      setLoading(false);
      notify(String(e));
    }
  }, [importBytes, notify]);
  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const all = (await storage.listPapers()).sort(
          (a, b) => b.added - a.added,
        );
        if (disposed) return;
        setPapers(all);
        if (all.length)
          await open(
            all.find((p) => p.id === localStorage.getItem("bf-last-paper")) ||
              all[0],
          );
        else await addDemo();
      } catch {
        setLoading(false);
        notify("无法使用本地存储，请在普通窗口中打开应用。");
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("bf-theme", theme);
  }, [theme]);
  useEffect(() => {
    void assistant.status().then((status) => {
      setModelReady(status.configured);
      setModelName(status.model || "gpt-6.1-sol");
      setModelVerified(status.verifiedAt || "");
    });
  }, []);
  useEffect(() => {
    if (!window.biofocus) return;
    void window.biofocus
      .getLibrary()
      .then(setFolderLibrary)
      .catch(() => notify("文献文件夹暂不可用，请重新选择。"));
    return window.biofocus.onLibraryChanged(setFolderLibrary);
  }, [notify]);
  const chooseFolder = async () => {
    if (!window.biofocus) {
      notify("文件夹直连在 Windows 桌面版中可用；网页版可导入 PDF。");
      return;
    }
    try {
      setFolderLibrary(await window.biofocus.chooseLibrary());
    } catch (error) {
      notify(String(error));
    }
  };
  const openFolderFile = async (file: FolderFile) => {
    if (!window.biofocus) return;
    setLoading(true);
    try {
      const bytes = await window.biofocus.readLibraryFile(file.key);
      await importBytes(bytes, file.name, file.key);
    } catch (error) {
      setLoading(false);
      notify(error instanceof Error ? error.message : "无法打开文件");
    }
  };
  useEffect(() => {
    localStorage.setItem("bf-focus", String(focus));
    localStorage.setItem("bf-count", String(lineCount));
    localStorage.setItem("bf-dim", String(dim));
  }, [focus, lineCount, dim]);
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setAvailableWidth(entries[0].contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const changePage = useCallback(
    (n: number, lastLine = false) => {
      const p = paperRef.current;
      if (!p) return;
      const page = clamp(n, 1, p.pages);
      if (page === p.page) return;
      update((prev) => ({ ...prev, page, line: lastLine ? 100000 : 0 }));
      setSelection(null);
      setPageInput(String(page));
      viewportRef.current?.scrollTo({ top: 0, behavior: "instant" });
    },
    [update],
  );
  const moveLine = useCallback(
    (step: number) => {
      const p = paperRef.current;
      if (!p) return;
      if (!lines.length) {
        if (step > 0 && p.page < p.pages) changePage(p.page + 1);
        else if (step < 0 && p.page > 1) changePage(p.page - 1, true);
        return;
      }
      const next = advanceReadingIndex(
        lines,
        p.line,
        step * readingStep(lineCount),
      );
      if (next < 0 && p.page > 1) changePage(p.page - 1, true);
      else if (next >= lines.length && p.page < p.pages) changePage(p.page + 1);
      else
        update((prev) => ({ ...prev, line: clamp(next, 0, lines.length - 1) }));
    },
    [lines, lineCount, changePage, update],
  );
  useEffect(() => {
    if (paper && lines.length && paper.line >= lines.length)
      update((p) => ({ ...p, line: lines.length - 1 }));
  }, [lines]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(
          'input,textarea,select,[contenteditable="true"],dialog',
        ) ||
        showSettings ||
        showHelp ||
        noteEditor ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.key === "Escape") {
        setSelection(null);
        setRegionMode(false);
        return;
      }
      if (!focus || window.getSelection()?.toString()) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        if (e.key === "ArrowUp") moveLine(-1);
        if (e.key === "ArrowDown") moveLine(1);
        if (e.key === "ArrowLeft") setLineCount((c) => Math.max(1, c - 1));
        if (e.key === "ArrowRight") setLineCount((c) => Math.min(12, c + 1));
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [focus, moveLine, showSettings, showHelp, noteEditor]);
  useEffect(() => {
    if (paper) setPageInput(String(paper.page));
  }, [paper?.page]);
  const importFile = async (file?: File) => {
    if (!file) return;
    if (
      !file.name.toLowerCase().endsWith(".pdf") &&
      file.type !== "application/pdf"
    ) {
      notify("请选择 PDF 文件。");
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      notify("请选择小于 150 MB 的 PDF。");
      return;
    }
    setLoading(true);
    try {
      await importBytes(await file.arrayBuffer(), file.name);
    } catch (e) {
      setLoading(false);
      notify(String(e));
    }
  };
  const clearSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  const addHighlight = (color: string, withNote = false) => {
    if (!selection || !paper) return;
    const h: Highlight = {
      id: crypto.randomUUID(),
      page: selection.page,
      text: selection.text,
      rects: selection.rects,
      color,
      note: "",
      created: Date.now(),
    };
    update((p) => ({ ...p, highlights: [...p.highlights, h] }));
    setTab("notes");
    setPanel(true);
    clearSelection();
    if (withNote) setNoteEditor(h);
    else notify("高亮已保存");
  };
  const translate = async (text: string, selectedPage = paper?.page || 1) => {
    if (!paper || !text.trim()) return;
    const source = paper,
      term = text.trim().slice(0, 5000),
      existing = source.words.find(
        (w) => w.term.toLowerCase() === term.toLowerCase(),
      ),
      id = existing?.id || crypto.randomUUID();
    const context =
      selection?.text === text
        ? lines
            .filter((l) =>
              selection.rects.some((r) => Math.abs(r.y - l.y) < 0.04),
            )
            .map((l) => l.text)
            .join(" ")
            .slice(0, 1800)
        : lines.find((l) => l.text.toLowerCase().includes(term.toLowerCase()))
            ?.text ||
          existing?.context ||
          "";
    const w: Word = {
      id,
      term,
      translation: existing?.translation || "",
      definition: existing?.definition || "",
      category: "GPT 生物医学翻译",
      context,
      page: selectedPage,
      count: (existing?.count || 0) + 1,
      found: !!existing?.found,
      created: existing?.created || Date.now(),
      provider: "OpenAI · " + modelName,
      status: "pending",
    };
    update((p) => ({
      ...p,
      words: [w, ...p.words.filter((w) => w.id !== id)],
    }));
    setTab("words");
    setPanel(true);
    clearSelection();
    setManualTerm("");
    if (!modelReady) {
      await updateById(source.id, (p) => ({
        ...p,
        words: p.words.map((word) =>
          word.id === id
            ? {
                ...word,
                status: "error",
                error: "尚未配置 OpenAI API。查询已记录，配置后可重试。",
              }
            : word,
        ),
      }));
      setShowSettings(true);
      return;
    }
    try {
      const result = await translator.translate(term, context);
      await updateById(source.id, (p) => ({
        ...p,
        words: p.words.map((word) =>
          word.id === id
            ? {
                ...word,
                translation: result.translation,
                definition: result.explains.join("\n"),
                status: "success",
                found: true,
                error: undefined,
                provider: result.provider,
              }
            : word,
        ),
      }));
    } catch (error) {
      await updateById(source.id, (p) => ({
        ...p,
        words: p.words.map((word) =>
          word.id === id
            ? {
                ...word,
                status: "error",
                error: error instanceof Error ? error.message : "翻译失败",
              }
            : word,
        ),
      }));
    }
  };
  const ask = () => {
    if (!selection) return;
    setChatDraft(`请解释这段内容的含义：\n“${selection.text}”`);
    setTab("chat");
    setPanel(true);
    clearSelection();
  };
  const sendQuestion = async () => {
    const source = paperRef.current,
      text = chatDraft.trim();
    if (!source || !text || chatBusy) return;
    const id = crypto.randomUUID();
    setChatDraft("");
    update((p) => ({
      ...p,
      chat: [
        ...p.chat,
        {
          id,
          role: "user",
          text,
          page: p.page,
          status: modelReady ? "sending" : "draft",
        },
      ],
    }));
    if (!modelReady) {
      setShowSettings(true);
      notify("问题已保存，请先配置 OpenAI。");
      return;
    }
    setChatBusy(true);
    try {
      let context = "";
      if (includePage && pdfRef.current) {
        const page = await pdfRef.current.getPage(source.page),
          content = await page.getTextContent();
        context = content.items
          .filter((i): i is typeof i & { str: string } => "str" in i)
          .map((i) => i.str)
          .join(" ")
          .slice(0, 18000);
        await updateById(source.id, (p) => ({
          ...p,
          chat: p.chat.map((m) => (m.id === id ? { ...m, context } : m)),
        }));
      }
      const messages = [
        ...conversationHistory(source.chat),
        { role: "user" as const, content: text },
      ];
      const answer = await assistant.ask({
        messages,
        context: context || undefined,
        page: source.page,
      });
      await updateById(source.id, (p) => ({
        ...p,
        chat: [
          ...p.chat.map((m) =>
            m.id === id ? { ...m, status: "complete" as const } : m,
          ),
          {
            id: crypto.randomUUID(),
            role: "assistant",
            text: answer.text,
            page: source.page,
            status: "complete",
            model: answer.model,
            incomplete: answer.incomplete,
          },
        ],
      }));
    } catch (error) {
      await updateById(source.id, (p) => ({
        ...p,
        chat: p.chat.map((m) =>
          m.id === id
            ? {
                ...m,
                status: "error",
                error: error instanceof Error ? error.message : "模型请求失败",
              }
            : m,
        ),
      }));
    } finally {
      setChatBusy(false);
    }
  };
  const fetchModels = async () => {
    setModelBusy(true);
    setModelMessage("");
    try {
      const result = await assistant.models(modelKey.trim() || undefined);
      setModelOptions(result.models);
      setModelMessage(
        result.models.length
          ? "已获取模型列表，请选择或填写模型，再保存。"
          : "未找到文本模型，可直接填写你账号支持的模型 ID。",
      );
    } catch (error) {
      setModelMessage(error instanceof Error ? error.message : "获取失败");
    } finally {
      setModelBusy(false);
    }
  };
  const saveModel = async () => {
    setModelBusy(true);
    setModelMessage("");
    try {
      const result = await assistant.configure({
        apiKey: modelKey.trim(),
        model: modelName.trim(),
      });
      setModelKey("");
      setModelReady(result.configured);
      setModelName(result.model || "gpt-6.1-sol");
      setModelVerified("");
      setModelMessage("配置已保存。请点击“测试模型连接”确认实际调用成功。");
    } catch (error) {
      setModelMessage(error instanceof Error ? error.message : "保存失败");
    } finally {
      setModelBusy(false);
    }
  };
  const testModel = async () => {
    setModelBusy(true);
    setModelMessage("正在发送一条不含文献内容的测试消息…");
    try {
      const result = await assistant.test();
      setModelVerified(result.verifiedAt);
      setModelMessage("模型测试成功：" + result.text);
    } catch (error) {
      setModelMessage(error instanceof Error ? error.message : "连接失败");
    } finally {
      setModelBusy(false);
    }
  };
  const exportWords = () => {
    if (!paper) return;
    const rows = [
      ["词汇", "翻译", "解释", "页码", "查询次数", "上下文", "来源", "状态"],
      ...paper.words.map((w) => [
        w.term,
        w.translation,
        w.definition,
        w.page,
        w.count,
        w.context,
        w.provider,
        w.status,
      ]),
    ];
    download(
      "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      paper.name.replace(/\.pdf$/i, "") + "-词汇.csv",
      "text/csv;charset=utf-8",
    );
  };
  const backup = () => {
    if (paper)
      download(
        JSON.stringify(
          { format: "biofocus-annotations", version: 1, paper },
          null,
          2,
        ),
        paper.name.replace(/\.pdf$/i, "") + "-阅读备份.json",
        "application/json",
      );
  };
  const importBackup = async (file?: File) => {
    if (!file || !paper) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("备份过大");
      const data = JSON.parse(await file.text());
      if (
        data.format !== "biofocus-annotations" ||
        data.version !== 1 ||
        data.paper?.id !== paper.id
      )
        throw new Error("备份与当前 PDF 不匹配，请先打开对应文献。");
      const p = data.paper as Paper;
      if (
        !Array.isArray(p.highlights) ||
        !Array.isArray(p.words) ||
        !Array.isArray(p.chat)
      )
        throw new Error("备份格式不正确");
      const validRect = (r: unknown) => {
        const x = r as Record<string, number>;
        return (
          x &&
          ["x", "y", "w", "h"].every(
            (k) => Number.isFinite(x[k]) && x[k] >= 0 && x[k] <= 1,
          )
        );
      };
      if (
        p.highlights.some(
          (h) =>
            !Number.isInteger(h.page) ||
            !Array.isArray(h.rects) ||
            !h.rects.every(validRect) ||
            typeof h.text !== "string" ||
            !/^#[0-9a-f]{6}$/i.test(h.color),
        )
      )
        throw new Error("高亮数据无效");
      if (
        p.words.some(
          (w) =>
            typeof w.term !== "string" || typeof w.translation !== "string",
        ) ||
        p.chat.some(
          (m) =>
            typeof m.text !== "string" ||
            !["user", "assistant"].includes(m.role),
        )
      )
        throw new Error("词汇或聊天数据无效");
      if (
        Object.values(p.regions || {}).some(
          (rs) => !Array.isArray(rs) || !rs.every(validRect),
        )
      )
        throw new Error("图表区域无效");
      update((current) => ({
        ...current,
        highlights: p.highlights,
        words: p.words,
        chat: p.chat,
        regions: p.regions || {},
      }));
      notify("阅读记录已恢复");
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法读取备份");
    }
  };
  const exportPdf = async () => {
    if (!paper) return;
    try {
      notify("正在生成带批注的 PDF…");
      const bytes = await readPaperBytes(paper);
      download(
        await annotatedPdf(bytes, paper),
        paper.name.replace(/\.pdf$/i, "") + "-BioFocus.pdf",
        "application/pdf",
      );
      notify("已导出高亮及附注");
    } catch (error) {
      notify("导出失败：" + String(error));
    }
  };
  const deleteCurrent = async (p: Paper) => {
    if (
      !window.confirm(
        `移除“${p.name}”及其本地阅读记录？请先导出需要保留的备份。`,
      )
    )
      return;
    await storage.removePaper(p.id);
    const rest = papers.filter((x) => x.id !== p.id);
    setPapers(rest);
    if (paper?.id === p.id) {
      if (rest.length) await open(rest[0]);
      else {
        paperRef.current = null;
        setPaper(null);
        setPdf(null);
      }
    }
    notify("文献已从本机文献库移除");
  };
  const pageWidth =
      Math.max(280, Math.min(800, availableWidth - 72)) * (zoom / 100),
    currentLine = lines[paper?.line || 0];
  return (
    <div
      className={`app ${panel ? "with-panel" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void importFile(e.dataTransfer.files[0]);
      }}
    >
      <input
        type="file"
        accept="application/pdf"
        ref={inputRef}
        hidden
        onChange={(e) => {
          void importFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept="application/json"
        ref={importRef}
        hidden
        onChange={(e) => {
          void importBackup(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <aside className="library">
        <div className="brand">
          <span className="brand-mark">
            <BookOpen size={22} />
          </span>
          <span>
            biofocus<span className="brand-dot">.</span>
          </span>
        </div>
        <div className="workspace-label">YOUR READING SPACE</div>
        <button
          className="import-button"
          onClick={() => inputRef.current?.click()}
        >
          <Plus size={17} /> 导入 PDF <span>↗</span>
        </button>
        <label className="library-search">
          <Search size={15} />
          <input
            aria-label="搜索文献库"
            placeholder="搜索文献…"
            value={librarySearch}
            onChange={(e) => setLibrarySearch(e.target.value)}
          />
        </label>
        <div className="library-section">
          <span>我的文献</span>
          <span>{papers.length.toString().padStart(2, "0")}</span>
        </div>
        <div className="paper-list">
          {papers
            .filter((p) =>
              p.name.toLowerCase().includes(librarySearch.toLowerCase()),
            )
            .map((p) => (
              <div
                key={p.id}
                className={`paper-card ${p.id === paper?.id ? "selected" : ""}`}
              >
                <button className="paper-open" onClick={() => void open(p)}>
                  <FileText size={18} />
                  <span className="paper-card-text">
                    <strong>{p.name.replace(/\.pdf$/i, "")}</strong>
                    <small>
                      {p.pages ? p.pages + " 页" : "PDF"} ·{" "}
                      {new Date(p.added).toLocaleDateString("zh-CN", {
                        month: "short",
                        day: "numeric",
                      })}
                    </small>
                  </span>
                </button>
                <button
                  className="paper-delete"
                  title="移除文献"
                  aria-label={`移除 ${p.name}`}
                  onClick={() => void deleteCurrent(p)}
                >
                  <Trash2 size={13} />
                </button>
                {p.id === paper?.id && (
                  <div className="paper-progress">
                    <i
                      style={{ width: (p.page / (p.pages || 1)) * 100 + "%" }}
                    />
                  </div>
                )}
              </div>
            ))}
          <div className="folder-section">
            <button
              className="folder-heading"
              onClick={() => void chooseFolder()}
              title={folderLibrary.folder || "连接文献文件夹"}
            >
              <FolderOpen size={14} />
              <span>
                {folderLibrary.folder ? "文献阅读 · 文件夹" : "连接文献文件夹"}
              </span>
              <Plus size={13} />
            </button>
            {folderLibrary.folder && (
              <small className="folder-status">
                已连接 · {folderLibrary.files.length} 篇 PDF · 自动同步
              </small>
            )}
            {folderLibrary.files
              .filter((f) =>
                f.relativePath
                  .toLowerCase()
                  .includes(librarySearch.toLowerCase()),
              )
              .map((f) => (
                <button
                  key={f.key}
                  className="folder-file"
                  onClick={() => void openFolderFile(f)}
                  title={f.relativePath}
                >
                  <FileText size={14} />
                  <span>{f.name.replace(/\.pdf$/i, "")}</span>
                </button>
              ))}
          </div>
        </div>
        <div className="library-bottom">
          <div className="private-note">
            <ShieldCheck size={16} />
            <div>
              <strong>你的阅读，留在本机</strong>
              <span>PDF 与笔记本地保存</span>
            </div>
          </div>
          <button className="sidebar-link" onClick={() => void addDemo()}>
            <FolderOpen size={16} /> 打开示例文献
          </button>
          <button className="sidebar-link" onClick={() => setShowHelp(true)}>
            <Keyboard size={16} /> 使用指南与快捷键
          </button>
          <div className="sidebar-footer">
            <span className="version">BIOFOCUS · 0.4</span>
            <IconButton
              icon={Settings2}
              label="设置"
              onClick={() => setShowSettings(true)}
            />
          </div>
        </div>
      </aside>
      <main className="reader">
        <header className="document-header">
          <div className="document-heading">
            <div className="breadcrumb">
              文献库 <ChevronRight size={12} /> <span>正在阅读</span>
            </div>
            <h1 title={paper?.name}>
              {paper?.name.replace(/\.pdf$/i, "") || "给阅读，留一点安静"}
            </h1>
          </div>
          <div className="header-actions">
            <span className="local-status">
              <span />
              本地已保存
            </span>
            <IconButton
              icon={theme === "day" ? Moon : Sun}
              label={theme === "day" ? "切换黑夜模式" : "切换白天模式"}
              onClick={() => setTheme((t) => (t === "day" ? "night" : "day"))}
            />
            <div className="export-wrapper">
              <IconButton
                icon={Download}
                label="导出"
                onClick={() => setExportOpen(!exportOpen)}
              />
              {exportOpen && (
                <div className="dropdown">
                  <button
                    onClick={() => {
                      void exportPdf();
                      setExportOpen(false);
                    }}
                  >
                    带批注的 PDF
                  </button>
                  <button
                    onClick={() => {
                      backup();
                      setExportOpen(false);
                    }}
                  >
                    阅读记录备份 JSON
                  </button>
                  <button
                    onClick={() => {
                      exportWords();
                      setExportOpen(false);
                    }}
                  >
                    本文词汇 CSV
                  </button>
                  <button
                    onClick={() => {
                      importRef.current?.click();
                      setExportOpen(false);
                    }}
                  >
                    导入阅读记录
                  </button>
                </div>
              )}
            </div>
            <IconButton
              icon={panel ? PanelRightClose : PanelRightOpen}
              label={panel ? "收起侧栏" : "展开侧栏"}
              onClick={() => setPanel(!panel)}
            />
          </div>
        </header>
        <div className="reading-toolbar">
          <button
            className={`focus-toggle ${focus ? "on" : ""}`}
            onClick={() => setFocus(!focus)}
            aria-pressed={focus}
          >
            <Focus size={16} />
            <span>逐行聚焦</span>
            <span className="toggle-track">
              <i />
            </span>
          </button>
          <div className="toolbar-divider" />
          <div className="line-control">
            <IconButton
              icon={Minus}
              label="减少聚焦行数"
              onClick={() => setLineCount((c) => Math.max(1, c - 1))}
            />
            <span>
              <b>{lineCount}</b> 行
            </span>
            <IconButton
              icon={Plus}
              label="增加聚焦行数"
              onClick={() => setLineCount((c) => Math.min(12, c + 1))}
            />
          </div>
          <div className="toolbar-divider" />
          <span
            className="text-button image-toggle enabled"
            title="图表、图内文字和图注始终常亮，不参与正文导航"
          >
            <Image size={16} />
            图表与图注常亮
            <Check size={13} />
          </span>
          <IconButton
            icon={Scan}
            label="手动框选常亮图表"
            active={regionMode}
            onClick={() => {
              setRegionMode(!regionMode);
              clearSelection();
            }}
          />
          <div className="toolbar-spacer" />
          <div className="zoom-control">
            <button
              onClick={() => setZoom((z) => Math.max(60, z - 10))}
              aria-label="缩小"
            >
              −
            </button>
            <span>{zoom}%</span>
            <button
              onClick={() => setZoom((z) => Math.min(180, z + 10))}
              aria-label="放大"
            >
              +
            </button>
            <IconButton
              icon={Maximize2}
              label="适合宽度"
              onClick={() => setZoom(100)}
            />
          </div>
        </div>
        <div className="reader-subbar">
          <span className="focus-hint">
            <span className="tiny-indicator" />{" "}
            {regionMode
              ? "拖动鼠标，框住需要始终明亮的图表"
              : focus
                ? "把注意力，留在眼前这一行"
                : "自由阅读 · 选中文字即可翻译或批注"}
          </span>
          {regionMode ? (
            <button
              className="subtle-button"
              onClick={() => {
                update((p) => ({
                  ...p,
                  regions: { ...p.regions, [p.page]: [] },
                }));
                notify("本页手动区域已清除");
              }}
            >
              清除本页手动区域
            </button>
          ) : (
            <label className="dim-control">
              遮暗{" "}
              <input
                aria-label="遮暗程度"
                type="range"
                min="0.1"
                max="0.9"
                step="0.05"
                value={dim}
                onChange={(e) => setDim(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        <div
          className="pdf-viewport"
          ref={viewportRef}
          onScroll={() => setSelection(null)}
        >
          <div className="page-stage">
            {loading ? (
              <div className="loading-document">
                <span className="spinner" />
                <h3>正在打开文献</h3>
                <p>解析文字、页码与图表</p>
              </div>
            ) : pdf && paper ? (
              <PdfPage
                pdf={pdf}
                page={paper.page}
                width={pageWidth}
                line={paper.line}
                count={lineCount}
                focus={focus}
                dim={dim}
                highlights={paper.highlights}
                regions={paper.regions[paper.page] || EMPTY_REGIONS}
                regionMode={regionMode}
                search={search}
                onLines={setLines}
                onSelect={setSelection}
                onLine={(line) => update((p) => ({ ...p, line }))}
                onRegion={(r) => {
                  update((p) => ({
                    ...p,
                    regions: {
                      ...p.regions,
                      [p.page]: [...(p.regions[p.page] || []), r],
                    },
                  }));
                  notify("图表常亮区域已保存");
                }}
                onHighlight={setNoteEditor}
                onError={notify}
              />
            ) : (
              <div className="loading-document">
                <BookOpen size={45} strokeWidth={1} />
                <h2>从一篇好文章开始。</h2>
                <p>把 PDF 拖到这里，或导入你的第一篇文献。</p>
                <button
                  className="primary-button"
                  onClick={() => inputRef.current?.click()}
                >
                  导入 PDF
                </button>
              </div>
            )}
          </div>
        </div>
        <footer className="reader-footer">
          <div className="page-navigation">
            <IconButton
              icon={ChevronLeft}
              label="上一页"
              disabled={!paper || paper.page <= 1}
              onClick={() => changePage((paper?.page || 1) - 1)}
            />
            <label>
              <input
                aria-label="当前页码"
                value={pageInput}
                onChange={(e) =>
                  setPageInput(e.target.value.replace(/\D/g, ""))
                }
                onBlur={() => {
                  if (paper) {
                    const next = Number(pageInput) || paper.page;
                    changePage(next);
                    setPageInput(String(clamp(next, 1, paper.pages)));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <span>/ {paper?.pages || "—"}</span>
            </label>
            <IconButton
              icon={ChevronRight}
              label="下一页"
              disabled={!paper || paper.page >= paper.pages}
              onClick={() => changePage((paper?.page || 1) + 1)}
            />
          </div>
          <div className="keyboard-hints">
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <span>移动聚焦</span>
            <kbd>←</kbd>
            <kbd>→</kbd>
            <span>调整行数</span>
          </div>
          <div className="line-navigation">
            <span>
              {lines.length
                ? `${Math.min((paper?.line || 0) + 1, lines.length)} / ${lines.length} 行`
                : "—"}
            </span>
            <IconButton
              icon={ArrowUp}
              label="上一行"
              disabled={!paper || (!lines.length && paper.page <= 1)}
              onClick={() => moveLine(-1)}
            />
            <IconButton
              icon={ArrowDown}
              label="下一行"
              disabled={!paper || (!lines.length && paper.page >= paper.pages)}
              onClick={() => moveLine(1)}
            />
          </div>
        </footer>
      </main>
      {panel && (
        <aside className="research-panel">
          <div className="panel-title">
            <span>阅读工作台</span>
            <span className="panel-kicker">THINK DEEPER</span>
          </div>
          <div className="panel-tabs">
            <button
              className={tab === "notes" ? "active" : ""}
              onClick={() => setTab("notes")}
            >
              <StickyNote size={15} />
              笔记<span>{paper?.highlights.length || 0}</span>
            </button>
            <button
              className={tab === "words" ? "active" : ""}
              onClick={() => setTab("words")}
            >
              <Languages size={15} />
              词汇<span>{paper?.words.length || 0}</span>
            </button>
            <button
              className={tab === "chat" ? "active" : ""}
              onClick={() => setTab("chat")}
            >
              <MessageSquare size={15} />
              问问 GPT
            </button>
          </div>
          {tab === "words" && (
            <>
              <div className="panel-intro">
                <div className="eyebrow">A PERSONAL LEXICON</div>
                <h2>读过，也记得。</h2>
                <p>本文查询过的词汇，会留在这里。</p>
              </div>
              <form
                className="term-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void translate(manualTerm);
                }}
              >
                <Search size={16} />
                <input
                  aria-label="查询词汇"
                  placeholder="输入或在文中选择词汇"
                  value={manualTerm}
                  onChange={(e) => setManualTerm(e.target.value)}
                />
                <button aria-label="翻译词汇" disabled={!manualTerm.trim()}>
                  <ChevronRight size={18} />
                </button>
              </form>
              <div
                className={`service-indicator ${modelReady ? "connected" : ""}`}
              >
                <span />
                {modelReady ? "GPT 翻译已配置" : "GPT 翻译待配置"}
                <button onClick={() => setShowSettings(true)}>
                  {modelReady ? "设置" : "配置"}
                  <ChevronRight size={12} />
                </button>
              </div>
              <div className="panel-scroll words-scroll">
                {paper?.words.length ? (
                  <>
                    <div className="section-row">
                      <span>本文词汇 · {paper.words.length}</span>
                      <button title="导出本文词汇" onClick={exportWords}>
                        <Download size={14} />
                      </button>
                    </div>
                    {paper.words.map((w) => (
                      <article className="word-card" key={w.id}>
                        <div className="word-top">
                          <strong>{w.term}</strong>
                          <button
                            className="page-chip"
                            onClick={() => changePage(w.page)}
                          >
                            P. {w.page}
                          </button>
                        </div>
                        {w.status === "pending" ? (
                          <p className="word-pending">
                            <span className="spinner small" />
                            GPT 翻译中…
                          </p>
                        ) : w.status === "error" ? (
                          <div className="word-error">
                            {w.error}
                            <button
                              onClick={() => void translate(w.term, w.page)}
                            >
                              重试翻译
                            </button>
                          </div>
                        ) : (
                          <>
                            <h3>{w.translation || "尚无释义"}</h3>
                            {w.definition && (
                              <p className="definition">{w.definition}</p>
                            )}
                          </>
                        )}
                        {w.context && <blockquote>{w.context}</blockquote>}
                        <div className="word-bottom">
                          <span>
                            {w.provider || "历史翻译"} · 查询 {w.count} 次
                          </span>
                          <button
                            aria-label={`删除词汇 ${w.term}`}
                            onClick={() =>
                              update((p) => ({
                                ...p,
                                words: p.words.filter((x) => x.id !== w.id),
                              }))
                            }
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </>
                ) : (
                  <Empty icon={Languages} title="让每个新词，都成为积累">
                    在 PDF
                    中选中单词或短语，点击「翻译」。译文、出处和查询次数会自动保存。
                  </Empty>
                )}
              </div>
              <div className="panel-bottom-note">
                <ShieldCheck size={13} />
                <span>仅选中文字和附近上下文发送给 GPT</span>
              </div>
            </>
          )}
          {tab === "notes" && (
            <>
              <div className="panel-intro">
                <div className="eyebrow">LEAVE A THOUGHT</div>
                <h2>好问题，值得留下。</h2>
                <p>高亮一段证据，写下你的理解。</p>
              </div>
              <div className="panel-scroll notes-scroll">
                {paper?.highlights.length ? (
                  paper.highlights.map((h) => (
                    <article className="note-card" key={h.id}>
                      <div className="note-heading">
                        <span>
                          <i style={{ background: h.color }} />{" "}
                          {h.note ? "阅读笔记" : "高亮摘录"}
                        </span>
                        <button
                          className="page-chip"
                          onClick={() => changePage(h.page)}
                        >
                          P. {h.page}
                        </button>
                      </div>
                      <blockquote style={{ borderColor: h.color }}>
                        {h.text}
                      </blockquote>
                      {h.note && <p>{h.note}</p>}
                      <div className="note-actions">
                        <button onClick={() => setNoteEditor(h)}>
                          <StickyNote size={13} />
                          {h.note ? "编辑笔记" : "添加笔记"}
                        </button>
                        <button
                          aria-label="删除批注"
                          onClick={() =>
                            update((p) => ({
                              ...p,
                              highlights: p.highlights.filter(
                                (x) => x.id !== h.id,
                              ),
                            }))
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <Empty icon={Highlighter} title="从一句触动你的话开始">
                    选中文字后选择高亮颜色，或添加笔记。批注会跟随这篇文章保存，也可导出到
                    PDF。
                  </Empty>
                )}
              </div>
              <button
                className="panel-export"
                onClick={() => void exportPdf()}
                disabled={!paper}
              >
                <Download size={15} />
                导出带批注的 PDF
              </button>
            </>
          )}
          {tab === "chat" && (
            <>
              <div className="chat-heading">
                <div className="gpt-mark">
                  <MessageSquare size={19} />
                </div>
                <div>
                  <h3>问问 GPT</h3>
                  <p>
                    <span />
                    {modelReady
                      ? (modelVerified ? "已测试 · " : "已配置 · ") + modelName
                      : "OpenAI 待配置"}
                  </p>
                </div>
              </div>
              <div className="panel-scroll chat-scroll">
                {paper?.chat.length ? (
                  paper.chat.map((m) => (
                    <div className={`chat-message ${m.role}`} key={m.id}>
                      <span>
                        {m.role === "assistant" ? m.model || "OpenAI" : "你"} ·
                        第 {m.page} 页
                      </span>
                      <p>{m.text}</p>
                      {m.status === "sending" ? (
                        <small>正在请求模型…</small>
                      ) : m.status === "error" ? (
                        <div className="chat-error">
                          {m.error}
                          <button onClick={() => setChatDraft(m.text)}>
                            重新编辑并发送
                          </button>
                        </div>
                      ) : m.status === "complete" ? (
                        <small>
                          {m.role === "assistant"
                            ? m.incomplete
                              ? "回答达到输出上限，可能尚未完成"
                              : "模型回答 · 已保存在本地"
                            : "已发送"}
                          {m.context ? " · 已附本页文字" : ""}
                        </small>
                      ) : (
                        <>
                          <small>草稿 · 尚未发送</small>
                          <button
                            className="chat-resend"
                            onClick={() => setChatDraft(m.text)}
                          >
                            编辑并发送
                          </button>
                        </>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="chat-empty">
                    <MessageSquare size={30} strokeWidth={1.2} />
                    <h3>把疑问，展开聊聊。</h3>
                    <p>
                      在文中选中内容，点击「问问 GPT」，就能把问题带到这里。
                    </p>
                    <div className="chat-status-note">
                      {modelReady
                        ? "已配置 OpenAI。可以提问或从文中选择一段内容开始。"
                        : "先在设置中填写 OpenAI API Key 并选择模型，即可开始真实问答。"}
                      {!modelReady && (
                        <button
                          className="subtle-button"
                          onClick={() => setShowSettings(true)}
                        >
                          配置 OpenAI
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
              <div className="chat-compose">
                <label className="context-option">
                  <input
                    type="checkbox"
                    checked={includePage}
                    onChange={(e) => setIncludePage(e.target.checked)}
                  />
                  附上本页文字
                </label>
                <textarea
                  aria-label="向 GPT 提问"
                  maxLength={20000}
                  placeholder="写下你的问题…"
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      sendQuestion();
                    }
                  }}
                />
                <div>
                  <span>
                    {chatBusy
                      ? "模型正在回答…"
                      : "Enter 发送 · Shift + Enter 换行"}
                  </span>
                  <button
                    onClick={sendQuestion}
                    aria-label="发送问题"
                    disabled={!chatDraft.trim() || chatBusy}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
              <div className="panel-bottom-note">
                {includePage
                  ? "会发送本页文字、问题和当前对话历史。"
                  : "仅发送问题、引用文字和当前对话历史。"}
              </div>
            </>
          )}
        </aside>
      )}
      {selection && (
        <div
          className="selection-menu"
          style={{
            left: selection.left,
            top: Math.min(selection.top, window.innerHeight - 130),
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="selection-primary">
            <button
              onClick={() => void translate(selection.text, selection.page)}
            >
              <Languages size={16} />
              翻译
            </button>
            <button onClick={ask}>
              <MessageSquare size={16} />
              问问 GPT
            </button>
          </div>
          <div className="selection-secondary">
            <span>高亮</span>
            {colors.map((c) => (
              <button
                className="color-dot"
                key={c}
                style={{ background: c }}
                aria-label={`高亮 ${c}`}
                onClick={() => addHighlight(c)}
              />
            ))}
            <button
              className="add-note"
              onClick={() => addHighlight(colors[0], true)}
            >
              <StickyNote size={14} />
              笔记
            </button>
            <button
              className="selection-close"
              onClick={clearSelection}
              aria-label="关闭选词菜单"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}
      {noteEditor && (
        <div className="modal-backdrop" onClick={() => setNoteEditor(null)}>
          <section
            className="modal note-modal"
            role="dialog"
            aria-modal="true"
            aria-label="编辑笔记"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>留下一点思考</h2>
              <IconButton
                icon={X}
                label="关闭笔记"
                onClick={() => setNoteEditor(null)}
              />
            </div>
            <blockquote>{noteEditor.text}</blockquote>
            <textarea
              autoFocus
              aria-label="笔记内容"
              placeholder="你如何理解这段内容？有什么疑问？"
              value={noteEditor.note}
              onChange={(e) =>
                setNoteEditor({ ...noteEditor, note: e.target.value })
              }
            />
            <button
              className="primary-button"
              onClick={() => {
                update((p) => ({
                  ...p,
                  highlights: p.highlights.map((h) =>
                    h.id === noteEditor.id ? noteEditor : h,
                  ),
                }));
                setNoteEditor(null);
                notify("笔记已保存");
              }}
            >
              <Check size={16} />
              保存笔记
            </button>
          </section>
        </div>
      )}
      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <section
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="阅读器设置"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <div className="eyebrow">MAKE IT YOURS</div>
                <h2>你的阅读偏好</h2>
              </div>
              <IconButton
                icon={X}
                label="关闭设置"
                onClick={() => setShowSettings(false)}
              />
            </div>
            <div className="settings-theme">
              <span>外观</span>
              <button
                className={theme === "day" ? "chosen" : ""}
                onClick={() => setTheme("day")}
              >
                <Sun size={17} />
                白天
              </button>
              <button
                className={theme === "night" ? "chosen" : ""}
                onClick={() => setTheme("night")}
              >
                <Moon size={17} />
                黑夜
              </button>
            </div>
            <div className="settings-section last">
              <div className="settings-section-title">
                <MessageSquare size={17} />
                <h3>GPT 翻译与答疑</h3>
                <span className={modelReady ? "ready-badge" : "status-badge"}>
                  {modelVerified
                    ? "测试通过"
                    : modelReady
                      ? "已配置"
                      : "待配置"}
                </span>
              </div>
              <p>
                翻译与答疑共用 OpenAI 官方 API
                和模型配置；翻译进入本文词汇本，答疑进入右侧聊天，两边历史独立。
              </p>
              <label>
                OpenAI API Key
                <input
                  type="password"
                  autoComplete="new-password"
                  value={modelKey}
                  onChange={(e) => setModelKey(e.target.value)}
                  placeholder={
                    modelReady
                      ? "已保存，留空沿用原密钥"
                      : "填写你的 OpenAI API Key"
                  }
                />
              </label>
              <label>
                模型名称
                <input
                  list="openai-models"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="gpt-6.1-sol"
                />
                <datalist id="openai-models">
                  {modelOptions.map((id) => (
                    <option key={id} value={id} />
                  ))}
                </datalist>
              </label>
              <div className="config-buttons model-buttons">
                <button
                  className="secondary-button"
                  disabled={modelBusy}
                  onClick={() => void fetchModels()}
                >
                  获取可用模型
                </button>
                <button
                  className="primary-button"
                  disabled={modelBusy}
                  onClick={() => void saveModel()}
                >
                  保存模型配置
                </button>
                {modelReady && (
                  <button
                    className="secondary-button"
                    disabled={modelBusy}
                    onClick={() => void testModel()}
                  >
                    测试模型连接
                  </button>
                )}
              </div>
              {modelMessage && (
                <p className="config-message" role="status">
                  {modelMessage}
                </p>
              )}
              <div className="credential-note">
                <ShieldCheck size={15} />
                <span>
                  {window.biofocus
                    ? "密钥使用 Windows 本机加密保存。"
                    : "密钥保存在本地服务进程内存中。"}
                  连接测试只发送一条简短测试消息，会消耗少量 API 额度。
                </span>
              </div>
              <div className="credential-note">
                <ShieldCheck size={15} />
                <span>
                  词汇本与问答记录保存在本机，不会同步到 ChatGPT
                  App。翻译发送选中文字及附近上下文；答疑发送问题和本篇已完成的对话，附本页文字需主动勾选。不创建远端会话；API
                  数据默认不用于训练，常规安全日志仍可能保留最多 30
                  天，例外情况可能更久。
                </span>
              </div>
              <div className="config-buttons">
                {modelReady && (
                  <button
                    className="subtle-button"
                    onClick={() =>
                      void assistant.clear().then(() => {
                        setModelReady(false);
                        setModelVerified("");
                        notify("模型凭据已清除");
                      })
                    }
                  >
                    清除模型凭据
                  </button>
                )}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAI 密钥管理
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          </section>
        </div>
      )}
      {showHelp && (
        <div className="modal-backdrop" onClick={() => setShowHelp(false)}>
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-label="使用指南"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>给阅读，留一点安静。</h2>
              <IconButton
                icon={X}
                label="关闭指南"
                onClick={() => setShowHelp(false)}
              />
            </div>
            <div className="shortcut-list">
              <div>
                <span>
                  <kbd>↑</kbd> <kbd>↓</kbd>
                </span>
                <p>向上 / 向下移动半框行数（向下取整），1–2 行时每次移动一行</p>
              </div>
              <div>
                <span>
                  <kbd>←</kbd> <kbd>→</kbd>
                </span>
                <p>减少 / 增加聚焦行数（1–12 行）</p>
              </div>
              <div>
                <span>
                  <kbd>Esc</kbd>
                </span>
                <p>关闭选词菜单或结束图表框选</p>
              </div>
            </div>
            <p>
              点击正文可把聚焦框移动到对应行；选中文字后可翻译、提问、高亮、记笔记。输入文本或选中文字时，方向键保留正常编辑行为。
            </p>
            <p>
              双栏正文按左栏到底、再读右栏排列；聚焦框在换栏前停止扩展。图表、图内文字与图注始终常亮，不参与正文导航；页眉、页脚和出版脚注会尽量排除。复杂图表可用工具栏的框选按钮补充保护区域。扫描
              PDF 需要先添加 OCR 文本层才能逐行阅读。
            </p>
            <p>
              PDF、高亮、笔记、词汇和提问保存在本机应用存储中。定期导出阅读记录备份；清除应用或浏览器数据会删除这些记录。
            </p>
          </section>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <div>
            <Upload size={44} />
            <h2>把文章放进来。</h2>
            <p>松开鼠标，开始专注阅读</p>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}
