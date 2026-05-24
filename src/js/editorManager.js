import { countWords } from './utils.js';
import { isPlainExtension, sanitizePlainText, sanitizeRichHtml } from './sanitize.js';

const RICH_COMMANDS = new Set([
  'bold', 'italic', 'underline', 'strikethrough',
  'justifyLeft', 'justifyCenter', 'justifyRight',
  'backColor', 'foreColor', 'fontName', 'fontSize', 'clear-format'
]);

const TAG_BY_COMMAND = {
  bold: ['B', 'STRONG'],
  italic: ['I', 'EM'],
  underline: ['U'],
  strikethrough: ['S', 'STRIKE']
};

export class EditorManager extends EventTarget {
  static async create({ container }) {
    const instance = new EditorManager({ container });
    instance.seedHistory();
    return instance;
  }

  constructor({ container }) {
    super();
    this.editor = container;
    this.isPlainTextMode = false;
    this.lastRange = null;
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 100;

    Object.assign(this.editor.style, {
      fontSize: '12pt',
      lineHeight: '1.65',
      outline: 'none',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      padding: '22px'
    });

    this.bind();
  }

  bind() {
    this.editor.addEventListener('input', () => {
      this.pushHistory();
      this.dispatchEvent(new CustomEvent('change', {
        detail: { content: this.getValue(this.isPlainTextMode) }
      }));
      this.emitCursor();
    });

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
    this.editor.addEventListener('focus', () => this.emitCursor());
  }

  seedHistory() {
    this.history = [this.getValue()];
    this.historyIndex = 0;
  }

