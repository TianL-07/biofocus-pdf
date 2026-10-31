export type Rect = { x: number; y: number; w: number; h: number };
export type Line = Rect & {
  text: string;
  baseline?: number;
  fontHeight?: number;
  angle?: number;
};
export type Highlight = {
  id: string;
  page: number;
  text: string;
  rects: Rect[];
  color: string;
  note: string;
  created: number;
};
export type Word = {
  id: string;
  term: string;
  translation: string;
  definition: string;
  category: string;
  context: string;
  page: number;
  count: number;
  found: boolean;
  created: number;
  provider?: string;
  status?: "pending" | "success" | "error";
  error?: string;
};
export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  page: number;
};
export type Paper = {
  id: string;
  name: string;
  size: number;
  added: number;
  pages: number;
  page: number;
  line: number;
  highlights: Highlight[];
  words: Word[];
  regions: Record<number, Rect[]>;
  chat: Message[];
  source?: { kind: "folder"; key: string };
};
export type FolderFile = {
  key: string;
  name: string;
  relativePath: string;
  size: number;
  modified: number;
};
export type FolderState = {
  folder: string | null;
  files: FolderFile[];
  truncated?: boolean;
};
export type Term = {
  term: string;
  zh: string;
  definition: string;
  category: string;
  aliases?: string[];
};
export type SelectionInfo = {
  text: string;
  rects: Rect[];
  page: number;
  left: number;
  top: number;
};
export type Tab = "notes" | "words" | "chat";
