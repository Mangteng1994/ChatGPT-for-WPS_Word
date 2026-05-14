import type { ChatMessageRecord } from "./session-store";

export type MessageAction = "copy" | "delete" | "rewrite";

export interface MessageActionContext {
  message: ChatMessageRecord;
  index: number;
}

export interface RenderedMessage {
  root: HTMLDivElement;
  text: HTMLDivElement;
}

const ACTION_ICONS: Record<MessageAction, string> = {
  copy: "⧉",
  delete: "⌫",
  rewrite: "↻",
};

const ACTION_LABELS: Record<MessageAction, string> = {
  copy: "复制回答",
  delete: "删除本轮问答",
  rewrite: "重新输入问题",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[char] || char;
  });
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function renderTable(lines: string[], start: number): { html: string; next: number } | null {
  const divider = lines[start + 1] || "";
  if (!lines[start]?.includes("|") || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider)) return null;
  const rows: string[][] = [];
  let index = start;
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("|")) break;
    if (index === start + 1) continue;
    rows.push(
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => inlineMarkdown(cell.trim()))
    );
  }
  if (rows.length < 2) return null;
  const [head, ...body] = rows;
  return {
    html: `<div class="md-table-wrap"><table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${body
      .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`,
    next: index,
  };
}

export function renderMessageText(target: HTMLElement, markdown: string): void {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let inCode = false;
  let code: string[] = [];
  let list: "ul" | "ol" | "" = "";

  const closeList = () => {
    if (!list) return;
    html.push(`</${list}>`);
    list = "";
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }

    const table = renderTable(lines, index);
    if (table) {
      closeList();
      html.push(table.html);
      index = table.next - 1;
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 5);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ordered || unordered) {
      const kind = ordered ? "ol" : "ul";
      if (list !== kind) {
        closeList();
        list = kind;
        html.push(`<${kind}>`);
      }
      html.push(`<li>${inlineMarkdown((ordered || unordered)![1])}</li>`);
      continue;
    }

    const quote = line.match(/^>\s*(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  closeList();
  if (inCode) html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  target.innerHTML = html.join("");
}

export function createMessageElement(
  context: MessageActionContext,
  handlers: Partial<Record<MessageAction, (context: MessageActionContext) => void>>
): RenderedMessage {
  const { message } = context;
  const wrap = document.createElement("div");
  wrap.className = `chat-entry chat-entry--${message.role}`;

  const bubble = document.createElement("div");
  bubble.className = `chat-message chat-message--${message.role}`;

  const text = document.createElement("div");
  text.className = "chat-message__text";
  renderMessageText(text, message.text);
  bubble.appendChild(text);

  if (message.images.length) {
    const imageWrap = document.createElement("div");
    imageWrap.className = "chat-message__attachments";
    message.images.forEach((image) => {
      if (!image.previewDataUrl) return;
      const img = document.createElement("img");
      img.src = image.previewDataUrl;
      img.alt = image.name;
      img.title = image.name;
      imageWrap.appendChild(img);
    });
    if (imageWrap.childElementCount) bubble.appendChild(imageWrap);
  }

  if (message.files.length) {
    const fileWrap = document.createElement("div");
    fileWrap.className = "chat-message__files";
    message.files.forEach((file) => {
      const item = document.createElement("span");
      item.className = "chat-message__file";
      item.title = file.path;
      item.textContent = `📄 ${file.name}`;
      fileWrap.appendChild(item);
    });
    bubble.appendChild(fileWrap);
  }

  wrap.appendChild(bubble);

  if (message.role === "assistant") {
    const actions = document.createElement("nav");
    actions.className = "chat-message-actions";
    (["copy", "delete", "rewrite"] as MessageAction[]).forEach((type) => {
      const icon = document.createElement("span");
      icon.className = "chat-message-actions__icon";
      icon.tabIndex = 0;
      icon.role = "button";
      icon.title = ACTION_LABELS[type];
      icon.setAttribute("aria-label", ACTION_LABELS[type]);
      icon.textContent = ACTION_ICONS[type];
      icon.addEventListener("click", () => handlers[type]?.(context));
      icon.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        handlers[type]?.(context);
      });
      actions.appendChild(icon);
    });
    wrap.appendChild(actions);
  }

  return { root: wrap, text };
}
