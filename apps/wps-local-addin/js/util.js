function getUrlBase() {
  let text = document.location.toString();
  text = decodeURI(text);
  if (text.indexOf("/") !== -1) {
    text = text.substring(0, text.lastIndexOf("/"));
  }
  return text;
}

function normalizePanelUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) return "http://127.0.0.1:5173" + value;
  return "http://" + value;
}
