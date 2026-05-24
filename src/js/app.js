import { EditorManager } from './editorManager.js';
import { FileManager } from './fileManager.js';
import { SearchManager } from './searchManager.js';
import { StatusManager } from './statusManager.js';
import { TabsManager } from './tabsManager.js';
import { ToastManager } from './toastManager.js';
import { UIManager } from './uiManager.js';
import { ThemeManager } from './themeManager.js';
import { $, debounce, formatError } from './utils.js';

const elements = {
  tabs: $('#tabs-container'),
  editor: $('#editor'),
  menuBar: $('#menu-bar'),
  sidebar: $('#sidebar'),
  sidebarResizer: $('#sidebar-resizer'),
  recentFiles: $('#recent-files-list'),
  recoveryFiles: $('#recovery-files-list'),
  findBar: $('#find-bar'),
  findInput: $('#find-input'),
  matchCase: $('#match-case-checkbox'),
  findCount: $('#find-count'),
  cursor: $('#cursor-position'),
  words: $('#word-count'),
  chars: $('#char-count'),
  fileType: $('#file-type'),
  saveStatus: $('#save-status'),
  zoom: $('#zoom-level'),
  activeFile: $('#active-file-label'),
  saveState: $('#save-state-label'),
  toastRegion: $('#toast-region'),
  modalBackdrop: $('#modal-backdrop'),
  modalTitle: $('#modal-title'),
  modalMessage: $('#modal-message'),
  modalExtra: $('#modal-extra'),
  modalCancel: $('#modal-cancel-btn'),
  modalSecondary: $('#modal-secondary-btn'),
  modalPrimary: $('#modal-primary-btn'),
  fontFamily: $('#font-family-select'),
  fontSize: $('#font-size-select'),
  toggleMode: $('#toggle-mode-btn')
};

const toasts = new ToastManager(elements.toastRegion);
const editor = await EditorManager.create({ container: elements.editor });
const fileManager = new FileManager(toasts);
const tabs = new TabsManager({ container: elements.tabs, editor, fileManager, toasts });
const status = new StatusManager(elements);
const search = new SearchManager({
  editor,
  findBar: elements.findBar,
  input: elements.findInput,
  matchCase: elements.matchCase,
  countLabel: elements.findCount
});
const themes = new ThemeManager();
const ui = new UIManager(elements);

function updateStatus() {
  status.update({ tab: tabs.activeTab, stats: editor.getStats() });
}


async function refreshRecentFiles() {
  try {
    const recent = await fileManager.listRecent();
    ui.renderRecentFiles(recent, tabs.activeTab?.filePath);
  } catch (error) {
    toasts.warning('Recent files unavailable', formatError(error));
  }
}

async function refreshRecoveryFiles() {
  try {
    const response = await window.notepad.recovery.list();
    if (response?.ok) {
      ui.renderRecoveryFiles(response.files);
    }
  } catch (error) {
    toasts.warning('Recovery files unavailable', formatError(error));
  }
}

async function openFile() {
  try {
    const file = await fileManager.openDialog();
    if (!file) return;
    tabs.openFile(file);
    await refreshRecentFiles();
  } catch (error) {
    toasts.error('Open failed', formatError(error));
  }
}

async function openRecent(filePath) {
  try {
    const file = await fileManager.openRecent(filePath);
    tabs.openFile(file);
    await refreshRecentFiles();
  } catch (error) {
    const msg = formatError(error);
    if (msg.includes('ENOENT') || msg.includes('not found')) {
      toasts.warning('File not found', 'This file may have been moved or deleted.');
      await refreshRecentFiles();
    } else {
      toasts.error('Open failed', msg);
    }
  }
}

