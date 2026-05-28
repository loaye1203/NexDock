const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, Menu } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const DEFAULT_CATEGORIES = [
  { id: 'all', name: '全部', type: 'system', icon: 'N' },
];

const LEGACY_SYSTEM_CATEGORY_IDS = new Set(['frequent', 'apps', 'files', 'folders', 'uncategorized']);

let dataFilePath;

function categoryIconForName(name) {
  const cleanName = typeof name === 'string' ? name.trim() : '';
  return cleanName ? cleanName.slice(0, 2).toUpperCase() : 'D';
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 720,
    minHeight: 460,
    resizable: true,
    frame: false,
    transparent: false,
    backgroundColor: '#0d0e0f',
    thickFrame: true,
    titleBarStyle: 'hidden',
    title: 'NexDock',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
}

function senderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function createEmptyStore() {
  return {
    categories: DEFAULT_CATEGORIES,
    items: [],
  };
}

function normalizeCategories(categories) {
  const customCategories = Array.isArray(categories)
    ? categories
        .filter((category) => {
          return (
            category
            && typeof category.id === 'string'
            && category.id !== 'all'
            && !LEGACY_SYSTEM_CATEGORY_IDS.has(category.id)
            && typeof category.name === 'string'
            && category.name.trim()
          );
        })
        .map((category) => ({
          id: category.id,
          name: category.name.trim(),
          type: 'custom',
          pinned: category.pinned === true,
          icon: typeof category.icon === 'string' && category.icon.trim()
            ? category.icon.trim().slice(0, 4)
            : categoryIconForName(category.name),
        }))
    : [];

  return [...DEFAULT_CATEGORIES.map((category) => ({ ...category })), ...customCategories];
}

function normalizeTags(tags) {
  return Array.isArray(tags)
    ? tags
        .filter((tag) => typeof tag === 'string' && tag.trim())
        .map((tag) => tag.trim())
        .slice(0, 12)
    : [];
}

function normalizeItemCategoryIds(item) {
  const categoryIds = [];

  if (Array.isArray(item?.categoryIds)) {
    categoryIds.push(...item.categoryIds);
  }

  if (typeof item?.categoryId === 'string') {
    categoryIds.push(item.categoryId);
  }

  return [...new Set(
    categoryIds
      .filter((categoryId) => typeof categoryId === 'string' && categoryId && categoryId !== 'all'),
  )];
}

function itemBelongsToCategory(item, categoryId) {
  return categoryId === 'all' || normalizeItemCategoryIds(item).includes(categoryId);
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items
        .filter((item) => {
          return (
            item
            && typeof item.id === 'string'
            && typeof item.name === 'string'
            && typeof item.path === 'string'
          );
        })
        .map((item, index) => {
          const { categoryId, categoryIds, ...normalizedItem } = item;

          return {
            ...normalizedItem,
            name: item.name.trim(),
            tags: normalizeTags(item.tags),
            categoryIds: normalizeItemCategoryIds(item),
            order: Number.isFinite(item.order) ? item.order : index,
          };
        })
    : [];
}

function normalizeStore(store) {
  return {
    categories: normalizeCategories(store?.categories),
    items: normalizeItems(store?.items),
  };
}

async function ensureStore() {
  dataFilePath = path.join(app.getPath('userData'), 'launcher-items.json');

  try {
    await fs.access(dataFilePath);
  } catch {
    await fs.mkdir(path.dirname(dataFilePath), { recursive: true });
    await fs.writeFile(dataFilePath, JSON.stringify(createEmptyStore(), null, 2), 'utf8');
  }
}

