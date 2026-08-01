/* ==========================================================================
   storage/archive.js
   --------------------------------------------------------------------------
   Reading the whole archive folder at once.

   Opening files one at a time is fine for a dozen. For a few hundred it is
   not: there is no way to see which ones still carry the old studio's HTML,
   which are missing paragraph ids, or which would break on the site - short
   of opening every single one.

   The browser can be given a folder handle, once, and then read everything
   under it. That permission is granted by the author through the native
   picker and lasts for the session; nothing is scanned without it.

   Writing back is deliberately separate from reading, and every write is
   reported. A tool that can rewrite two hundred files must never do it
   quietly.
   ========================================================================== */

export const canBrowseFolders = typeof window.showDirectoryPicker === 'function';

/**
 * Asks for a folder and returns its handle.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function pickFolder() {
  if (!canBrowseFolders) return null;
  return window.showDirectoryPicker({ mode: 'readwrite' });
}

/**
 * Walks a folder and returns every Markdown file under it.
 *
 * @param {FileSystemDirectoryHandle} root
 * @param {(count:number)=>void} onProgress
 * @returns {Promise<Array<{path, name, handle, text}>>}
 */
export async function scanMarkdown(root, onProgress) {
  const found = [];

  async function walk(dir, prefix) {
    for await (const entry of dir.values()) {
      // Anything starting with a dot is machinery, not manuscript.
      if (entry.name.startsWith('.')) continue;

      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.kind === 'directory') {
        await walk(entry, path);
        continue;
      }
      if (!/\.(md|markdown)$/i.test(entry.name)) continue;

      const file = await entry.getFile();
      found.push({ path, name: entry.name, handle: entry, text: await file.text() });
      if (onProgress) onProgress(found.length);
    }
  }

  await walk(root, '');
  return found.sort((a, b) => a.path.localeCompare(b.path, 'fa'));
}

/** Writes text back to a file that came out of scanMarkdown. */
export async function writeFile(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

/** Groups scanned files by their containing folder, for display. */
export function groupByFolder(files) {
  const groups = new Map();

  for (const file of files) {
    const cut = file.path.lastIndexOf('/');
    const folder = cut === -1 ? '' : file.path.slice(0, cut);
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push(file);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'fa'))
    .map(([folder, items]) => ({ folder, items }));
}
