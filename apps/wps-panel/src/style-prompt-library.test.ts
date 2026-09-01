import assert from "node:assert/strict";
import { BUILTIN_STYLE_PROMPT_TEMPLATES, loadStylePromptTemplateLibrary } from "./style-prompt-library";

const emptyLibrary = loadStylePromptTemplateLibrary(null);
assert.equal(emptyLibrary.length, BUILTIN_STYLE_PROMPT_TEMPLATES.length);
assert.deepEqual(
  new Set(emptyLibrary.map((item) => item.id)),
  new Set(BUILTIN_STYLE_PROMPT_TEMPLATES.map((item) => item.id))
);

const libraryWithCustomTemplate = loadStylePromptTemplateLibrary(
  JSON.stringify([
    {
      id: "custom-meeting",
      name: "会议纪要",
      prompt: "一级标题：黑体，三号。正文：宋体，小四号。",
      createdAt: 10,
      updatedAt: 20,
    },
  ])
);
assert.equal(libraryWithCustomTemplate.length, BUILTIN_STYLE_PROMPT_TEMPLATES.length + 1);
assert.equal(libraryWithCustomTemplate.at(-1)?.id, "custom-meeting");

const malformedLibrary = loadStylePromptTemplateLibrary("{");
assert.deepEqual(malformedLibrary, emptyLibrary);

const overriddenBuiltin = loadStylePromptTemplateLibrary(
  JSON.stringify([{ ...BUILTIN_STYLE_PROMPT_TEMPLATES[0], name: "错误覆盖" }])
);
assert.deepEqual(overriddenBuiltin, emptyLibrary);

console.log("style-prompt-library tests passed");
