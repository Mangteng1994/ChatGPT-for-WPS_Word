export type TaskType = "rewrite" | "summary" | "insert";

export interface CodexRunRequest {
  task: TaskType;
  content: string;
  instruction?: string;
  threadId?: string;
  workingDir: string;
  model?: string;
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

