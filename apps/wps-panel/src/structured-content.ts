export interface WordTableContent {
  kind: "table";
  rows: string[][];
}

export type StructuredContent = WordTableContent;

export function detectStructuredContent(text: string): StructuredContent | null {
  const markdownTable = parseMarkdownTable(text);
  if (markdownTable) return markdownTable;
  return null;
}

function parseMarkdownTable(input: string): WordTableContent | null {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;

  for (let start = 0; start < lines.length - 1; start += 1) {
    if (!looksLikeMarkdownRow(lines[start]) || !looksLikeDividerRow(lines[start + 1])) continue;

    const header = splitMarkdownRow(lines[start]);
    const width = header.length;
    if (width < 2 || splitMarkdownRow(lines[start + 1]).length !== width) continue;

    const rows: string[][] = [header];
    for (let index = start + 2; index < lines.length; index += 1) {
      if (!looksLikeMarkdownRow(lines[index])) break;
      const row = splitMarkdownRow(lines[index]);
      if (row.length !== width) break;
      rows.push(row);
    }

    if (rows.length < 2) continue;
    return { kind: "table", rows };
  }

  return null;
}

function looksLikeMarkdownRow(line: string): boolean {
  const pipeCount = (extractMarkdownRowSegment(line).match(/\|/g) || []).length;
  return pipeCount >= 2;
}

function looksLikeDividerRow(line: string): boolean {
  const cells = splitMarkdownRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function splitMarkdownRow(line: string): string[] {
  const normalized = extractMarkdownRowSegment(line).replace(/^\|/, "").replace(/\|$/, "");
  return normalized.split("|").map((cell) => cell.trim());
}

function extractMarkdownRowSegment(line: string): string {
  const firstPipe = line.indexOf("|");
  const lastPipe = line.lastIndexOf("|");
  if (firstPipe < 0 || lastPipe <= firstPipe) return line;
  return line.slice(firstPipe, lastPipe + 1);
}
