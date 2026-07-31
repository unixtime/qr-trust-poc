export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function buildAbsoluteLink(path: string): string {
  if (typeof window === "undefined") {
    return path
  }

  return `${window.location.origin}${path}`
}

export function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" })
  const objectUrl = window.URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(objectUrl)
}
