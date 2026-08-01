/* ==========================================================================
   storage/files.js
   --------------------------------------------------------------------------
   Opening and saving .md files on disk, plus a local draft for crash
   recovery.

   Two paths exist because browser support is uneven:

     - File System Access API (Chrome, Edge): a real file handle, so "save"
       writes straight back to the file that was opened. This is the path
       that makes editing the existing archive practical.
     - Everywhere else: open via <input type=file>, save via download. The
       file lands in the downloads folder and has to be moved by hand.

   The session snapshot in localStorage is a safety net, never the source of
   truth. The file on disk is the source of truth.
   ========================================================================== */

const SESSION_KEY = 'asb-studio:session';
export const canWriteInPlace = typeof window.showOpenFilePicker === 'function';

/* --------------------------------------------------------------------------
   Opening
   -------------------------------------------------------------------------- */

/**
 * Opens a file through the native picker.
 * @returns {Promise<{name: string, text: string, handle: any}|null>}
 */
export async function openFile() {
  if (canWriteInPlace) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
      multiple: false,
    });
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,text/markdown';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      resolve(file ? { name: file.name, text: await file.text(), handle: null } : null);
    });
    input.click();
  });
}

/** Reads a File object that arrived by drag and drop. */
export async function readDroppedFile(file) {
  return { name: file.name, text: await file.text(), handle: null };
}

/* --------------------------------------------------------------------------
   Saving
   -------------------------------------------------------------------------- */

/**
 * Writes back to an open handle.
 * @returns {Promise<boolean>} false when there is no handle to write to
 */
export async function saveToHandle(handle, text) {
  if (!handle) return false;
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

/**
 * Asks for a location and writes there, returning the new handle.
 * Falls back to a plain download when the API is unavailable.
 */
export async function saveAs(text, suggestedName) {
  if (canWriteInPlace) {
    const handle = await window.showSaveFilePicker({
      suggestedName,
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
    });
    await saveToHandle(handle, text);
    return handle;
  }
  download(text, suggestedName);
  return null;
}

/** Last resort: hand the file to the browser's download manager. */
export function download(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------------------------------------------------------
   Session snapshot
   With tabs, one draft is not enough - a crash must not cost the four other
   documents that were open. The whole set is stored, and anything with
   unsaved work is offered back.
   -------------------------------------------------------------------------- */

export function saveSession(snapshot) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), tabs: snapshot }));
    return true;
  } catch {
    // Quota exceeded. The files on disk are still authoritative, so this is
    // not worth interrupting the author over.
    return false;
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* nothing to do */ }
}
