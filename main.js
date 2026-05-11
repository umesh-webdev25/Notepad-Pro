const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RECOVERY_BYTES = 5 * 1024 * 1024;
const RECENT_LIMIT = 20;

let mainWindow = null;
let isForceClosing = false;
let trustedPaths = new Set();

function getStorePaths() {
  const base = app.getPath('userData');
  return {
    recent: path.join(base, 'recent-files.json'),
    recoveryDir: path.join(base, 'recovery')
  };
}

function normalizeExistingPath(filePath) {
  if (typeof filePath !== 'string' || filePath.includes('\0')) return null;
  return path.resolve(filePath);
}

function toPublicFile(filePath, content, stat) {
  return {
    filePath,
    name: path.basename(filePath),
    content,
    size: stat?.size ?? Buffer.byteLength(content, 'utf8'),
    mtimeMs: stat?.mtimeMs ?? Date.now()
  };
}

async function ensureStore() {
  const { recoveryDir } = getStorePaths();
  await fs.mkdir(recoveryDir, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function getRecentFiles() {
  const { recent } = getStorePaths();
  const stored = await readJson(recent, []);
  
  // Filter for valid paths and actual existence
  const existing = [];
  let changed = false;

  for (const entry of stored) {
    if (!entry || typeof entry.filePath !== 'string') {
      changed = true;
      continue;
    }
    try {
      // Using stat to verify existence and that it's a file
      const stat = await fs.stat(entry.filePath);
      if (stat.isFile()) {
        existing.push(entry);
      } else {
        changed = true;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        changed = true;
      } else {
        // Log other errors but keep the entry for safety unless we're sure
        existing.push(entry);
      }
    }
  }

  const limited = existing.slice(0, RECENT_LIMIT);
  if (changed || limited.length !== stored.length) {
    await writeJson(recent, limited);
  }

  return limited;
}

async function addRecentFile(filePath) {
  const resolved = normalizeExistingPath(filePath);
  if (!resolved) return;
  trustedPaths.add(resolved);

  const recent = await getRecentFiles();
  const updated = [
    { filePath: resolved, name: path.basename(resolved), openedAt: Date.now() },
    ...recent.filter((entry) => path.resolve(entry.filePath) !== resolved)
  ].slice(0, RECENT_LIMIT);

  await writeJson(getStorePaths().recent, updated);
}

async function removeRecentFile(filePath) {
  const resolved = normalizeExistingPath(filePath);
  if (!resolved) return;
  trustedPaths.delete(resolved);

  const recent = await getRecentFiles();
  const updated = recent.filter((entry) => path.resolve(entry.filePath) !== resolved);

  await writeJson(getStorePaths().recent, updated);
}

async function loadTrustedPaths() {
  const recent = await getRecentFiles();
  trustedPaths = new Set(recent.map((entry) => normalizeExistingPath(entry.filePath)).filter(Boolean));
}

async function readTextFile(filePath) {
  try {
    const resolved = normalizeExistingPath(filePath);
    if (!resolved) return { ok: false, error: 'Invalid file path.' };

    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return { ok: false, error: 'Only regular files can be opened.' };
    if (stat.size > MAX_FILE_BYTES) return { ok: false, error: 'File is larger than the 20 MB safety limit.' };

    const content = await fs.readFile(resolved, 'utf8');
    await addRecentFile(resolved);
    return { ok: true, file: toPublicFile(resolved, content, stat) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { ok: false, error: 'File not found on disk.', code: 'ENOENT' };
    }
    return { ok: false, error: `Unable to read file: ${error.message}` };
  }
}

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function isTrustedFilePath(filePath) {
  const resolved = normalizeExistingPath(filePath);
  return Boolean(resolved && trustedPaths.has(resolved));
}

function sanitizeRecoveryId(id) {
  if (typeof id !== 'string') return null;
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return safe || null;
}

function registerIpcHandlers() {
  ipcMain.on('window:minimize', (event) => getSenderWindow(event)?.minimize());
  ipcMain.on('window:maximize', (event) => {
    const win = getSenderWindow(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = getSenderWindow(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on('window:force-close', (event) => {
    const win = getSenderWindow(event);
    if (!win) return;
    isForceClosing = true;
    win.close();
  });

  ipcMain.handle('app:info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform
  }));

  ipcMain.handle('files:list-recent', async () => ({ ok: true, files: await getRecentFiles() }));

  ipcMain.handle('files:open-dialog', async (event) => {
    const win = getSenderWindow(event) || mainWindow;
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Open file',
      buttonLabel: 'Open',
      filters: [
        { name: 'Text and code', extensions: ['txt', 'md', 'json', 'js', 'html', 'css', 'csv', 'log', 'xml', 'yaml', 'yml'] },
        { name: 'All files', extensions: ['*'] }
      ],
      properties: ['openFile']
    });

    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    return readTextFile(filePaths[0]);
  });

  ipcMain.handle('files:clear-recent', async () => {
    trustedPaths.clear();
    await writeJson(getStorePaths().recent, []);
    return { ok: true };
  });

  ipcMain.handle('files:open-recent', async (event, filePath) => {
    const resolved = normalizeExistingPath(filePath);
    if (!resolved || !trustedPaths.has(resolved)) return { ok: false, error: 'File is not in the trusted recent-files list.' };
    const result = await readTextFile(resolved);
    if (!result.ok && result.code === 'ENOENT') {
      await removeRecentFile(resolved);
    }
    return result;
  });

  ipcMain.handle('files:save', async (event, payload) => {
    const win = getSenderWindow(event) || mainWindow;
    const content = typeof payload?.content === 'string' ? payload.content : '';
    let filePath = normalizeExistingPath(payload?.filePath);

    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
      return { ok: false, error: 'Content is larger than the 20 MB safety limit.' };
    }

    if (payload?.saveAs || !filePath) {
      const { canceled, filePath: selectedPath } = await dialog.showSaveDialog(win, {
        title: 'Save file',
        buttonLabel: 'Save',
        defaultPath: filePath || 'untitled.txt',
        filters: [
          { name: 'Text files', extensions: ['txt'] },
          { name: 'Markdown', extensions: ['md'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'All files', extensions: ['*'] }
        ]
      });
      if (canceled || !selectedPath) return { ok: false, canceled: true };
      filePath = normalizeExistingPath(selectedPath);
    } else if (!isTrustedFilePath(filePath)) {
      return { ok: false, error: 'Save blocked because the file path was not user-selected in this session.' };
    }

    await fs.writeFile(filePath, content, 'utf8');
    await addRecentFile(filePath);
    return { ok: true, filePath, name: path.basename(filePath), savedAt: Date.now() };
  });

  ipcMain.handle('recovery:save', async (event, payload) => {
    const id = sanitizeRecoveryId(payload?.id);
    const content = typeof payload?.content === 'string' ? payload.content : '';
    if (!id) return { ok: false, error: 'Invalid recovery id.' };
    if (Buffer.byteLength(content, 'utf8') > MAX_RECOVERY_BYTES) {
      return { ok: false, error: 'Recovery snapshot is larger than the 5 MB safety limit.' };
    }

    const filePath = path.join(getStorePaths().recoveryDir, `${id}.json`);
    await writeJson(filePath, {
      id,
      title: String(payload?.title || 'Untitled').slice(0, 200),
      originalPath: typeof payload?.filePath === 'string' ? payload.filePath : null,
      content,
      updatedAt: Date.now()
    });
    return { ok: true };
  });

  ipcMain.handle('recovery:delete', async (event, id) => {
    const safeId = sanitizeRecoveryId(id);
    if (!safeId) return { ok: false, error: 'Invalid recovery id.' };
    await fs.rm(path.join(getStorePaths().recoveryDir, `${safeId}.json`), { force: true });
    return { ok: true };
  });
}

function hardenWebContents(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  win.webContents.session.setPermissionCheckHandler(() => false);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true,
      devTools: !app.isPackaged,
      enableRemoteModule: false,
      navigateOnDragDrop: false
    }
  });

  hardenWebContents(mainWindow);

  mainWindow.on('close', (event) => {
    if (isForceClosing || !mainWindow || mainWindow.webContents.isDestroyed()) return;
    event.preventDefault();
    mainWindow.webContents.send('app:request-close');
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.on('will-navigate', (event) => event.preventDefault());
});

app.whenReady().then(async () => {
  await ensureStore();
  await loadTrustedPaths();
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    isForceClosing = false;
    createWindow();
  }
});