async function saveActive(saveAs = false) {
  const tab = tabs.activeTab;
  if (!tab) return false;

  try {
    const extFromPath = tab.filePath?.split('.').pop()?.toLowerCase();
    const isPlainText = editor.isPlainTextMode || extFromPath === 'txt' || extFromPath === 'md';
    tab.content = editor.getValue(isPlainText);

    if (saveAs || !tab.filePath) {
      let suggested = tab.title === 'Untitled' ? '' : tab.title;
      if (!suggested || suggested === 'Untitled') {
        const firstLine = editor.getPlainText().split('\n')[0].trim();
        if (firstLine) suggested = firstLine.slice(0, 35).replace(/[<>:"/\\|?*]/g, '').trim();
      }
      if (!suggested) suggested = 'Untitled';
      if (!suggested.includes('.')) suggested += isPlainText ? '.txt' : '.html';

      const pick = await fileManager.save({ ...tab, filePath: suggested }, true);
      if (!pick || pick.canceled) return false;
      tab.filePath = pick.filePath;
      tab.title = pick.name;
    }

    const result = await fileManager.save(tab, false);
    if (!result) return false;

    editor.isPlainTextMode = isPlainText;
    tabs.markSaved(tab, result.filePath, result.name);
    await refreshRecentFiles();
    return true;
  } catch (error) {
    toasts.error('Save failed', formatError(error));
    return false;
  }
}

async function confirmTabClose(tab) {
  const decision = await ui.confirmDirty(tab);
  if (decision === 'primary' || decision === 'save') {
    const saved = await saveActive(false);
    return saved ? 'close' : 'cancel';
  }
  return decision === 'secondary' || decision === 'discard' ? 'close' : decision;
}

async function closeActiveTab() {
  const tab = tabs.activeTab;
  if (!tab) return;
  await tabs.closeTab(tab.id, confirmTabClose);
}

async function exitApp() {
  const ok = await tabs.closeAll(confirmTabClose);
  if (ok) window.notepad.window.forceClose();
}

function syncFormattingToolbar() {
  ui.setFormattingEnabled(!editor.isPlainTextMode);
}

function runAction(action) {
  const actions = {
    new: () => tabs.createTab(),
    open: openFile,
    save: () => saveActive(false),
    'save-as': () => saveActive(true),
    exit: exitApp,
    undo: () => editor.runEditCommand('undo'),
    redo: () => editor.runEditCommand('redo'),
    'clear-editor': async () => {
      const resetConfirmed = await ui.showModal({
        title: 'Reset Editor?',
        message: 'Clear all content in the current document?',
        primary: 'Clear',
        cancel: 'Cancel'
      });
      if (resetConfirmed === 'primary' || resetConfirmed === 'save') {
        const tab = tabs.activeTab;
        editor.setValue('', tab || {});
        if (tab) {
          tabs.updateActiveTab({
            content: editor.getValue(),
            isDirty: editor.getValue() !== tab.savedContent
          });
        }
      }
    },
    'clear-history': async () => {
      const historyConfirmed = await ui.showModal({
        title: 'Clear History?',
        message: 'Remove all recent files from the sidebar?',
        primary: 'Clear',
        cancel: 'Cancel'
      });
      if (historyConfirmed === 'primary' || historyConfirmed === 'save') {
        await fileManager.clearRecent();
        await refreshRecentFiles();
      }
    },
    cut: () => editor.runEditCommand('cut'),
    copy: () => editor.runEditCommand('copy'),
    paste: () => editor.runEditCommand('paste'),
    'select-all': () => editor.runEditCommand('select-all'),
    bold: () => editor.runEditCommand('bold'),
    italic: () => editor.runEditCommand('italic'),
    underline: () => editor.runEditCommand('underline'),
    strikethrough: () => editor.runEditCommand('strikethrough'),
    'clear-format': () => editor.runEditCommand('clear-format'),
    justifyLeft: () => editor.runEditCommand('justifyLeft'),
    justifyCenter: () => editor.runEditCommand('justifyCenter'),
    justifyRight: () => editor.runEditCommand('justifyRight'),
    find: () => search.open(),
    'find-next': () => search.next(),
    'find-prev': () => search.previous(),
    'find-close': () => search.close(),
    replace: () => search.replace($('#replace-input').value),
    'replace-all': () => search.replaceAll($('#replace-input').value),
    'zoom-in': () => { window.notepad.window.zoomIn(); setTimeout(updateStatus, 50); },
    'zoom-out': () => { window.notepad.window.zoomOut(); setTimeout(updateStatus, 50); },
    'minimize': () => window.notepad.window.minimize(),
    'maximize': () => window.notepad.window.toggleMaximize(),
    'close-app': exitApp,
    'reset-zoom': () => { window.notepad.window.resetZoom(); setTimeout(updateStatus, 50); },
    'toggle-sidebar': () => ui.toggleSidebar(),
    'toggle-theme': () => themes.toggle(),
    about: async () => ui.showAbout(await window.notepad.app.getInfo())
  };

  const handler = actions[action];
  if (!handler) return;
  const result = handler();
  if (result?.then) {
    result.finally(() => {
      syncFormattingToolbar();
      updateStatus();
    });
    return;
  }
  syncFormattingToolbar();
  updateStatus();
}

function bindAppEvents() {
  ui.addEventListener('action', (event) => runAction(event.detail.action));
  ui.addEventListener('activate-tab', (event) => tabs.setActive(event.detail.id));
  ui.addEventListener('close-tab', (event) => tabs.closeTab(event.detail.id, confirmTabClose));
  ui.addEventListener('reorder-tabs', (event) => tabs.reorder(event.detail.sourceId, event.detail.targetId));

  const onSelectionChange = debounce(() => {
    if (document.activeElement === elements.editor) {
      const state = editor.getSelectionState();
      $('#btn-bold')?.classList.toggle('active', state.bold);
      $('#btn-italic')?.classList.toggle('active', state.italic);
      $('#btn-underline')?.classList.toggle('active', state.underline);
      $('#btn-strikethrough')?.classList.toggle('active', state.strikethrough);
      $('#btn-align-left')?.classList.toggle('active', state.align === 'left');
      $('#btn-align-center')?.classList.toggle('active', state.align === 'center');
      $('#btn-align-right')?.classList.toggle('active', state.align === 'right');

      // Update highlight color picker
      const backColor = state.backColor || '#000000';
      
      const rgbToHex = (rgb) => {
        if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') return '#000000';
        const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (!match) return '#000000';
        const hex = (x) => ("0" + parseInt(x).toString(16)).slice(-2);
        return "#" + hex(match[1]) + hex(match[2]) + hex(match[3]);
      };

      if ($('#highlight-color-picker')) $('#highlight-color-picker').value = rgbToHex(backColor);

      // Update font family select
      let currentFont = state.fontFamily;
      if (currentFont && elements.fontFamily) {
        currentFont = currentFont.replace(/['"]/g, '').split(',')[0].trim();
        const options = Array.from(elements.fontFamily.options);
        const match = options.find(opt => opt.value === currentFont) || 
                      options.find(opt => currentFont.includes(opt.value));
        if (match) elements.fontFamily.value = match.value;
      }

      // Update font size select
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        let node = range.commonAncestorContainer;
        if (node.nodeType === 3) node = node.parentElement;
        
        const styledNode = node.closest('[style*="font-size"]');
        if (styledNode && elements.fontSize) {
          const sizeStr = styledNode.style.fontSize;
          if (sizeStr.endsWith('pt')) {
            const ptValue = parseInt(sizeStr);
            const options = Array.from(elements.fontSize.options).map(o => parseInt(o.value));
            const closest = options.reduce((prev, curr) => {
              return (Math.abs(curr - ptValue) < Math.abs(prev - ptValue) ? curr : prev);
            });
            elements.fontSize.value = String(closest);
          }
        }
      }
    }
  }, 100);

  document.addEventListener('selectionchange', onSelectionChange);

  $('#font-color-picker')?.addEventListener('input', (e) => {
    editor.runEditCommand('foreColor', e.target.value);
  });

  $('#highlight-color-picker')?.addEventListener('input', (e) => {
    editor.runEditCommand('backColor', e.target.value);
  });

  elements.fontFamily?.addEventListener('change', (e) => {
    editor.runEditCommand('fontName', e.target.value);
  });

  elements.fontSize?.addEventListener('change', (e) => {
    editor.runEditCommand('fontSize', e.target.value);
  });

  elements.recentFiles.addEventListener('click', (event) => {
    const button = event.target.closest('[data-recent-path]');
    if (button) openRecent(button.dataset.recentPath);
  });

  elements.recoveryFiles?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recovery-id]');
    if (!button) return;
    try {
      const file = ui.getRecoverySnapshot(button.dataset.recoveryId);
      if (!file) throw new Error('Recovery snapshot not found.');
      const filePath = file.originalPath || file.filePath || null;
      tabs.createTab(file.content, {
        title: file.title,
        filePath,
        savedContent: file.savedContent || '',
        isDirty: file.content !== (file.savedContent || '')
      });
      if (file.isPlainText) editor.isPlainTextMode = true;
      await window.notepad.recovery.delete(file.id);
      await refreshRecoveryFiles();
      syncFormattingToolbar();
    } catch (err) {
      toasts.error('Restore failed', formatError(err));
    }
  });

  tabs.addEventListener('update', () => {
    syncFormattingToolbar();
    updateStatus();
  });
  editor.addEventListener('change', updateStatus);
  editor.addEventListener('cursor', updateStatus);
  editor.addEventListener('modechange', () => {
    syncFormattingToolbar();
    updateStatus();
  });
  editor.addEventListener('format-blocked', () => {
    toasts.info('Formatting unavailable', 'Switch to rich text mode to use formatting tools.');
  });
  ui.addEventListener('sidebar-toggle', (e) => {
    if (!e.detail.collapsed) {
      refreshRecentFiles();
      refreshRecoveryFiles();
    }
  });

  if (elements.toggleMode) {
    elements.toggleMode.addEventListener('click', () => {
      const isPlain = editor.toggleMode();
      toasts.info(`Switched to ${isPlain ? 'Plain Text' : 'Rich Text'} mode`);
      syncFormattingToolbar();
      updateStatus();
    });
  }

  window.addEventListener('beforeunload', () => {
    tabs.flushRecovery();
  });


  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod && event.key !== 'Escape' && event.key !== 'F3') return;

    if (mod && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      runAction('new');
    } else if (mod && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      runAction('open');
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      runAction(event.shiftKey ? 'save-as' : 'save');
    } else if (mod && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      runAction('find');
    } else if (mod && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      runAction('select-all');
    } else if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      runAction('undo');
    } else if (mod && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      runAction('redo');
    } else if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      runAction('bold');
    } else if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      runAction('italic');
    } else if (mod && event.key.toLowerCase() === 'u') {
      event.preventDefault();
      runAction('underline');
    } else if (mod && event.key.toLowerCase() === 'w') {
      event.preventDefault();
      closeActiveTab();
    } else if (mod && event.key === 'PageDown') {
      event.preventDefault();
      tabs.activateNext();
    } else if (event.key === 'F3') {
      event.preventDefault();
      event.shiftKey ? search.previous() : search.next();
    } else if (mod && event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      runAction('toggle-theme');
    } else if (event.key === 'Escape' && !elements.findBar.hidden) {
      search.close();
    }
  });

  window.notepad.app.onRequestClose(exitApp);
}

bindAppEvents();
tabs.restoreSession();
syncFormattingToolbar();
refreshRecentFiles();
refreshRecoveryFiles();
updateStatus();
