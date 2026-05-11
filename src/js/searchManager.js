export class SearchManager {
  constructor({ editor, findBar, input, matchCase, countLabel }) {
    this.editorManager = editor;
    this.editor = editor.editor; // The actual DOM element
    this.findBar = findBar;
    this.input = input;
    this.matchCase = matchCase;
    this.countLabel = countLabel;
    this.matches = []; // Array of Range objects
    this.currentIndex = -1;
    this.overlayContainer = null;
    this.bind();
  }

  bind() {
    this.input.addEventListener('input', () => this.refresh());
    this.matchCase.addEventListener('change', () => this.refresh());
    
    // Refresh highlights on scroll or resize to keep overlays aligned
    this.editor.addEventListener('scroll', () => this.renderHighlights());
    window.addEventListener('resize', () => this.renderHighlights());
    
    this.editorManager.addEventListener('change', () => {
      if (!this.findBar.hidden) this.refresh(false);
    });
  }

  open() {
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
  }

  refresh(selectFirst = true) {
    const query = this.input.value;
    this.matches = [];

    if (query) {
      this.findMatches(query);
    }

    if (this.matches.length === 0) {
      this.currentIndex = -1;
    } else if (selectFirst || this.currentIndex < 0 || this.currentIndex >= this.matches.length) {
      this.currentIndex = 0;
    }

    this.updateCount();
    this.renderHighlights();
    if (selectFirst && this.currentIndex !== -1) {
      this.selectCurrent();
    }
  }

  findMatches(query) {
    const walker = document.createTreeWalker(this.editor, NodeFilter.SHOW_TEXT, null, false);
    const needle = this.matchCase.checked ? query : query.toLowerCase();
    
    let node;
    while (node = walker.nextNode()) {
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
    this.renderHighlights();
    this.selectCurrent();
  }

  previous() {
    if (this.matches.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this.updateCount();
    this.renderHighlights();
    this.selectCurrent();
  }

  selectCurrent() {
    const range = this.matches[this.currentIndex];
    if (!range) return;
    
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    
    // Scroll into view if needed
    const rect = range.getBoundingClientRect();
    const editorRect = this.editor.getBoundingClientRect();
    if (rect.top < editorRect.top || rect.bottom > editorRect.bottom) {
      range.startContainer.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  replace(replacement) {
    if (this.currentIndex === -1 || this.matches.length === 0) return;
    
    const range = this.matches[this.currentIndex];
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    
    // Mark as changed to trigger save/status updates
    this.editor.dispatchEvent(new Event('input', { bubbles: true }));
    
    // RE-SCAN: Essential to update range offsets after DOM mutation
    this.refresh(true);
  }

  replaceAll(replacement) {
    if (this.matches.length === 0) return;
    
    // Iterate backwards to avoid index shifting problems during mutation
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
      this.overlayContainer.style.position = 'absolute';
      this.overlayContainer.style.top = '0';
      this.overlayContainer.style.left = '0';
      this.overlayContainer.style.width = '100%';
      this.overlayContainer.style.height = '100%';
      this.overlayContainer.style.pointerEvents = 'none';
      this.overlayContainer.style.zIndex = '10';
      this.editor.parentElement.style.position = 'relative';
      this.editor.parentElement.appendChild(this.overlayContainer);
    }

    const editorRect = this.editor.getBoundingClientRect();
    const fragment = document.createDocumentFragment();

    this.matches.forEach((range, index) => {
      const rects = range.getClientRects();
      for (const rect of rects) {
        const highlight = document.createElement('div');
        highlight.className = `search-highlight ${index === this.currentIndex ? 'active' : ''}`;
        highlight.style.position = 'absolute';
        highlight.style.left = `${rect.left - editorRect.left + this.editor.scrollLeft}px`;
        highlight.style.top = `${rect.top - editorRect.top + this.editor.scrollTop}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        fragment.appendChild(highlight);
      }
    });

    this.overlayContainer.appendChild(fragment);
  }

  clearHighlights() {
    if (this.overlayContainer) {
      this.overlayContainer.innerHTML = '';
    }
  }

  updateCount() {
    if (this.matches.length === 0) {
      this.countLabel.textContent = this.input.value ? 'No matches' : '0 matches';
      return;
    }
    this.countLabel.textContent = `${this.currentIndex + 1} of ${this.matches.length}`;
  }
}
