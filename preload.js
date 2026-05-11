const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = Object.freeze({
  APP_INFO: 'app:info',
  APP_REQUEST_CLOSE: 'app:request-close',
  FILES_LIST_RECENT: 'files:list-recent',
  FILES_OPEN_DIALOG: 'files:open-dialog',
  FILES_OPEN_RECENT: 'files:open-recent',
  FILES_SAVE: 'files:save',
  RECOVERY_SAVE: 'recovery:save',
  RECOVERY_DELETE: 'recovery:delete',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_REQUEST_CLOSE: 'window:request-close',
  WINDOW_FORCE_CLOSE: 'window:force-close'
});

function asString(value, maxLength = 1024 * 1024) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength);
}

function sanitizeSavePayload(payload = {}) {
  return {
    filePath: payload.filePath ? asString(payload.filePath, 4096) : null,
    content: asString(payload.content, 20 * 1024 * 1024),
    saveAs: Boolean(payload.saveAs)
  };
}

function sanitizeRecoveryPayload(payload = {}) {
  return {
    id: asString(payload.id, 100),
    title: asString(payload.title, 200),
    filePath: payload.filePath ? asString(payload.filePath, 4096) : null,
    content: asString(payload.content, 5 * 1024 * 1024)
  };
}

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    const validChannels = [
      'window:minimize',
      'window:maximize',
      'window:toggle-maximize',
      'window:close',
      'window:request-close'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  }
});

contextBridge.exposeInMainWorld('notepad', {
  app: {
    getInfo: () => ipcRenderer.invoke(CHANNELS.APP_INFO),
    onRequestClose: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const handler = () => callback();
      ipcRenderer.on(CHANNELS.APP_REQUEST_CLOSE, handler);
      return () => ipcRenderer.removeListener(CHANNELS.APP_REQUEST_CLOSE, handler);
    }
  },
  window: {
    minimize: () => ipcRenderer.send(CHANNELS.WINDOW_MINIMIZE),
    toggleMaximize: () => ipcRenderer.send(CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
    requestClose: () => ipcRenderer.send(CHANNELS.WINDOW_REQUEST_CLOSE),
    forceClose: () => ipcRenderer.send(CHANNELS.WINDOW_FORCE_CLOSE)
  },
  files: {
    listRecent: () => ipcRenderer.invoke(CHANNELS.FILES_LIST_RECENT),
    openDialog: () => ipcRenderer.invoke(CHANNELS.FILES_OPEN_DIALOG),
    openRecent: (filePath) => ipcRenderer.invoke(CHANNELS.FILES_OPEN_RECENT, asString(filePath, 4096)),
    save: (payload) => ipcRenderer.invoke(CHANNELS.FILES_SAVE, sanitizeSavePayload(payload))
  },
  recovery: {
    save: (payload) => ipcRenderer.invoke(CHANNELS.RECOVERY_SAVE, sanitizeRecoveryPayload(payload)),
    delete: (id) => ipcRenderer.invoke(CHANNELS.RECOVERY_DELETE, asString(id, 100))
  }
});
