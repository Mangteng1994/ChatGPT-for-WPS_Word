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

export interface CharDiffSegment {
  op: "equal" | "add" | "remove";
  text: string;
}

/**
 * Character-level LCS diff for mixed Chinese/English text.
 * Returns segments with operations so the caller can render
 * side-by-side or unified diff views.
 */
export function buildCharDiff(original: string, updated: string): {
  left: CharDiffSegment[];
  right: CharDiffSegment[];
} {
  const a = [...original];
  const b = [...updated];
  const m = a.length;
  const n = b.length;

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce aligned segments
  const leftRaw: { op: "equal" | "remove"; ch: string }[] = [];
  const rightRaw: { op: "equal" | "add"; ch: string }[] = [];

  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      leftRaw.unshift({ op: "equal", ch: a[i - 1] });
      rightRaw.unshift({ op: "equal", ch: b[j - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      leftRaw.unshift({ op: "remove", ch: "" });
      rightRaw.unshift({ op: "add", ch: b[j - 1] });
      j--;
    } else {
      leftRaw.unshift({ op: "remove", ch: a[i - 1] });
      rightRaw.unshift({ op: "add", ch: "" });
      i--;
    }
  }

  // Merge adjacent segments with the same operation
  const merge = (raw: { op: string; ch: string }[]): CharDiffSegment[] => {
    const result: CharDiffSegment[] = [];
    for (const item of raw) {
      const last = result[result.length - 1];
      if (last && last.op === item.op) {
        last.text += item.ch;
      } else {
        result.push({ op: item.op as CharDiffSegment["op"], text: item.ch });
      }
    }
    return result;
  };

  return {
    left: merge(leftRaw),
    right: merge(rightRaw),
  };
}

/**
 * Returns true if the two strings differ.
 */
export function hasCharDiff(original: string, updated: string): boolean {
  return original !== updated;
}

/**
 * Build unified/merged diff segments: interleaves removed and added text
 * into a single stream suitable for an inline diff paragraph.
 */
export function buildUnifiedCharDiff(
  original: string,
  updated: string,
): UnifiedDiffSegment[] {
  const { left, right } = buildCharDiff(original, updated);

  // Reconstruct the raw character alignment from merged segments
  const leftRaw: { op: "equal" | "remove"; ch: string }[] = [];
  const rightRaw: { op: "equal" | "add"; ch: string }[] = [];

  for (const seg of left) {
    for (const ch of seg.text) {
      leftRaw.push({ op: seg.op as "equal" | "remove", ch });
    }
  }
  for (const seg of right) {
    for (const ch of seg.text) {
      rightRaw.push({ op: seg.op as "equal" | "add", ch });
    }
  }

  // Pad shorter array with empty placeholders
  const maxLen = Math.max(leftRaw.length, rightRaw.length);
  while (leftRaw.length < maxLen) leftRaw.push({ op: "remove", ch: "" });
  while (rightRaw.length < maxLen) rightRaw.push({ op: "add", ch: "" });

  // Walk both arrays and produce unified segments
  const raw: { op: string; ch: string }[] = [];
  for (let i = 0; i < maxLen; i++) {
    const l = leftRaw[i];
    const r = rightRaw[i];
    if (l.op === "equal" && r.op === "equal" && l.ch === r.ch) {
      raw.push({ op: "equal", ch: l.ch });
    } else if (l.ch && r.ch) {
      // Both sides have text — treat as modified (remove old, add new)
      raw.push({ op: "remove", ch: l.ch });
      raw.push({ op: "add", ch: r.ch });
    } else if (l.ch) {
      raw.push({ op: "remove", ch: l.ch });
    } else if (r.ch) {
      raw.push({ op: "add", ch: r.ch });
    }
  }

  // Merge consecutive same-op segments
  const result: UnifiedDiffSegment[] = [];
  for (const item of raw) {
    const last = result[result.length - 1];
    if (last && last.op === item.op) {
      last.text += item.ch;
    } else {
      result.push({ op: item.op as UnifiedDiffSegment["op"], text: item.ch });
    }
  }

  return result;
}

export interface UnifiedDiffSegment {
  op: "equal" | "add" | "remove";
  text: string;
}