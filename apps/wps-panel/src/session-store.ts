export interface UploadedImage {
  name: string;
  path: string;
  previewDataUrl: string;
  uploadedAt: number;
}

export interface UploadedFile {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  uploadedAt: number;
}

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  text: string;
  images: UploadedImage[];
  files: UploadedFile[];
  createdAt: number;
}

export interface ChatSessionRecord {
  id: string;
  title: string;
  pinned: boolean;
  messages: ChatMessageRecord[];
  threadId: string;
  lastAssistantOutput: string;
  pendingImages: UploadedImage[];
  pendingFiles: UploadedFile[];
  documentKey: string;
  documentLabel: string;
  createdAt: number;
  updatedAt: number;
}

export const STORAGE_KEY = "wps-codex-chat-sessions-v1";
export const INITIAL_SESSION_TITLE = "新会话";

export function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function makeSession(title = INITIAL_SESSION_TITLE, documentKey = "", documentLabel = ""): ChatSessionRecord {
  const now = Date.now();
  return {
    id: createId("session"),
    title,
    pinned: false,
    messages: [],
    threadId: "",
    lastAssistantOutput: "",
    pendingImages: [],
    pendingFiles: [],
    documentKey,
    documentLabel,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeSession(raw: unknown): ChatSessionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<ChatSessionRecord>;
  if (!data.id || typeof data.id !== "string") return null;
  if (!Array.isArray(data.messages)) return null;
  const now = Date.now();
  return {
    id: data.id,
    title: typeof data.title === "string" && data.title.trim() ? data.title : INITIAL_SESSION_TITLE,
    pinned: data.pinned === true,
    messages: data.messages
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const message = item as Partial<ChatMessageRecord>;
        return {
          id: typeof message.id === "string" ? message.id : createId("msg"),
          role: message.role === "assistant" ? "assistant" : "user",
          text: typeof message.text === "string" ? message.text : "",
          images: Array.isArray(message.images)
            ? message.images
                .filter((image) => image && typeof image === "object")
                .map((image) => {
                  const one = image as Partial<UploadedImage>;
                  return {
                    name: typeof one.name === "string" ? one.name : "image.png",
                    path: typeof one.path === "string" ? one.path : "",
                    previewDataUrl: typeof one.previewDataUrl === "string" ? one.previewDataUrl : "",
                    uploadedAt: typeof one.uploadedAt === "number" ? one.uploadedAt : now,
                  };
                })
            : [],
          files: Array.isArray((message as Partial<ChatMessageRecord>).files)
            ? (message as Partial<ChatMessageRecord>).files!
                .filter((file) => file && typeof file === "object")
                .map((file) => {
                  const one = file as Partial<UploadedFile>;
                  return {
                    name: typeof one.name === "string" ? one.name : "file",
                    path: typeof one.path === "string" ? one.path : "",
                    mimeType: typeof one.mimeType === "string" ? one.mimeType : "application/octet-stream",
                    size: typeof one.size === "number" ? one.size : 0,
                    uploadedAt: typeof one.uploadedAt === "number" ? one.uploadedAt : now,
                  };
                })
            : [],
          createdAt: typeof message.createdAt === "number" ? message.createdAt : now,
        };
      }),
    threadId: typeof data.threadId === "string" ? data.threadId : "",
    lastAssistantOutput: typeof data.lastAssistantOutput === "string" ? data.lastAssistantOutput : "",
    pendingImages: Array.isArray(data.pendingImages)
      ? data.pendingImages
          .filter((image) => image && typeof image === "object")
          .map((image) => {
            const one = image as Partial<UploadedImage>;
            return {
              name: typeof one.name === "string" ? one.name : "image.png",
              path: typeof one.path === "string" ? one.path : "",
              previewDataUrl: typeof one.previewDataUrl === "string" ? one.previewDataUrl : "",
              uploadedAt: typeof one.uploadedAt === "number" ? one.uploadedAt : now,
            };
          })
      : [],
    pendingFiles: Array.isArray(data.pendingFiles)
      ? data.pendingFiles
          .filter((file) => file && typeof file === "object")
          .map((file) => {
            const one = file as Partial<UploadedFile>;
            return {
              name: typeof one.name === "string" ? one.name : "file",
              path: typeof one.path === "string" ? one.path : "",
              mimeType: typeof one.mimeType === "string" ? one.mimeType : "application/octet-stream",
              size: typeof one.size === "number" ? one.size : 0,
              uploadedAt: typeof one.uploadedAt === "number" ? one.uploadedAt : now,
            };
          })
      : [],
    documentKey: typeof data.documentKey === "string" ? data.documentKey : "",
    documentLabel: typeof data.documentLabel === "string" ? data.documentLabel : "",
    createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : now,
  };
}

export function loadSessionsFromStorage(): { sessions: ChatSessionRecord[]; activeSessionId: string } {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const first = makeSession();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([first]));
    return { sessions: [first], activeSessionId: first.id };
  }

  try {
    const parsed = JSON.parse(raw) as unknown[];
    const restored = (Array.isArray(parsed) ? parsed : [])
      .map((item) => normalizeSession(item))
      .filter((item): item is ChatSessionRecord => Boolean(item))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (restored.length) {
      return { sessions: restored, activeSessionId: restored[0].id };
    }
  } catch {
    // Fall through to recovery.
  }

  const fallback = makeSession();
  localStorage.setItem(STORAGE_KEY, JSON.stringify([fallback]));
  return { sessions: [fallback], activeSessionId: fallback.id };
}

export function persistSessions(sessions: ChatSessionRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function shortenTitle(input: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (!clean) return INITIAL_SESSION_TITLE;
  return clean.length > 22 ? `${clean.slice(0, 22)}...` : clean;
}

export function touchSession(session: ChatSessionRecord): void {
  session.updatedAt = Date.now();
}

export function sortSessionsByUpdatedAt(sessions: ChatSessionRecord[]): ChatSessionRecord[] {
  return sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findPreferredSessionId(sessions: ChatSessionRecord[], documentKey: string): string {
  if (!documentKey) return sessions[0]?.id || "";
  const exact = sortSessionsByUpdatedAt(sessions).find((session) => session.documentKey === documentKey);
  return exact?.id || sessions[0]?.id || "";
}

export function buildSessionMarkdown(session: ChatSessionRecord): string {
  const header = [
    `# ${session.title}`,
    "",
    `- 会话 ID：${session.id}`,
    `- 文档：${session.documentLabel || "未绑定"}`,
    `- 创建时间：${new Date(session.createdAt).toLocaleString()}`,
    `- 更新时间：${new Date(session.updatedAt).toLocaleString()}`,
    "",
  ];
  const messages = session.messages.flatMap((message) => [
    `## ${message.role === "user" ? "用户" : "Codex"}`,
    "",
    message.text || "(空)",
    "",
  ]);
  return header.concat(messages).join("\n");
}