async function readStore() {
  await ensureStore();

  try {
    const raw = await fs.readFile(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    const store = normalizeStore(parsed);
    const migratedStore = await migrateShortcutEntries(store);

    if (migratedStore.changed) {
      await writeStore(migratedStore.store);
    }

    return migratedStore.store;
  } catch {
    return createEmptyStore();
  }
}

async function writeStore(store) {
  await ensureStore();
  await fs.writeFile(dataFilePath, JSON.stringify(store, null, 2), 'utf8');
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePath(inputPath) {
  return path.normalize(inputPath);
}

function storePathKey(inputPath) {
  return isUrlTarget(inputPath)
    ? inputPath.trim().toLowerCase()
    : normalizePath(inputPath).toLowerCase();
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectEntryType(targetPath) {
  const stat = await fs.stat(targetPath);

  if (stat.isDirectory()) {
    return 'folder';
  }

  const ext = path.extname(targetPath).toLowerCase();

  if (ext === '.exe') {
    return 'app';
  }

  if (ext === '.lnk' || ext === '.url') {
    return 'shortcut';
  }

  return 'file';
}

function displayNameForPath(targetPath) {
  const parsed = path.parse(targetPath);
  return parsed.name || parsed.base || targetPath;
}

const RASTER_ICON_EXTENSIONS = new Set(['.ico', '.png', '.jpg', '.jpeg', '.webp']);
const WINDOWS_ICON_RESOURCE_EXTENSIONS = new Set(['.exe', '.dll']);

function expandWindowsEnvVars(value) {
  return value.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
}

function stripIconResourceIndex(iconPath) {
  return iconPath.replace(/,\s*-?\d+\s*$/, '');
}

function normalizeShortcutIconPath(iconPath, shortcutPath) {
  if (!iconPath || typeof iconPath !== 'string') {
    return null;
  }

  const cleanPath = stripIconResourceIndex(expandWindowsEnvVars(iconPath.trim().replace(/^"|"$/g, '')));

  if (!cleanPath) {
    return null;
  }

  return path.isAbsolute(cleanPath)
    ? path.normalize(cleanPath)
    : path.normalize(path.join(path.dirname(shortcutPath), cleanPath));
}

function isUrlTarget(value) {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) && !/^[a-zA-Z]:[\\/]/.test(value);
}

function normalizeShortcutTargetPath(targetPath, shortcutPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return null;
  }

  const cleanPath = expandWindowsEnvVars(targetPath.trim().replace(/^"|"$/g, ''));

  if (!cleanPath) {
    return null;
  }

  if (isUrlTarget(cleanPath)) {
    return cleanPath;
  }

  return path.isAbsolute(cleanPath)
    ? path.normalize(cleanPath)
    : path.normalize(path.join(path.dirname(shortcutPath), cleanPath));
}

function decodeShortcutText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le');
  }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.toString('utf8');
  }

  return buffer.toString('utf8');
}

function readShortcutDetails(targetPath) {
  if (process.platform !== 'win32' || path.extname(targetPath).toLowerCase() !== '.lnk') {
    return null;
  }

  try {
    return shell.readShortcutLink(targetPath);
  } catch {
    return null;
  }
}

async function readUrlShortcutDetails(targetPath) {
  if (path.extname(targetPath).toLowerCase() !== '.url') {
    return null;
  }

  try {
    const text = decodeShortcutText(await fs.readFile(targetPath));
    const details = {};

    for (const line of text.split(/\r?\n/)) {
      const separatorIndex = line.indexOf('=');

      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim().toLowerCase();
      const value = line.slice(separatorIndex + 1).trim();

      if (key === 'iconfile') {
        details.icon = value;
      } else if (key === 'url') {
        details.target = value;
      }
    }

    return details.icon || details.target ? details : null;
  } catch {
    return null;
  }
}

async function resolveShortcutLaunchTarget(targetPath, type) {
  if (type !== 'shortcut') {
    return null;
  }

  const shortcutDetails = readShortcutDetails(targetPath);

  if (shortcutDetails?.target) {
    const launchPath = normalizeShortcutTargetPath(shortcutDetails.target, targetPath);

    if (launchPath) {
      return {
        path: launchPath,
        args: typeof shortcutDetails.args === 'string' && shortcutDetails.args.trim()
          ? shortcutDetails.args.trim()
          : null,
        sourcePath: targetPath,
      };
    }
  }

  const urlShortcutDetails = await readUrlShortcutDetails(targetPath);

  if (urlShortcutDetails?.target) {
    const launchPath = normalizeShortcutTargetPath(urlShortcutDetails.target, targetPath);

    if (launchPath) {
      return {
        path: launchPath,
        args: null,
        sourcePath: targetPath,
      };
    }
  }

  return null;
}

