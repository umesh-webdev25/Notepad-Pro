import { createElement } from './utils.js';

export class UIManager extends EventTarget {
  constructor(elements) {
    super();
    this.elements = elements;
    this.modalResolver = null;
    this.recoveryById = new Map();
    this.bind();
  }

  bind() {
    document.addEventListener('mousedown', (event) => {
      const actionTarget = event.target.closest('[data-action]');
      if (actionTarget && actionTarget.tagName !== 'INPUT' && actionTarget.tagName !== 'SELECT') {
        event.preventDefault();
      }
    });

    document.addEventListener('click', (event) => {
      const actionTarget = event.target.closest('[data-action]');
      if (actionTarget) {
        if (actionTarget.tagName !== 'INPUT' && actionTarget.tagName !== 'SELECT') {
          event.preventDefault();
        }
        this.emitAction(actionTarget.dataset.action);
        this.closeMenus();
        return;
      }

      if (!event.target.closest('.menu-item')) this.closeMenus();
    });

    this.elements.menuBar.addEventListener('click', (event) => {
      const label = event.target.closest('.menu-label');
      if (!label) return;
      const item = label.closest('.menu-item');
      const isOpen = item.classList.contains('open');
      this.closeMenus();
      if (!isOpen) this.openMenu(item);
    });

    this.elements.menuBar.addEventListener('keydown', (event) => {
      const item = event.target.closest('.menu-item');
      if (!item) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.openMenu(item);
      }
      if (event.key === 'Escape') this.closeMenus();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.openMenu(item);
        item.querySelector('[role="menuitem"]')?.focus();
      }
    });

    this.elements.tabs.addEventListener('click', (event) => {
      const close = event.target.closest('[data-close-tab]');
      if (close) {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent('close-tab', { detail: { id: close.dataset.closeTab } }));
        return;
      }
      const tab = event.target.closest('[data-tab-id]');
      if (tab) this.dispatchEvent(new CustomEvent('activate-tab', { detail: { id: tab.dataset.tabId } }));
    });

    this.elements.tabs.addEventListener('keydown', (event) => {
      const tab = event.target.closest('[data-tab-id]');
      if (!tab) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('activate-tab', { detail: { id: tab.dataset.tabId } }));
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('close-tab', { detail: { id: tab.dataset.tabId } }));
      }
    });

    this.elements.tabs.addEventListener('dragstart', (event) => {
      const tab = event.target.closest('[data-tab-id]');
      if (!tab) return;
      event.dataTransfer.setData('text/plain', tab.dataset.tabId);
      event.dataTransfer.effectAllowed = 'move';
    });

    this.elements.tabs.addEventListener('dragover', (event) => {
      if (event.target.closest('[data-tab-id]')) event.preventDefault();
    });

    this.elements.tabs.addEventListener('drop', (event) => {
      const target = event.target.closest('[data-tab-id]');
      if (!target) return;
      event.preventDefault();
      this.dispatchEvent(new CustomEvent('reorder-tabs', {
        detail: {
          sourceId: event.dataTransfer.getData('text/plain'),
          targetId: target.dataset.tabId
        }
      }));
    });

    this.elements.modalCancel.addEventListener('click', () => this.resolveModal('cancel'));
    this.elements.modalSecondary.addEventListener('click', () => this.resolveModal('secondary'));
    this.elements.modalPrimary.addEventListener('click', () => this.resolveModal('primary'));

    document.addEventListener('keydown', (event) => {
      if (!this.elements.modalBackdrop.hidden) {
        if (event.key === 'Escape') {
          this.resolveModal('cancel');
        } else if (event.key === 'Tab') {
          const focusableElements = this.elements.modalBackdrop.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
          const focusable = Array.from(focusableElements).filter(el => !el.hidden && !el.disabled && el.offsetParent !== null);
          if (focusable.length > 0) {
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey) {
              if (document.activeElement === first || !focusable.includes(document.activeElement)) {
                last.focus();
                event.preventDefault();
              }
            } else {
              if (document.activeElement === last || !focusable.includes(document.activeElement)) {
                first.focus();
                event.preventDefault();
              }
            }
          }
        }
      }
    });

    this.bindSidebarResize();
  }

  bindSidebarResize() {
    let resizing = false;
    this.elements.sidebarResizer.addEventListener('mousedown', (event) => {
      resizing = true;
      document.body.classList.add('resizing');
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!resizing) return;
      const width = Math.min(480, Math.max(210, event.clientX));
      this.elements.sidebar.style.width = `${width}px`;
      this.elements.sidebar.style.flexBasis = `${width}px`;
    });

    document.addEventListener('mouseup', () => {
      if (!resizing) return;
      resizing = false;
      document.body.classList.remove('resizing');
    });
  }

  emitAction(action) {
    this.dispatchEvent(new CustomEvent('action', { detail: { action } }));
  }

  openMenu(item) {
    this.closeMenus();
    item.classList.add('open');
    item.setAttribute('aria-expanded', 'true');
  }

  closeMenus() {
    this.elements.menuBar.querySelectorAll('.menu-item').forEach((item) => {
      item.classList.remove('open');
      item.setAttribute('aria-expanded', 'false');
    });
  }

  setSidebarCollapsed(collapsed) {
    this.elements.sidebar.classList.toggle('collapsed', collapsed);
  }

  toggleSidebar() {
    const collapsed = !this.elements.sidebar.classList.contains('collapsed');
    this.setSidebarCollapsed(collapsed);
    this.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed } }));
  }

  renderRecentFiles(files, activePath = null) {
    if (!files.length) {
      const empty = createElement('li', { className: 'sidebar-hint', text: 'No recent files yet.' });
      this.elements.recentFiles.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    files.forEach((file) => {
      const item = document.createElement('li');
      const isActive = file.filePath === activePath;
      const button = createElement('button', {
        className: `recent-file${isActive ? ' active' : ''}`,
        type: 'button',
        ariaLabel: `Open ${file.name || file.filePath}`
      });
      button.dataset.recentPath = file.filePath;
      const name = createElement('span', { className: 'recent-name', text: file.name || file.filePath });
      const path = createElement('span', { className: 'recent-path', text: file.filePath });
      button.append(name, path);
      item.appendChild(button);
      fragment.appendChild(item);
    });

    this.elements.recentFiles.replaceChildren(fragment);
  }

  renderRecoveryFiles(files) {
    if (!this.elements.recoveryFiles) return;

    this.recoveryById.clear();

    if (!files.length) {
      const empty = createElement('li', { className: 'sidebar-hint', text: 'No recovery files found.' });
      this.elements.recoveryFiles.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    files
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .forEach((file) => {
        if (!file?.id) return;
        this.recoveryById.set(file.id, file);
        const item = document.createElement('li');
        const button = createElement('button', {
          className: 'recent-file',
          type: 'button',
          ariaLabel: `Recover ${file.title || 'Untitled'}`
        });
        button.dataset.recoveryId = file.id;
        const name = createElement('span', { className: 'recent-name', text: file.title || 'Untitled' });
        const path = createElement('span', {
          className: 'recent-path',
          text: file.originalPath || 'Unsaved snapshot'
        });
        button.append(name, path);
        item.appendChild(button);
        fragment.appendChild(item);
      });

    this.elements.recoveryFiles.replaceChildren(fragment);
  }

  getRecoverySnapshot(id) {
    return this.recoveryById.get(id) || null;
  }

  setFormattingEnabled(_enabled) {
    // Plain/rich mode is enforced in EditorManager; no visual toolbar state change.
  }

  async confirmDirty(tab) {
    return this.showModal({
      title: 'Save changes?',
      message: `${tab.title} has unsaved changes.`,
      extra: 'Save the file, discard the changes, or cancel and keep editing.',
      primary: 'Save',
      secondary: "Don't Save",
      cancel: 'Cancel'
    });
  }

  async showAbout(info) {
    await this.showModal({
      title: 'About Notepad Pro',
      message: 'A secure local-first desktop editor built with Electron.',
      extra: `Version ${info.version} | Electron ${info.electron} | Chromium ${info.chrome}`,
      primary: 'OK',
      secondary: '',
      cancel: ''
    });
  }

  showModal({ title, message, extra = '', primary = 'OK', secondary = '', cancel = 'Cancel' }) {
    this.elements.modalTitle.textContent = title;
    this.elements.modalMessage.textContent = message;
    this.elements.modalExtra.textContent = extra;
    this.elements.modalPrimary.textContent = primary;
    this.elements.modalSecondary.textContent = secondary;
    this.elements.modalCancel.textContent = cancel;
    this.elements.modalSecondary.hidden = !secondary;
    this.elements.modalCancel.hidden = !cancel;
    this.elements.modalBackdrop.hidden = false;
    this.elements.modalPrimary.focus();

    return new Promise((resolve) => {
      this.modalResolver = resolve;
    });
  }

  resolveModal(value) {
    if (!this.modalResolver) return;
    const resolver = this.modalResolver;
    this.modalResolver = null;
    this.elements.modalBackdrop.hidden = true;
    resolver(value);
  }
}
