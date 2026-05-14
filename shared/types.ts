export type TaskType = "rewrite" | "summary" | "insert" | "chat";
export type CodexChatMode = "ask" | "agent";
export type CodexReasoningEffort = "" | "low" | "medium" | "high" | "xhigh";

export interface ChatImageAttachment {
  name: string;
  path: string;
}

export interface ChatFileAttachment {
  name: string;
  path: string;
  mimeType?: string;
  size?: number;
}

export interface CodexRunRequest {
  task: TaskType;
  content: string;
  instruction?: string;
  threadId?: string;
  model?: string;
  mode?: CodexChatMode;
  reasoningEffort?: CodexReasoningEffort;
  imageAttachments?: ChatImageAttachment[];
  fileAttachments?: ChatFileAttachment[];
}

export interface CodexStreamEvent {
  type: string;
  text?: string;
  thread_id?: string;
  [key: string]: unknown;
}

export interface CodexRunResponse {
  ok: boolean;
  output: string;
  threadId?: string;
  events?: CodexStreamEvent[];
  error?: string;
}

export interface CodexBridgeConfig {
  host: string;
  port: number;
  cliPath: string;
  workingDir: string;
  detectedCliPaths: string[];
}

export interface CodexModelsResponse {
  ok: boolean;
  models: string[];
  defaultModel?: string;
  error?: string;
}

export interface IllustrationRequest {
  prompt: string;
  title?: string;
}

export interface IllustrationResponse {
  ok: boolean;
  path: string;
  error?: string;
}

export interface ImageUploadRequest {
  name: string;
  dataBase64: string;
}

export interface ImageUploadResponse {
  ok: boolean;
  path: string;
  name: string;
  error?: string;
}

export interface FileUploadRequest {
  name: string;
  dataBase64: string;
  mimeType?: string;
}

export interface FileUploadResponse {
  ok: boolean;
  path: string;
  name: string;
  mimeType?: string;
  size: number;
  error?: string;
}
