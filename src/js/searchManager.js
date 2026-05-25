import { debounce } from './utils.js';

export class SearchManager {
  constructor({ editor, findBar, input, matchCase, countLabel }) {
    this.editorManager = editor;
    this.editor = editor.editor;
    this.scrollParent = this.editor.closest('.editor-frame') || this.editor;
    this.findBar = findBar;
    this.input = input;
    this.matchCase = matchCase;
    this.countLabel = countLabel;
    this.matches = [];
    this.currentIndex = -1;
    this.overlayContainer = null;
    this.searchSavedRange = null;
    this.scheduleHighlight = debounce(() => this.renderHighlights(), 16);
    this.bind();
  }

  bind() {
    this.input.addEventListener('input', () => this.refresh(false));
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.shiftKey ? this.previous() : this.next();
      }
    });
    this.matchCase.addEventListener('change', () => this.refresh());

    this.scrollParent.addEventListener('scroll', () => this.scheduleHighlight(), { passive: true });
    window.addEventListener('resize', () => this.scheduleHighlight());

    this.editorManager.addEventListener('change', () => {
      if (!this.findBar.hidden) this.refresh(false);
    });
  }

  open() {
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      this.searchSavedRange = sel.getRangeAt(0).cloneRange();
    }
    this.findBar.hidden = false;
    this.input.focus();
    this.input.select();
    this.refresh(false);
  }

  close() {
    this.findBar.hidden = true;
    this.input.value = '';
    this.matches = [];
    this.currentIndex = -1;
    this.clearHighlights();
    this.updateCount();
    this.editorManager.focus();
    if (this.searchSavedRange) {
      try {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(this.searchSavedRange);
        this.editorManager.saveSelection();
      } catch {
      }
      this.searchSavedRange = null;
    }
  }

  refresh(selectFirst = true) {
    const query = this.input.value;
    this.matches = [];

    if (query) this.findMatches(query);

    if (this.matches.length === 0) {
      this.currentIndex = -1;
    } else if (selectFirst || this.currentIndex < 0 || this.currentIndex >= this.matches.length) {
      this.currentIndex = 0;
    }

    this.updateCount();
    this.scheduleHighlight();
    if (selectFirst && this.currentIndex !== -1) this.selectCurrent();
  }

  findMatches(query) {
    const walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT);
    const needle = this.matchCase.checked ? query : query.toLowerCase();

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      const haystack = this.matchCase.checked ? text : text.toLowerCase();
      let start = 0;

      while ((start = haystack.indexOf(needle, start)) !== -1) {
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + query.length);
        this.matches.push(range);
        start += query.length;
      }
    }
  }

  next() {
    if (this.findBar.hidden) return this.open();
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    this.updateCount();
    this.scheduleHighlight();
    this.selectCurrent();
  }

  previous() {
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this.updateCount();
    this.scheduleHighlight();
    this.selectCurrent();
  }

  selectCurrent() {
    const range = this.matches[this.currentIndex];
    if (!range) return;

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const rect = range.getBoundingClientRect();
    const parentRect = this.scrollParent.getBoundingClientRect();
    if (rect.top < parentRect.top || rect.bottom > parentRect.bottom) {
      const node = range.startContainer.nodeType === 3
        ? range.startContainer.parentElement
        : range.startContainer;
      node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  replace(replacement) {
    if (this.currentIndex === -1 || this.matches.length === 0) return;
    const range = this.matches[this.currentIndex];
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    this.editor.dispatchEvent(new Event('input', { bubbles: true }));
    this.refresh(true);
  }

  replaceAll(replacement) {
    if (this.matches.length === 0) return;
    for (let i = this.matches.length - 1; i >= 0; i--) {
      const range = this.matches[i];
      range.deleteContents();
      range.insertNode(document.createTextNode(replacement));
    }
    this.editor.dispatchEvent(new Event('input', { bubbles: true }));
    this.refresh(true);
  }

  renderHighlights() {
    this.clearHighlights();
    if (this.matches.length === 0 || this.findBar.hidden) return;

    if (!this.overlayContainer) {
      this.overlayContainer = document.createElement('div');
      this.overlayContainer.className = 'search-overlay-container';
      Object.assign(this.overlayContainer.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: '10'
      });
      this.scrollParent.style.position = 'relative';
      this.scrollParent.appendChild(this.overlayContainer);
    }

    const anchorRect = this.scrollParent.getBoundingClientRect();
    const fragment = document.createDocumentFragment();

    this.matches.forEach((range, index) => {
      for (const rect of range.getClientRects()) {
        const highlight = document.createElement('div');
        highlight.className = `search-highlight ${index === this.currentIndex ? 'active' : ''}`;
        Object.assign(highlight.style, {
          position: 'absolute',
          left: `${rect.left - anchorRect.left + this.scrollParent.scrollLeft}px`,
          top: `${rect.top - anchorRect.top + this.scrollParent.scrollTop}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`
        });
        fragment.appendChild(highlight);
      }
    });

    this.overlayContainer.appendChild(fragment);
  }

  clearHighlights() {
    if (this.overlayContainer) this.overlayContainer.replaceChildren();
  }

  updateCount() {
    if (this.matches.length === 0) {
      this.countLabel.textContent = this.input.value ? 'No matches' : '0 matches';
      return;
    }
    this.countLabel.textContent = `${this.currentIndex + 1} of ${this.matches.length}`;
  }
}
