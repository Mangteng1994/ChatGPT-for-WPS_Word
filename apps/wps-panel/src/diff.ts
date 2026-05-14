export type DiffOp = "equal" | "add" | "remove";

export interface DiffLine {
  op: DiffOp;
  text: string;
}

export function buildUnifiedDiff(original: string, updated: string): DiffLine[] {
  const before = splitLines(original);
  const after = splitLines(updated);
  const dp = buildTable(before, after);
  const result: DiffLine[] = [];

  let i = before.length;
  let j = after.length;

  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      result.push({ op: "equal", text: before[i - 1] });
      i -= 1;
      j -= 1;
      continue;
    }

    if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.push({ op: "remove", text: before[i - 1] });
      i -= 1;
    } else {
      result.push({ op: "add", text: after[j - 1] });
      j -= 1;
    }
  }

  while (i > 0) {
    result.push({ op: "remove", text: before[i - 1] });
    i -= 1;
  }

  while (j > 0) {
    result.push({ op: "add", text: after[j - 1] });
    j -= 1;
  }

  return result.reverse();
}

export function hasMeaningfulDiff(lines: DiffLine[]): boolean {
  return lines.some((line) => line.op !== "equal");
}

function splitLines(input: string): string[] {
  if (!input) return [];
  return input.split(/\r?\n/);
}

function buildTable(before: string[], after: string[]): number[][] {
  const rows = before.length + 1;
  const cols = after.length + 1;
  const dp = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp;
}
