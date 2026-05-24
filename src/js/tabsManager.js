import { createElement, debounce, generateId, getFileName, safeText } from './utils.js';
import { sanitizePlainText, sanitizeRichHtml, isPlainExtension } from './sanitize.js';

const SESSION_KEY = 'notepad.session.v3';
const MAX_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_TABS = 24;

export class TabsManager extends EventTarget {
  constructor({ container, editor, fileManager, toasts }) {
    super();
    this.container = container;
    this.editor = editor;
    this.fileManager = fileManager;
    this.toasts = toasts;
    this.tabs = [];
    this.activeId = null;
    this.persistSession = debounce(() => this.saveSession(), 180);
    this.persistRecovery = debounce((tab) => this.fileManager.saveRecovery(tab), 5000);
    this.bind();
  }

  bind() {
    this.editor.addEventListener('change', (event) => {
      const tab = this.activeTab;
      if (!tab) return;
      tab.content = event.detail.content;
      tab.isDirty = tab.content !== tab.savedContent;
      tab.updatedAt = Date.now();
      this.render();
      this.persistSession();
      this.persistRecovery(tab);
      this.emitUpdate();
    });
  }

  get activeTab() {
    return this.tabs.find((tab) => tab.id === this.activeId) || null;
  }

  sanitizeTabContent(content, filePath) {
    return isPlainExtension(filePath) ? sanitizePlainText(content) : sanitizeRichHtml(content);
  }

  restoreSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        this.tabs = Array.isArray(parsed.tabs) ? parsed.tabs.slice(0, MAX_TABS).map((tab) => {
          const filePath = tab.filePath || null;
          const content = this.sanitizeTabContent(tab.content || '', filePath);
          const savedContent = this.sanitizeTabContent(tab.savedContent || '', filePath);
          return {
            id: tab.id || generateId(),
            title: safeText(tab.title, 200) || 'Untitled',
            filePath,
            content,
            savedContent,
            isDirty: Boolean(tab.isDirty) && content !== savedContent,
            createdAt: tab.createdAt || Date.now(),
            updatedAt: tab.updatedAt || Date.now()
          };
        }) : [];
        this.activeId = parsed.activeId;
      } catch {
        this.tabs = [];
      }
    }

    if (this.tabs.length === 0) this.createTab();
    if (!this.tabs.some((tab) => tab.id === this.activeId)) this.activeId = this.tabs[0].id;
    this.loadActiveIntoEditor();
    this.render();
    this.emitUpdate();
  }

  saveSession() {
    const payload = {
      activeId: this.activeId,
      tabs: this.tabs.slice(0, MAX_TABS).map((tab) => ({
        ...tab,
        content: safeText(tab.content, 512 * 1024),
        savedContent: safeText(tab.savedContent, 512 * 1024)
      }))
    };

    let serialized = JSON.stringify(payload);
    while (serialized.length > MAX_SESSION_BYTES && payload.tabs.length > 1) {
      payload.tabs.pop();
      serialized = JSON.stringify(payload);
    }

    try {
      localStorage.setItem(SESSION_KEY, serialized);
    } catch {
      this.toasts?.warning('Session not saved', 'Storage quota exceeded. Close some tabs.');
    }
  }

  createTab(content = '', options = {}) {
    const filePath = options.filePath || null;
    const safeContent = this.sanitizeTabContent(content, filePath);
    const tab = {
      id: generateId(),
      title: options.title || 'Untitled',
      filePath,
      content: safeContent,
      savedContent: this.sanitizeTabContent(options.savedContent ?? content, filePath),
      isDirty: Boolean(options.isDirty),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.tabs.push(tab);
    this.setActive(tab.id);
    return tab;
  }

  openFile(file) {
    const existing = this.tabs.find((tab) => tab.filePath && tab.filePath === file.filePath);
    if (existing) {
      this.setActive(existing.id);
      return existing;
    }

    return this.createTab(file.content, {
      title: file.name || getFileName(file.filePath),
      filePath: file.filePath,
      savedContent: file.content,
      isDirty: false
    });
  }

  setActive(id) {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab) return;
    const current = this.activeTab;
    if (current) current.content = this.editor.getValue();
    this.activeId = id;
    this.loadActiveIntoEditor();
    this.render();
    this.saveSession();
    this.emitUpdate();
  }

  loadActiveIntoEditor() {
    const tab = this.activeTab;
    this.editor.setValue(tab?.content || '', tab || {});
    this.editor.focus();
  }

  updateActiveTab(updates = {}) {
    const tab = this.activeTab;
    if (!tab) return;
    Object.assign(tab, updates);
    if (updates.content !== undefined) {
      tab.isDirty = tab.content !== tab.savedContent;
    }
    tab.updatedAt = Date.now();
    this.render();
    this.saveSession();
    this.emitUpdate();
  }

  markSaved(tab, filePath, name) {
    tab.filePath = filePath;
    tab.title = name || getFileName(filePath);
    tab.savedContent = tab.content;
    tab.isDirty = false;
    tab.updatedAt = Date.now();
    this.fileManager.clearRecovery(tab.id);
    this.render();
    this.saveSession();
    this.emitUpdate();
  }

  async flushRecovery() {
    const tab = this.activeTab;
    if (tab?.isDirty) {
      await this.fileManager.saveRecovery(tab, this.editor.isPlainTextMode);
    }
  }

  async closeTab(id, confirmClose) {
    const tab = this.tabs.find((candidate) => candidate.id === id);
    if (!tab) return true;
    if (tab.isDirty) {
      const decision = await confirmClose(tab);
      if (decision === 'cancel') return false;
    }

    const index = this.tabs.findIndex((candidate) => candidate.id === id);
    this.tabs.splice(index, 1);
    await this.fileManager.clearRecovery(id);

    if (this.tabs.length === 0) this.createTab();
    else if (this.activeId === id) this.setActive(this.tabs[Math.max(0, index - 1)].id);

    this.render();
    this.saveSession();
    this.emitUpdate();
    return true;
  }

  async closeAll(confirmClose) {
    for (const tab of [...this.tabs]) {
      const closed = await this.closeTab(tab.id, confirmClose);
      if (!closed) return false;
    }
    return true;
  }

  activateNext() {
    if (this.tabs.length < 2) return;
    const index = this.tabs.findIndex((tab) => tab.id === this.activeId);
    this.setActive(this.tabs[(index + 1) % this.tabs.length].id);
  }

  reorder(sourceId, targetId) {
    if (sourceId === targetId) return;
    const sourceIndex = this.tabs.findIndex((tab) => tab.id === sourceId);
    const targetIndex = this.tabs.findIndex((tab) => tab.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const [tab] = this.tabs.splice(sourceIndex, 1);
    this.tabs.splice(targetIndex, 0, tab);
    this.render();
    this.saveSession();
  }

  render() {
    const fragment = document.createDocumentFragment();
    this.tabs.forEach((tab) => {
      const button = createElement('div', {
        className: 'tab',
        role: 'tab',
        ariaLabel: `${tab.title}${tab.isDirty ? ', unsaved changes' : ''}`
      });
      button.id = `tab-${tab.id}`;
      button.draggable = true;
      button.dataset.tabId = tab.id;
      button.tabIndex = 0;
      button.setAttribute('aria-selected', String(tab.id === this.activeId));

      button.appendChild(createElement('span', { className: 'tab-title', text: tab.title }));
      if (tab.isDirty) button.appendChild(createElement('span', { className: 'dirty-dot' }));

      const close = createElement('button', {
        className: 'tab-close',
        text: 'x',
        type: 'button',
        ariaLabel: `Close ${tab.title}`
      });
      close.dataset.closeTab = tab.id;
      button.appendChild(close);
      fragment.appendChild(button);
    });

    this.container.replaceChildren(fragment);
  }

  emitUpdate() {
    this.dispatchEvent(new CustomEvent('update', { detail: { tab: this.activeTab } }));
  }
}
