export type LengthUnit = "pt" | "inch" | "cm" | "mm" | "char";

export interface LengthValue {
  value: number;
  unit: LengthUnit;
}

const CM_PER_INCH = 2.54;
const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function toFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeUnit(unit: string | null | undefined): LengthUnit | null {
  const normalized = normalizeText(unit).toLowerCase();
  if (!normalized) return null;
  if (normalized === "pt" || normalized === "pts" || normalized === "磅") return "pt";
  if (normalized === "in" || normalized === "inch" || normalized === "inches" || normalized === "英寸") return "inch";
  if (normalized === "cm" || normalized === "厘米") return "cm";
  if (normalized === "mm" || normalized === "毫米") return "mm";
  if (normalized === "char" || normalized === "chars" || normalized === "character" || normalized === "characters" || normalized === "字" || normalized === "字符") return "char";
  return null;
}

export function parseLengthValue(value: unknown, defaultUnit: Exclude<LengthUnit, "char"> | "char" = "pt"): LengthValue | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    const numeric = toFiniteNumber(value);
    return numeric === null ? null : { value: numeric, unit: defaultUnit };
  }

  const source = normalizeText(value);
  if (!source) return null;

  const directNumber = toFiniteNumber(source);
  if (directNumber !== null) {
    return { value: directNumber, unit: defaultUnit };
  }

  const match = /^([+-]?\d+(?:\.\d+)?)\s*(pt|pts|磅|inches?|inch|in|英寸|cm|厘米|mm|毫米|chars?|character(?:s)?|char|字|字符)?$/i.exec(source);
  if (!match) return null;

  const numeric = toFiniteNumber(match[1]);
  if (numeric === null) return null;
  const unit = normalizeUnit(match[2]) || defaultUnit;
  return { value: numeric, unit };
}

export function convertLengthToPoints(length: LengthValue | null): number | null {
  if (!length) return null;
  if (!Number.isFinite(length.value)) return null;
  if (length.unit === "pt") return length.value;
  if (length.unit === "inch") return (length.value * PT_PER_INCH);
  if (length.unit === "cm") return (length.value / CM_PER_INCH) * PT_PER_INCH;
  if (length.unit === "mm") return (length.value / MM_PER_INCH) * PT_PER_INCH;
  return null;
}

export function convertPointsToUnit(points: number, unit: Exclude<LengthUnit, "char">): number {
  if (unit === "pt") return points;
  if (unit === "inch") return points / PT_PER_INCH;
  if (unit === "cm") return (points / PT_PER_INCH) * CM_PER_INCH;
  return (points / PT_PER_INCH) * MM_PER_INCH;
}

function roundNumber(value: number, precision = 3): number {
  const base = Math.pow(10, precision);
  const rounded = Math.round(value * base) / base;
  return Math.abs(rounded) < 0.000001 ? 0 : rounded;
}

export function normalizeLengthValue(length: LengthValue | null, precision = 3): LengthValue | null {
  if (!length) return null;
  if (!Number.isFinite(length.value)) return null;
  return { value: roundNumber(length.value, precision), unit: length.unit };
}

function unitLabel(unit: LengthUnit): string {
  if (unit === "pt") return "磅";
  if (unit === "inch") return "英寸";
  if (unit === "cm") return "厘米";
  if (unit === "mm") return "毫米";
  return "字符";
}

export function formatLengthValue(length: LengthValue | null): string {
  if (!length) return "未读取到明确设置";
  if (!Number.isFinite(length.value)) return "未读取到明确设置";
  const numberText = Math.abs(length.value % 1) < 0.0001 ? length.value.toFixed(0) : String(length.value);
  return `${numberText} ${unitLabel(length.unit)}`;
}
