export async function getSelectionText(app: any): Promise<string> {
  const selection = await app.ActiveDocument.ActiveWindow.Selection;
  const range = await selection.Range;
  return String((await range.Text) || "");
}

export async function replaceSelection(app: any, text: string): Promise<void> {
  const selection = await app.ActiveDocument.ActiveWindow.Selection;
  const range = await selection.Range;
  range.Text = text;
}

export async function insertAfterSelection(app: any, text: string): Promise<void> {
  const selection = await app.ActiveDocument.ActiveWindow.Selection;
  const range = await selection.Range;
  await range.InsertAfter(text);
}
