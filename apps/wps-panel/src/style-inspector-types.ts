import type { NumberingSuffix } from "./style-nl-parser";
import type { LengthValue } from "./length-units";

export type StyleInspectTarget = "cursorParagraph" | "selectionSingleParagraph" | "selectionMultiParagraph";
export type StyleType = "paragraph" | "character" | "table" | "list" | "unknown";
export type ParagraphAlignment = "left" | "center" | "right" | "justify" | "distribute" | "unknown";
export type NumberingAlignment = "left" | "center" | "right" | "unknown";
export type LineSpacingRule = "single" | "onePointFive" | "double" | "multiple" | "exactly" | "atLeast" | "unknown";

export interface RawSelectionStyleSnapshot {
  target: "cursorParagraph" | "selection";
  selectionCollapsed: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  paragraphs: RawParagraphStyleSnapshot[];
}

export interface RawParagraphStyleSnapshot {
  paragraphIndex: number;
  paragraphText: string;
  rangeStart: number | null;
  rangeEnd: number | null;
  style: RawStyleInfo;
  font: RawFontInfo;
  paragraph: RawParagraphInfo;
  numbering: RawNumberingInfo;
}

export interface RawStyleInfo {
  name: string | null;
  nameLocal: string | null;
  type: number | null;
  basedOn: string | null | "unknown";
}

export interface RawFontInfo {
  eastAsia: string | null;
  ascii: string | null;
  hAnsi: string | null;
  cs: string | null;
  sizePt: number | null;
  bold: number | boolean | null;
  italic: number | boolean | null;
  color: number | string | null;
  underline: number | boolean | null;
  strikeThrough: number | boolean | null;
  doubleStrikeThrough: number | boolean | null;
}

export interface RawParagraphInfo {
  lineSpacingRule: number | null;
  lineSpacing: number | null;
  beforePt: number | null;
  before: LengthValue | null;
  afterPt: number | null;
  after: LengthValue | null;
  leftIndent: number | null;
  leftIndentValue: LengthValue | null;
  leftIndentChars: number | null;
  rightIndent: number | null;
  rightIndentValue: LengthValue | null;
  rightIndentChars: number | null;
  firstLineIndent: number | null;
  firstLineIndentValue: LengthValue | null;
  firstLineIndentChars: number | null;
  hangingIndentValue: LengthValue | null;
  alignment: number | null;
  snapToGrid: number | boolean | null;
}

export interface RawNumberingInfo {
  listType: number | null;
  listValue: number | null;
  level: number | null;
  listString: string | null;
  levelText: string | null;
  align: number | null;
  numberPosition: number | null;
  textPosition: number | null;
  tabPosition: number | null;
  trailingCharacter: number | null;
  linkedStyle: string | null;
}

export interface StyleBasicInfo {
  name: string | null;
  type: StyleType;
  basedOn: string | null | "unknown";
}

export interface FontStyleInfo {
  eastAsia: string | null | "unknown";
  ascii: string | null | "unknown";
  hAnsi: string | null | "unknown";
  cs: string | null | "unknown";
  sizePt: number | null;
  sizeName: string | null;
  bold: boolean | null;
  italic: boolean | null;
  color: string | null | "unknown";
  underline: boolean | null;
  strikeThrough: boolean | null;
  doubleStrikeThrough: boolean | null;
}

export interface ParagraphStyleInfo {
  lineSpacing: number | null;
  lineSpacingRule: LineSpacingRule;
  lineSpacingPt: number | null;
  beforePt: number | null;
  before: LengthValue | null;
  afterPt: number | null;
  after: LengthValue | null;
  leftIndent: number | null;
  leftIndentValue: LengthValue | null;
  leftIndentChars: number | null;
  rightIndent: number | null;
  rightIndentValue: LengthValue | null;
  rightIndentChars: number | null;
  firstLineIndent: number | null;
  firstLineIndentValue: LengthValue | null;
  firstLineIndentChars: number | null;
  hangingIndent: number | null;
  hangingIndentValue: LengthValue | null;
  alignment: ParagraphAlignment;
  snapToGrid: boolean | null;
}

export interface NumberingStyleInfo {
  enabled: boolean;
  level: number | null;
  levelText: string | null;
  displayFormat: string | null;
  align: NumberingAlignment;
  leftIndent: number | null;
  textIndent: number | null;
  tabPosition: number | null;
  hanging: number | null;
  suffix: NumberingSuffix | null;
  linkedStyle: string | null;
}

export interface ParagraphStyleDescription {
  paragraphIndex: number;
  paragraphText: string;
  style: StyleBasicInfo;
  font: FontStyleInfo;
  paragraph: ParagraphStyleInfo;
  numbering: NumberingStyleInfo;
  naturalLanguage: string;
}

export interface SelectionStyleStructuredResult {
  target: StyleInspectTarget;
  selectionCollapsed: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  paragraphCount: number;
  style: StyleBasicInfo | null;
  font: FontStyleInfo | null;
  paragraph: ParagraphStyleInfo | null;
  numbering: NumberingStyleInfo | null;
  paragraphs: ParagraphStyleDescription[];
}

export interface ParagraphStyleGroup {
  signature: string;
  paragraphIndexes: number[];
  style: ParagraphStyleDescription;
}

export interface StyleDifferenceItem {
  key: string;
  label: string;
  values: Array<{ paragraphIndex: number; value: string }>;
}

export interface StyleComparisonResult {
  styleConsistent: boolean;
  groups: ParagraphStyleGroup[];
  differences: StyleDifferenceItem[];
  differenceKeys: string[];
  differenceLabels: string[];
}

export interface SelectionStyleDescriptionResult extends SelectionStyleStructuredResult, StyleComparisonResult {
  summary: string;
  naturalLanguage: string;
}