async function detectStoredEntryType(targetPath, fallbackType = 'file') {
  if (isUrlTarget(targetPath)) {
    return 'shortcut';
  }

  try {
    return await detectEntryType(targetPath);
  } catch {
    return fallbackType;
  }
}

async function readNativeImageDataUrl(targetPath) {
  try {
    const image = nativeImage.createFromPath(targetPath);
    return image.isEmpty() ? null : image.toDataURL();
  } catch {
    return null;
  }
}

async function readSystemIconDataUrl(targetPath) {
  try {
    const icon = await app.getFileIcon(targetPath, { size: 'normal' });
    return icon.isEmpty() ? null : icon.toDataURL();
  } catch {
    return null;
  }
}

async function readWindowsAssociatedIconDataUrl(targetPath) {
  if (process.platform !== 'win32' || !WINDOWS_ICON_RESOURCE_EXTENSIONS.has(path.extname(targetPath).toLowerCase())) {
    return null;
  }

  const script = `
$targetPath = $env:NEXDOCK_ICON_TARGET
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class NexDockIconNative {
  [DllImport("User32.dll", CharSet = CharSet.Unicode)]
  public static extern int PrivateExtractIcons(string lpszFile, int nIconIndex, int cxIcon, int cyIcon, IntPtr[] phicon, int[] piconid, int nIcons, int flags);

  [DllImport("User32.dll", SetLastError = true)]
  public static extern bool DestroyIcon(IntPtr hIcon);
}
'@

function Write-IconPngBase64($icon) {
  if ($null -eq $icon) { return $false }

  $bitmap = $icon.ToBitmap()
  $stream = New-Object System.IO.MemoryStream
  try {
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
    return $true
  } finally {
    $stream.Dispose()
    $bitmap.Dispose()
    $icon.Dispose()
  }
}

$handles = New-Object IntPtr[] 1
$ids = New-Object int[] 1
$count = [NexDockIconNative]::PrivateExtractIcons($targetPath, 0, 128, 128, $handles, $ids, 1, 0)

if ($count -gt 0 -and $handles[0] -ne [IntPtr]::Zero) {
  try {
    if (Write-IconPngBase64 ([System.Drawing.Icon]::FromHandle($handles[0]))) { exit 0 }
  } finally {
    [NexDockIconNative]::DestroyIcon($handles[0]) | Out-Null
  }
}

if (Write-IconPngBase64 ([System.Drawing.Icon]::ExtractAssociatedIcon($targetPath))) { exit 0 }
exit 2
`;

  try {
    const { stdout } = await execFileAsync(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: {
          NEXDOCK_ICON_TARGET: targetPath,
          PATH: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32;C:\\Windows',
          SystemRoot: 'C:\\Windows',
          WINDIR: 'C:\\Windows',
        },
        maxBuffer: 1024 * 1024,
        timeout: 5000,
        windowsHide: true,
      },
    );
    const base64 = stdout.trim();

    return base64 ? `data:image/png;base64,${base64}` : null;
  } catch {
    return null;
  }
}

async function readCandidateIconDataUrl(targetPath) {
  const ext = path.extname(targetPath).toLowerCase();

  if (RASTER_ICON_EXTENSIONS.has(ext)) {
    return (await readNativeImageDataUrl(targetPath)) || (await readSystemIconDataUrl(targetPath));
  }

  if (WINDOWS_ICON_RESOURCE_EXTENSIONS.has(ext)) {
    return (
      (await readWindowsAssociatedIconDataUrl(targetPath))
      || (await readSystemIconDataUrl(targetPath))
      || (await readNativeImageDataUrl(targetPath))
    );
  }

  return (await readSystemIconDataUrl(targetPath)) || (await readNativeImageDataUrl(targetPath));
}

