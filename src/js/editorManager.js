import { clamp, countWords } from './utils.js';
import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['b', 'i', 'u', 'strong', 'em', 'br', 'p', 'div', 'span', 'font'];
const ALLOWED_ATTR = ['style', 'face', 'size', 'color'];
const ALLOWED_STYLE_VAL = /^\d+(?:px|pt)$|^(?:left|center|right|justify)$|^(?:'[^']+'|"[^"]+"|[a-zA-Z0-9\s-]+)$/;

// Configure DOMPurify hook for style validation
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName === 'style') {
    const styles = data.attrValue.split(';').map(s => s.trim()).filter(Boolean);
    const validated = styles.filter(style => {
      const [prop, val] = style.split(':').map(v => v.trim());
      if (!prop || !val) return false;
      if (prop === 'font-size') return /^\d+(?:px|pt)$/.test(val);
      if (prop === 'text-align') return /^(?:left|center|right|justify)$/.test(val);
      return true; // Allow other standard properties for now
    });
    data.attrValue = validated.join('; ');
  }
});

export class EditorManager extends EventTarget {
  static async create({ container }) {
    return new EditorManager({ container });
  }

  constructor({ container }) {
    super();
    this.container = container;
    this.editor = container; // The container itself is the contenteditable div
    this.zoom = Number(localStorage.getItem('notepad.zoom') || 100);
    this.isPlainTextMode = false;
    this.lastRange = null;

    this.editor.style.fontSize = '12pt';
    this.editor.style.lineHeight = '1.65';
    this.editor.style.outline = 'none';
    this.editor.style.whiteSpace = 'pre-wrap';
    this.editor.style.wordBreak = 'break-word';
    this.editor.style.padding = '22px';

    this.bind();
  }

  get fontSize() {
    return Math.round(15 * (this.zoom / 100));
  }

