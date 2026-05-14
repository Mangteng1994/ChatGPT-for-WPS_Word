import {
  parseNaturalLanguageStyleInput,
  type HeadingLevel,
  type NumberingSuffix,
  type ParsedHeadingStyleBlock,
} from "./style-nl-parser";

export interface StructuredStyleSet {
  styles: StructuredHeadingStyle[];
}

export interface StructuredHeadingStyle {
  name: string;
  level: HeadingLevel;
  basedOn: string | null;
  font: {
    eastAsia: string;
    ascii: string;
    hAnsi: string;
    cs: string;
    sizePt: number;
    bold: boolean;
  };
  paragraph: {
    lineSpacing: number;
    beforePt: number;
    afterPt: number;
    leftIndent: number;
    rightIndent: number;
    firstLineIndent: number;
    snapToGrid: boolean;
  };
  numbering: {
    format: "decimal";
    levelText: string;
    align: "left";
    leftIndent: number;
    textIndent: number;
    hanging: number;
    suffix: NumberingSuffix;
  };
}

const DEFAULT_STYLE_NAME_BY_LEVEL: Record<HeadingLevel, string> = {
  1: "一级标题",
  2: "二级标题",
  3: "三级标题",
  4: "四级标题",
};

const DEFAULT_FONT_SIZE_BY_LEVEL: Record<HeadingLevel, number> = {
  1: 16,
  2: 15,
  3: 14,
  4: 12,
};

export function buildStructuredStyleSetFromNaturalLanguage(input: string): StructuredStyleSet {
  return convertParsedBlocksToStructuredStyleSet(parseNaturalLanguageStyleInput(input));
}

export function convertParsedBlocksToStructuredStyleSet(blocks: ParsedHeadingStyleBlock[]): StructuredStyleSet {
  if (!blocks.length) return { styles: [] };

  const byLevel = new Map<HeadingLevel, StructuredHeadingStyle>();
  for (const block of blocks) {
    byLevel.set(block.level, convertBlock(block));
  }

  return {
    styles: Array.from(byLevel.values()).sort((a, b) => a.level - b.level),
  };
}

function convertBlock(block: ParsedHeadingStyleBlock): StructuredHeadingStyle {
  const base = createDefaultStyle(block.level, block.name);
  const { tokens } = block;

  if (tokens.basedOnNone === true) {
    base.basedOn = null;
  }

  if (tokens.fontSizePt && Number.isFinite(tokens.fontSizePt)) {
    base.font.sizePt = tokens.fontSizePt;
  }

  if (tokens.bold !== null) {
    base.font.bold = tokens.bold;
  }

  if (tokens.eastAsiaFont) {
    base.font.eastAsia = tokens.eastAsiaFont;
  }

  if (tokens.asciiFont) {
    base.font.ascii = tokens.asciiFont;
    base.font.hAnsi = tokens.asciiFont;
  }

  if (tokens.complexFont) {
    base.font.cs = tokens.complexFont;
  }

  if (tokens.lineSpacing && Number.isFinite(tokens.lineSpacing)) {
    base.paragraph.lineSpacing = tokens.lineSpacing;
  }

  if (tokens.paragraphZero || tokens.beforeAfterZero) {
    base.paragraph.beforePt = 0;
    base.paragraph.afterPt = 0;
  }

  if (tokens.paragraphZero || tokens.indentZero) {
    base.paragraph.leftIndent = 0;
    base.paragraph.rightIndent = 0;
    base.paragraph.firstLineIndent = 0;
  }

  if (tokens.snapToGrid !== null) {
    base.paragraph.snapToGrid = tokens.snapToGrid;
  }

  if (tokens.paragraphZero || tokens.numberingAlignLeftZero) {
    base.numbering.leftIndent = 0;
  }

  if (tokens.paragraphZero || tokens.numberingTextIndentZero) {
    base.numbering.textIndent = 0;
    base.numbering.hanging = 0;
  }

  if (tokens.numberingSuffix) {
    base.numbering.suffix = tokens.numberingSuffix;
  } else if (tokens.numberingNoTab) {
    base.numbering.suffix = "space";
  }

  return base;
}

function createDefaultStyle(level: HeadingLevel, name: string): StructuredHeadingStyle {
  const resolvedName = String(name || "").trim() || DEFAULT_STYLE_NAME_BY_LEVEL[level];
  return {
    name: resolvedName,
    level,
    basedOn: null,
    font: {
      eastAsia: "宋体",
      ascii: "Times New Roman",
      hAnsi: "Times New Roman",
      cs: "Times New Roman",
      sizePt: DEFAULT_FONT_SIZE_BY_LEVEL[level],
      bold: true,
    },
    paragraph: {
      lineSpacing: 1.5,
      beforePt: 0,
      afterPt: 0,
      leftIndent: 0,
      rightIndent: 0,
      firstLineIndent: 0,
      snapToGrid: true,
    },
    numbering: {
      format: "decimal",
      levelText: buildNumberingLevelText(level),
      align: "left",
      leftIndent: 0,
      textIndent: 0,
      hanging: 0,
      suffix: "space",
    },
  };
}

function buildNumberingLevelText(level: HeadingLevel): string {
  return Array.from({ length: level }, (_, idx) => `%${idx + 1}`).join(".");
}