async function readIconDataUrl(targetPath, type) {
  const shortcutDetails = type === 'shortcut' ? readShortcutDetails(targetPath) : null;
  const urlShortcutDetails = await readUrlShortcutDetails(targetPath);
  const candidates = [];

  if (shortcutDetails) {
    const shortcutIconPath = normalizeShortcutIconPath(shortcutDetails.icon, targetPath);

    if (shortcutIconPath) {
      candidates.push(shortcutIconPath);
    }

    if (shortcutDetails.target) {
      candidates.push(normalizePath(expandWindowsEnvVars(shortcutDetails.target)));
    }
  }

  if (urlShortcutDetails) {
    const urlShortcutIconPath = normalizeShortcutIconPath(urlShortcutDetails.icon, targetPath);

    if (urlShortcutIconPath) {
      candidates.push(urlShortcutIconPath);
    }
  }

  candidates.push(targetPath);

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const iconDataUrl = await readCandidateIconDataUrl(candidate);

    if (iconDataUrl) {
      return iconDataUrl;
    }
  }

  return null;
}

async function readStoredItemIconDataUrl(item) {
  const sourcePath = typeof item.sourcePath === 'string' && item.sourcePath ? item.sourcePath : null;
  const launchPath = typeof item.path === 'string' && item.path ? item.path : null;
  const candidates = [];

  if (sourcePath && await pathExists(sourcePath)) {
    candidates.push(sourcePath);
  }

  if (launchPath && !isUrlTarget(launchPath)) {
    candidates.push(launchPath);
  }

  for (const candidate of [...new Set(candidates)]) {
    const type = await detectStoredEntryType(candidate, item.type);
    const iconDataUrl = await readIconDataUrl(candidate, type);

    if (iconDataUrl) {
      return iconDataUrl;
    }
  }

  return item.iconDataUrl || null;
}

