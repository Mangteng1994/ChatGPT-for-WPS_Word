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


/**
 * Myers diff algorithm: finds the shortest edit script between two sequences.
 * Produces character-level operations suitable for inline review diffs.
 */
function myersCharDiff(
  a: string[],
  b: string[],
): { op: "equal" | "remove" | "add"; ch: string }[] {
  const N = a.length;
  const M = b.length;
  const MAX = N + M;

  if (N === 0) return b.map((ch) => ({ op: "add" as const, ch }));
  if (M === 0) return a.map((ch) => ({ op: "remove" as const, ch }));

  // trace[d] = array where trace[d][MAX + k] = furthest x on diagonal k at depth d
  const trace: number[][] = [];

  // Depth 0: follow the initial diagonal
  const V0 = new Array(2 * MAX + 1).fill(-1);
  let x = 0;
  let y = 0;
  while (x < N && y < M && a[x] === b[y]) { x++; y++; }
  V0[MAX + 0] = x;
  trace.push(V0);

  if (x >= N && y >= M) {
    return a.map((ch) => ({ op: "equal" as const, ch }));
  }

  for (let d = 1; d <= MAX; d++) {
    const prevV = trace[d - 1];
    const V = new Array(2 * MAX + 1).fill(-1);

    for (let k = -d; k <= d; k += 2) {
      // Decide whether to go down (from k+1) or right (from k-1)
      const goDown = k === -d || (k !== d && prevV[MAX + k - 1] < prevV[MAX + k + 1]);

      if (goDown) {
        x = prevV[MAX + k + 1];       // coming from diagonal k+1 (move down)
      } else {
        x = prevV[MAX + k - 1] + 1;   // coming from diagonal k-1 (move right)
      }
      y = x - k;

      // Follow the snake (diagonal moves for matching characters)
      while (x < N && y < M && a[x] === b[y]) { x++; y++; }

      V[MAX + k] = x;

      if (x >= N && y >= M) {
        // Found the shortest path — backtrack
        trace.push(V);
        return backtrackMyers(trace, a, b, d, k, MAX);
      }
    }

    trace.push(V);
  }

  return [];
}

function backtrackMyers(
  trace: number[][],
  a: string[],
  b: string[],
  d: number,
  k: number,
  MAX: number,
): { op: "equal" | "remove" | "add"; ch: string }[] {
  const ops: { op: "equal" | "remove" | "add"; ch: string }[] = [];
  let x = a.length;
  let y = b.length;

  for (let depth = d; depth >= 0; depth--) {
    const V = trace[depth];
    const prevK = (() => {
      if (depth === 0) return 0;
      const prevV = trace[depth - 1];
      const goDown = k === -depth || (k !== depth && prevV[MAX + k - 1] < prevV[MAX + k + 1]);
      return goDown ? k + 1 : k - 1;
    })();

    const prevX = depth === 0 ? 0 : trace[depth - 1][MAX + prevK];
    const prevY = prevX - prevK;

    if (depth > 0) {
      if (prevK < k) {
        // Moved RIGHT (prevK=k-1, diagonal increased): deleted a[prevX]
        // Snake starts at (prevX+1, prevY), ends at (x, y)
        while (x > prevX + 1 && y > prevY) {
          x--; y--;
          ops.unshift({ op: "equal", ch: a[x] });
        }
        ops.unshift({ op: "remove", ch: a[prevX] });
      } else {
        // Moved DOWN (prevK=k+1, diagonal decreased): inserted b[prevY]
        // Snake starts at (prevX, prevY+1), ends at (x, y)
        while (x > prevX && y > prevY + 1) {
          x--; y--;
          ops.unshift({ op: "equal", ch: a[x] });
        }
        ops.unshift({ op: "add", ch: b[prevY] });
      }
    } else {
      // Depth 0: just the initial diagonal snake
      while (x > 0 && y > 0) {
        x--; y--;
        ops.unshift({ op: "equal", ch: a[x] });
      }
    }

    x = prevX;
    y = prevY;
    k = prevK;
  }

  return ops;
}



/**
 * Build unified/merged diff segments using Myers diff algorithm.
 * Produces an inline review diff: deletions at original positions, insertions where text was added.
 */
export function buildUnifiedCharDiff(
  original: string,
  updated: string,
): UnifiedDiffSegment[] {
  const a = [...original];
  const b = [...updated];
  const ops = myersCharDiff(a, b);

  // Merge consecutive segments with the same operation
  const segments: UnifiedDiffSegment[] = [];
  for (const item of ops) {
    const last = segments[segments.length - 1];
    if (last && last.op === item.op) {
      last.text += item.ch;
    } else {
      segments.push({ op: item.op, text: item.ch });
    }
  }

  return segments;
}

export interface UnifiedDiffSegment {
  op: "equal" | "add" | "remove";
  text: string;
}