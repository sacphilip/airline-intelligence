export const $ = (id) => document.getElementById(id);

// Show `html` in a message box (hidden when empty); errors get the error style.
export function showMessage(el, html, isError = false) {
  el.hidden = !html;
  el.className = `d-msg${isError ? " error" : ""}`;
  el.innerHTML = html;
}

export const storage = {
  get(key, fallback = null) {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch {}
  }
};

// fetch() + JSON, returning { ok, status, data } instead of throwing on HTTP errors.
export async function getJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const KEY_HELP = `Restart the server with <code>$env:AERODATABOX_KEY = "your-key"; npm start</code>. ` +
  `Get a free key at <a href="https://rapidapi.com/aedbx-aedbx/api/aerodatabox" target="_blank" rel="noopener">rapidapi.com/aedbx-aedbx/api/aerodatabox</a>.`;