function splitLaunchArgs(args) {
  const parts = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (/\s/.test(char) && !inQuotes) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

async function openStoredItem(item) {
  if (isUrlTarget(item.path)) {
    try {
      await shell.openExternal(item.path);
      return '';
    } catch (error) {
      return error.message;
    }
  }

  if (typeof item.launchArgs === 'string' && item.launchArgs.trim()) {
    return new Promise((resolve) => {
      let settled = false;
      const child = execFile(
        item.path,
        splitLaunchArgs(item.launchArgs.trim()),
        {
          detached: true,
          windowsHide: false,
        },
      );

      child.once('spawn', () => {
        settled = true;
        child.unref();
        resolve('');
      });

      child.once('error', (error) => {
        if (!settled) {
          settled = true;
          resolve(error.message);
        }
      });
    });
  }

  return shell.openPath(item.path);
}

async function createEntry(targetPath, preferredCategoryId) {
  const normalizedPath = normalizePath(targetPath);

  if (!(await pathExists(normalizedPath))) {
    throw new Error(`路径不存在: ${normalizedPath}`);
  }

  const type = await detectEntryType(normalizedPath);
  const shortcutLaunchTarget = await resolveShortcutLaunchTarget(normalizedPath, type);
  const launchPath = shortcutLaunchTarget?.path || normalizedPath;
  const launchType = await detectStoredEntryType(launchPath, type);

  return {
    id: makeId(),
    name: displayNameForPath(normalizedPath),
    type: launchType,
    path: launchPath,
    sourcePath: shortcutLaunchTarget?.sourcePath || null,
    launchArgs: shortcutLaunchTarget?.args || null,
    iconDataUrl: await readIconDataUrl(normalizedPath, type),
    categoryIds: preferredCategoryId ? [preferredCategoryId] : [],
    tags: [],
    order: 0,
    createdAt: new Date().toISOString(),
    lastOpenedAt: null,
  };
}

async function migrateShortcutEntries(store) {
  let changed = false;

  for (const item of store.items) {
    const itemPath = typeof item.path === 'string' ? item.path : '';
    const itemExt = path.extname(itemPath).toLowerCase();
    const needsMigration = (item.type === 'shortcut' || itemExt === '.lnk' || itemExt === '.url')
      && !item.sourcePath
      && !item.launchArgs
      && (itemExt === '.lnk' || itemExt === '.url');

    if (!needsMigration || !(await pathExists(itemPath))) {
      continue;
    }

    const shortcutLaunchTarget = await resolveShortcutLaunchTarget(itemPath, 'shortcut');

    if (!shortcutLaunchTarget?.path) {
      continue;
    }

    item.sourcePath = itemPath;
    item.path = shortcutLaunchTarget.path;
    item.launchArgs = shortcutLaunchTarget.args || null;
    item.type = await detectStoredEntryType(item.path, item.type);
    item.iconDataUrl = item.iconDataUrl || await readStoredItemIconDataUrl(item);
    changed = true;
  }

  return { store, changed };
}

function publicStore(store) {
  const normalizedStore = normalizeStore(store);

  return {
    categories: normalizedStore.categories,
    items: normalizedStore.items,
  };
}

app.whenReady().then(() => {
  app.setName('NexDock');
  Menu.setApplicationMenu(null);

  ipcMain.handle('app:get-version-info', () => ({
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  }));

  ipcMain.handle('window:minimize', (event) => {
    senderWindow(event)?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const win = senderWindow(event);

    if (!win) {
      return false;
    }

    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }

    win.maximize();
    return true;
  });

  ipcMain.handle('window:close', (event) => {
    senderWindow(event)?.close();
  });

  ipcMain.handle('launcher:list', async () => {
    const store = await readStore();
    return publicStore(store);
  });

  ipcMain.handle('launcher:add-paths', async (event, payload = {}) => {
    const paths = Array.isArray(payload.paths) ? payload.paths : [];
    const store = await readStore();
    const categoryId = store.categories.some((category) => category.id === payload.categoryId && category.type !== 'system')
      ? payload.categoryId
      : undefined;
    const existing = new Set();

    for (const item of store.items) {
      if (typeof item.path === 'string' && item.path) {
        existing.add(storePathKey(item.path));
      }

      if (typeof item.sourcePath === 'string' && item.sourcePath) {
        existing.add(storePathKey(item.sourcePath));
      }
    }

    const added = [];
    const skipped = [];

    for (const targetPath of paths) {
      try {
        const normalizedPath = normalizePath(targetPath);
        const duplicateKey = storePathKey(normalizedPath);

        if (existing.has(duplicateKey)) {
          skipped.push({ path: normalizedPath, reason: 'duplicate' });
          continue;
        }

        const entry = await createEntry(normalizedPath, categoryId);
        const entryKeys = [
          entry.path,
          entry.sourcePath,
        ].filter((value) => typeof value === 'string' && value).map(storePathKey);

        if (entryKeys.some((key) => existing.has(key))) {
          skipped.push({ path: normalizedPath, reason: 'duplicate' });
          continue;
        }

        entry.order = store.items.length;
        store.items.push(entry);
        entryKeys.forEach((key) => existing.add(key));
        added.push(entry);
      } catch (error) {
        skipped.push({ path: targetPath, reason: error.message });
      }
    }

    await writeStore(store);
    return { store: publicStore(store), added, skipped };
  });

  ipcMain.handle('launcher:add-category', async (event, payload = {}) => {
    const store = await readStore();
    const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim()
      : '新分类';
    const icon = typeof payload.icon === 'string' && payload.icon.trim()
      ? payload.icon.trim().slice(0, 4)
      : categoryIconForName(name);
    const category = {
      id: `category-${makeId()}`,
      name,
      icon,
      type: 'custom',
      pinned: false,
    };

    store.categories.push(category);
    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:rename-category', async (event, payload = {}) => {
    const store = await readStore();
    const category = store.categories.find((entry) => entry.id === payload.id && entry.type !== 'system');
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const icon = typeof payload.icon === 'string' && payload.icon.trim()
      ? payload.icon.trim().slice(0, 4)
      : categoryIconForName(name);

    if (!category) {
      throw new Error('分类不存在');
    }

    if (!name) {
      throw new Error('分类名称不能为空');
    }

    category.name = name;
    category.icon = icon;
    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:remove-category', async (event, id) => {
    const store = await readStore();
    const category = store.categories.find((entry) => entry.id === id && entry.type !== 'system');

    if (!category) {
      throw new Error('分类不存在');
    }

    store.categories = store.categories.filter((entry) => entry.id !== id);
    store.items.forEach((item) => {
      item.categoryIds = normalizeItemCategoryIds(item).filter((categoryId) => categoryId !== id);
    });

    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:set-category-pinned', async (event, payload = {}) => {
    const store = await readStore();
    const category = store.categories.find((entry) => entry.id === payload.id && entry.type !== 'system');

    if (!category) {
      throw new Error('分类不存在');
    }

    category.pinned = payload.pinned === true;

    if (category.pinned) {
      const customCategories = store.categories.filter((entry) => entry.type !== 'system');
      store.categories = [
        ...DEFAULT_CATEGORIES,
        category,
        ...customCategories.filter((entry) => entry.id !== category.id),
      ];
    }

    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:sort-categories', async (event, orderedCategoryIds = []) => {
    const store = await readStore();
    const customCategories = store.categories.filter((category) => category.type !== 'system');
    const byId = new Map(customCategories.map((category) => [category.id, category]));
    const sorted = [];

    for (const id of orderedCategoryIds) {
      if (byId.has(id)) {
        sorted.push(byId.get(id));
        byId.delete(id);
      }
    }

    store.categories = [...DEFAULT_CATEGORIES, ...sorted, ...byId.values()];
    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:update-item', async (event, payload = {}) => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === payload.id);

    if (!item) {
      throw new Error('入口不存在');
    }

    if (typeof payload.name === 'string' && payload.name.trim()) {
      item.name = payload.name.trim();
    }

    if (typeof payload.categoryId === 'string' && payload.categoryId && payload.categoryId !== 'all') {
      const nextCategoryId = payload.categoryId;
      const categoryExists = store.categories.some((category) => {
        return category.id === nextCategoryId && category.type !== 'system';
      });
      const currentCategoryIds = normalizeItemCategoryIds(item);
      const categoryChanged = categoryExists && !currentCategoryIds.includes(nextCategoryId);

      if (categoryChanged) {
        item.categoryIds = [...currentCategoryIds, nextCategoryId];
      } else {
        item.categoryIds = currentCategoryIds;
      }
    }

    if (Array.isArray(payload.tags)) {
      item.tags = normalizeTags(payload.tags);
    }

    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:sort-items', async (event, payload = {}) => {
    const store = await readStore();
    const orderedItemIds = Array.isArray(payload.orderedItemIds) ? payload.orderedItemIds : [];
    const orderedIdSet = new Set(orderedItemIds);
    const categoryId = typeof payload.categoryId === 'string' && payload.categoryId ? payload.categoryId : 'all';
    const scopedItems = store.items
      .filter((item) => itemBelongsToCategory(item, categoryId))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'));
    const byId = new Map(scopedItems.map((item) => [item.id, item]));
    const sorted = [];

    for (const id of orderedItemIds) {
      if (byId.has(id)) {
        sorted.push(byId.get(id));
        byId.delete(id);
      }
    }

    sorted.push(...scopedItems.filter((item) => !orderedIdSet.has(item.id)));
    sorted.forEach((item, index) => {
      item.order = index;
    });

    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:remove-item', async (event, id) => {
    const store = await readStore();
    store.items = store.items.filter((entry) => entry.id !== id);
    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:open-item', async (event, id) => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);

    if (!item) {
      throw new Error('入口不存在');
    }

    const result = await openStoredItem(item);

    if (result) {
      throw new Error(result);
    }

    item.lastOpenedAt = new Date().toISOString();
    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('launcher:reveal-item', async (event, id) => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);

    if (!item) {
      throw new Error('入口不存在');
    }

    const revealPath = typeof item.path === 'string' && item.path && !isUrlTarget(item.path)
      ? item.path
      : item.sourcePath;

    if (!revealPath || !(await pathExists(revealPath))) {
      throw new Error('鎵€鍦ㄤ綅缃笉瀛樺湪');
    }

    shell.showItemInFolder(revealPath);
    return true;
  });

  ipcMain.handle('launcher:sync-icon', async (event, id) => {
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);

    if (!item) {
      throw new Error('入口不存在');
    }

    item.type = await detectStoredEntryType(item.path, item.type);
    item.iconDataUrl = await readStoredItemIconDataUrl(item);
    await writeStore(store);
    return publicStore(store);
  });

  ipcMain.handle('dialog:pick-files', async () => {
    const result = await dialog.showOpenDialog({
      title: '添加软件、文件或快捷方式',
      properties: ['openFile', 'multiSelections'],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      title: '添加文件夹',
      properties: ['openDirectory', 'multiSelections'],
    });

    return result.canceled ? [] : result.filePaths;
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
