// Copy to the clipboard, with the old way as a fallback.
//
// navigator.clipboard needs a secure context and a permission the browser can
// refuse; execCommand("copy") needs neither and still works everywhere that
// matters. Returns whether anything landed, so the caller can say so (or hand
// the text over to be copied by hand).
export async function copyText(text) {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    /* no permission, or not a secure context — try the old way */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