  bind() {
    this.editor.addEventListener('input', () => {
      this.dispatchEvent(new CustomEvent('change', { detail: { content: this.getValue(this.isPlainTextMode) } }));
      this.emitCursor();
    });

    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.editor) {
        this.emitCursor();
      }
    });

    this.editor.addEventListener('focus', () => this.emitCursor());

    // Selection caching
    const saveSelection = () => {
      const sel = window.getSelection();
      if (sel.rangeCount > 0 && this.editor.contains(sel.anchorNode)) {
        this.lastRange = sel.getRangeAt(0).cloneRange();
      }
    };
    
    this.editor.addEventListener('blur', saveSelection);
    document.addEventListener('selectionchange', () => {
      if (document.activeElement === this.editor) {
        saveSelection();
        this.emitCursor();
      }
    });
  }

  restoreSelection() {
    if (!this.lastRange) return;
    const sel = window.getSelection();
    if (!this.editor.contains(sel.anchorNode)) {
      sel.removeAllRanges();
      sel.addRange(this.lastRange);
    }
  }

  emitCursor() {
    this.dispatchEvent(new CustomEvent('cursor', { detail: this.getCursorPosition() }));
  }

  focus() {
    this.editor.focus();
  }

  getValue(isPlainText = this.isPlainTextMode) {
    // innerText is better for plain text as it preserves line breaks 
    // and doesn't include HTML entities like &lt;
    return isPlainText ? this.editor.innerText : this.editor.innerHTML;
  }

  setValue(content, metadata = {}) {
    this.lastRange = null;
    const ext = (metadata.filePath || metadata.title || '').split('.').pop()?.toLowerCase();
    
    // Plan: .txt and .md are plain text. No extension or .html is rich text.
    this.isPlainTextMode = metadata.mode === 'plain' || ext === 'txt' || ext === 'md';
    const isRich = !this.isPlainTextMode;

    if (isRich) {
      const clean = DOMPurify.sanitize(content || '', { 
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        ALLOWED_STYLES: ['font-size', 'font-family', 'text-align', 'color', 'background-color']
      });
      this.editor.innerHTML = clean;
    } else {
      // For plain text, we set innerText.
      // AUTO-REPAIR: If the content looks like double-encoded HTML (common corruption from previous versions),
      // we decode it and strip tags to restore the intended plain text.
      let finalContent = content || '';
      if (finalContent.includes('&lt;') && finalContent.includes('&gt;')) {
        const temp = document.createElement('div');
        temp.innerHTML = finalContent; // First level decode (&lt; -> <)
        const decoded = temp.textContent; 
        if (decoded.includes('<') && decoded.includes('>')) {
          temp.innerHTML = DOMPurify.sanitize(decoded); // Second level: parse tags
          finalContent = temp.innerText; // Strip tags
        }
      }
      this.editor.innerText = finalContent;
    }
    this.emitCursor();
    this.dispatchEvent(new CustomEvent('change', { detail: { content: this.getValue(this.isPlainTextMode) } }));
  }

  toggleMode() {
    this.isPlainTextMode = !this.isPlainTextMode;
    const content = this.getValue(!this.isPlainTextMode); // Get current
    this.setValue(content, { mode: this.isPlainTextMode ? 'plain' : 'rich' });
    return this.isPlainTextMode;
  }

  getPlainText() {
    return this.editor.innerText || '';
  }

  runEditCommand(command, value = null) {
    this.restoreSelection();
    this.focus();
    document.execCommand('styleWithCSS', false, true);

    const commands = {
      undo: 'undo',
      redo: 'redo',
      cut: 'cut',
      copy: 'copy',
      paste: 'paste',
      'select-all': 'selectAll',
      bold: 'bold',
      italic: 'italic',
      underline: 'underline',
      strikethrough: 'strikethrough',
      justifyLeft: 'justifyLeft',
      justifyCenter: 'justifyCenter',
      justifyRight: 'justifyRight',
      foreColor: 'foreColor',
      backColor: 'backColor',
      fontName: 'fontName'
    };

    if (command === 'fontSize') {
      this.applyFontSize(value);
    } else if (command === 'clear-format') {
      this.clearFormatting();
    } else {
      const cmd = commands[command];
      if (cmd) document.execCommand(cmd, false, value);
    }
    
    this.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  applyFontSize(sizePt) {
    this.restoreSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    
    // Optimization: If the selection is exactly one span, just update its style
    let container = range.commonAncestorContainer;
    if (container.nodeType === 3) container = container.parentElement;

    if (container.tagName === 'SPAN' && 
        container.parentElement === this.editor && 
        selection.toString() === container.textContent) {
      container.style.fontSize = `${sizePt}pt`;
    } else {
      // Standard application
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('fontSize', false, '7'); // Identity size
      
      const fontTags = this.editor.querySelectorAll('font[size="7"], span[style*="xxx-large"]');
      fontTags.forEach(el => {
        const span = document.createElement('span');
        span.style.fontSize = `${sizePt}pt`;
        if (el.style.fontFamily) span.style.fontFamily = el.style.fontFamily;
        if (el.style.color) span.style.color = el.style.color;
        
        // Transfer children
        while (el.firstChild) span.appendChild(el.firstChild);
        el.parentElement.replaceChild(span, el);
      });
    }
  }

  clearFormatting() {
    this.focus();
    document.execCommand('removeFormat', false, null);
    
    // Manually strip all style attributes from any elements inside the selection
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const elements = container.nodeType === 1 ? [container] : [];
    
    // Get all elements within the range
    const walker = document.createTreeWalker(
      container.nodeType === 1 ? container : container.parentElement,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          return selection.containsNode(node, true) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      node.removeAttribute('style');
    }
    
    // Also check the container itself if it's the only thing
    if (container.nodeType === 1 && selection.containsNode(container, true)) {
      container.removeAttribute('style');
    }
  }

  setFontFamily(family) {
    this.runEditCommand('fontName', family);
  }

  setFontSize(size) {
    this.runEditCommand('fontSize', size);
  }

  stepFontSize(delta) {
    const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72];
    const state = this.getSelectionState();
    let currentSize = parseFloat(state.fontSize) || 12;

    let index = sizes.findIndex(s => s >= currentSize);
    if (index === -1) index = sizes.length - 1;

    let nextIndex;
    if (delta > 0) {
      nextIndex = (sizes[index] > currentSize) ? index : index + 1;
    } else {
      nextIndex = index - 1;
    }

    const next = sizes[Math.max(0, Math.min(sizes.length - 1, nextIndex))];
    this.setFontSize(next);
    this.dispatchEvent(new CustomEvent('zoom', { detail: { size: next } }));
  }

  getStats() {
    const selection = window.getSelection();
    let line = 1, column = 1;

    if (selection.rangeCount > 0) {
      try {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(this.editor);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        
        const textBefore = preCaretRange.toString();
        const lines = textBefore.split('\n');
        line = lines.length;
        column = lines[lines.length - 1].length + 1;
      } catch (e) {
        // Fallback for complex ranges
      }
    }

    const text = this.editor.innerText || '';
    const state = this.getSelectionState();
    const currentPt = parseFloat(state.fontSize) || 12;
    const zoom = Math.round((currentPt / 12) * 100);

    return {
      cursor: { line, column },
      words: countWords(text),
      chars: text.length,
      zoom: zoom
    };
  }

  getSelectionState() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return { bold: false, italic: false, underline: false, fontSize: '12pt', fontFamily: 'Arial' };

    const node = selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement;
    const computed = window.getComputedStyle(node);
    const size = computed.fontSize;
    const family = computed.fontFamily.split(',')[0].replace(/['"]/g, '');

    return {
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      strikethrough: document.queryCommandState('strikethrough'),
      fontSize: size.includes('px') ? `${Math.round(parseFloat(size) * 0.75)}pt` : size,
      fontFamily: family,
      align: document.queryCommandValue('justifyLeft') === 'true' ? 'left' :
             document.queryCommandValue('justifyCenter') === 'true' ? 'center' :
             document.queryCommandValue('justifyRight') === 'true' ? 'right' : 'left'
    };
  }

  getCursorPosition() {
    return this.getStats();
  }

  // Search and replace are handled by SearchManager.js using non-destructive TreeWalker
  selectRange(start, end) {
    // No-op for now
  }

  setHighlights(matches, currentIndex = -1) {
    // No-op to prevent corrupting HTML
  }

  clearHighlights() {
    // No-op
  }
}