  pushHistory() {
    const content = this.getValue();
    if (this.history[this.historyIndex] === content) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(content);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyIndex += 1;
    }
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.applyHistorySnapshot();
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.applyHistorySnapshot();
  }

  applyHistorySnapshot() {
    const content = this.history[this.historyIndex];
    const mode = this.isPlainTextMode ? 'plain' : 'rich';
    this.setValue(content, { mode, bypassHistory: true });
  }

  restoreSelection() {
    if (!this.lastRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(this.lastRange);
  }

  focus() {
    this.editor.focus();
  }

  getValue(isPlainText = this.isPlainTextMode) {
    return isPlainText ? this.editor.innerText : this.editor.innerHTML;
  }

  setValue(content, metadata = {}) {
    this.lastRange = null;
    const extPlain = isPlainExtension(metadata.filePath || metadata.title || '');
    this.isPlainTextMode = metadata.mode === 'plain' || metadata.mode === 'rich'
      ? metadata.mode === 'plain'
      : extPlain;

    if (this.isPlainTextMode) {
      this.editor.innerText = sanitizePlainText(content || '');
    } else {
      this.editor.innerHTML = sanitizeRichHtml(content || '');
    }

    if (!metadata.bypassHistory) {
      this.pushHistory();
    }

    this.emitCursor();
    this.dispatchEvent(new CustomEvent('change', {
      detail: { content: this.getValue(this.isPlainTextMode) }
    }));
    this.dispatchEvent(new CustomEvent('modechange', { detail: { isPlainTextMode: this.isPlainTextMode } }));
  }

  toggleMode() {
    const nextPlain = !this.isPlainTextMode;
    const content = this.getValue(!nextPlain);
    this.setValue(content, { mode: nextPlain ? 'plain' : 'rich' });
    return this.isPlainTextMode;
  }

  getPlainText() {
    return this.editor.innerText || '';
  }

  runEditCommand(command, value = null) {
    if (this.isPlainTextMode && RICH_COMMANDS.has(command)) {
      this.dispatchEvent(new CustomEvent('format-blocked', { detail: { command } }));
      return;
    }

    this.restoreSelection();
    this.focus();

    if (command === 'undo') return this.undo();
    if (command === 'redo') return this.redo();

    if (command === 'cut' || command === 'copy' || command === 'paste') {
      this.runClipboard(command);
      return;
    }

    if (command === 'select-all') {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(this.editor);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }

    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);

    if (command === 'clear-format') {
      this.clearFormatting(range);
    } else if (TAG_BY_COMMAND[command]) {
      this.toggleInlineFormat(command, range);
    } else if (command.startsWith('justify')) {
      const align = command.replace('justify', '').toLowerCase();
      this.applyParagraphAlign(align, range);
    } else if (command === 'backColor' || command === 'foreColor') {
      const prop = command === 'backColor' ? 'backgroundColor' : 'color';
      this.applyStyle(prop, value, range);
    } else if (command === 'fontName') {
      this.applyStyle('fontFamily', value, range);
    } else if (command === 'fontSize') {
      this.applyFontSize(value, range);
    }

    this.commitEdit();
  }

  runClipboard(command) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    try {
      if (command === 'paste') {
        document.execCommand('paste');
        this.commitEdit();
        return;
      }
      if (command === 'copy') {
        document.execCommand('copy');
        return;
      }
      if (command === 'cut') {
        document.execCommand('cut');
        this.commitEdit();
      }
    } catch {
      const text = sel.toString();
      if (command === 'copy' || command === 'cut') {
        navigator.clipboard?.writeText(text).catch(() => {});
      }
      if (command === 'cut' && sel.rangeCount) {
        sel.getRangeAt(0).deleteContents();
        this.commitEdit();
      }
      if (command === 'paste') {
        navigator.clipboard?.readText().then((clip) => {
          if (!clip || !sel.rangeCount) return;
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(document.createTextNode(clip));
          this.commitEdit();
        }).catch(() => {});
      }
    }
  }

  commitEdit() {
    this.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  toggleInlineFormat(command, range) {
    const tags = TAG_BY_COMMAND[command].map((t) => t.toLowerCase());
    const tagName = tags[0];

    if (range.collapsed) {
      this.applyStyle(
        command === 'bold' ? 'fontWeight' : command === 'italic' ? 'fontStyle' : 'textDecoration',
        command === 'bold' ? 'bold' : command === 'italic' ? 'italic' : command === 'underline' ? 'underline' : 'line-through',
        range
      );
      return;
    }

    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const wrapper = node?.closest(tags.join(','));

    if (wrapper && this.editor.contains(wrapper) && wrapper.textContent === range.toString()) {
      const parent = wrapper.parentNode;
      while (wrapper.firstChild) parent.insertBefore(wrapper.firstChild, wrapper);
      parent.removeChild(wrapper);
      return;
    }

    const el = document.createElement(tagName);
    el.appendChild(range.extractContents());
    range.insertNode(el);
    const sel = window.getSelection();
    const newRange = document.createRange();
    newRange.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  applyStyle(prop, value, range) {
    const selection = window.getSelection();

    if (range.collapsed) {
      const span = document.createElement('span');
      span.style[prop] = value;
      span.appendChild(document.createTextNode('\u200B'));
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.setStart(span.firstChild, 1);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
      return;
    }

    let container = range.commonAncestorContainer;
    if (container.nodeType === 3) container = container.parentElement;

    if (container !== this.editor &&
        container.tagName === 'SPAN' &&
        selection.toString() === container.textContent) {
      container.style[prop] = value;
      return;
    }

    const span = document.createElement('span');
    span.style[prop] = value;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    selection.removeAllRanges();
    selection.addRange(newRange);
  }

  applyFontSize(sizePt, range = null) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const activeRange = range || selection.getRangeAt(0);
    this.applyStyle('fontSize', `${sizePt}pt`, activeRange);
  }

  applyParagraphAlign(align, range) {
    let node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentElement;
    let block = node.closest('p, div');
    if (!block || block === this.editor || !this.editor.contains(block)) {
      block = this.editor;
    }
    block.style.textAlign = align;
  }

  clearFormatting(range) {
    const selection = window.getSelection();
    const root = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => (
          selection.containsNode(node, true) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        )
      }
    );

    const toUnwrap = [];
    let n;
    while ((n = walker.nextNode())) {
      if (n !== this.editor) toUnwrap.push(n);
      n.removeAttribute('style');
    }

    toUnwrap.forEach((el) => {
      if (['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'FONT'].includes(el.tagName)) {
        const parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    });
  }

  getStats() {
    const selection = window.getSelection();
    let line = 1;
    let column = 1;

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
      } catch {
        // ignore range errors
      }
    }

    const text = this.editor.innerText || '';
    const zoom = Math.round((window.notepad?.window?.getZoom?.() || 1) * 100);

    return {
      cursor: { line, column },
      words: countWords(text),
      chars: text.length,
      zoom,
      isPlainTextMode: this.isPlainTextMode
    };
  }

  getSelectionState() {
    const selection = window.getSelection();
    if (!selection.rangeCount) {
      return {
        bold: false, italic: false, underline: false, strikethrough: false,
        fontSize: '12pt', fontFamily: 'Roboto', align: 'left', backColor: 'transparent'
      };
    }

    const node = selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement;
    const computed = window.getComputedStyle(node);
    const block = node.closest('p, div') || this.editor;

    return {
      bold: computed.fontWeight === 'bold' || parseInt(computed.fontWeight, 10) >= 700 || !!node.closest('b, strong'),
      italic: computed.fontStyle === 'italic' || !!node.closest('i, em'),
      underline: computed.textDecorationLine.includes('underline') || !!node.closest('u'),
      strikethrough: computed.textDecorationLine.includes('line-through') || !!node.closest('s, strike'),
      fontSize: computed.fontSize.includes('px')
        ? `${Math.round(parseFloat(computed.fontSize) * 0.75)}pt`
        : computed.fontSize,
      fontFamily: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
      align: window.getComputedStyle(block).textAlign || 'left',
      backColor: computed.backgroundColor
    };
  }

  emitCursor() {
    this.dispatchEvent(new CustomEvent('cursor', { detail: this.getStats() }));
  }

  getCursorPosition() {
    return this.getStats();
  }
}
