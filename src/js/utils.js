export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  if (options.type) element.type = options.type;
  if (options.title) element.title = options.title;
  if (options.ariaLabel) element.setAttribute('aria-label', options.ariaLabel);
  if (options.role) element.setAttribute('role', options.role);
  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      element.dataset[key] = value;
    });
  }
  return element;
}

export function debounce(callback, delay = 250) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

export function generateId(prefix = 'tab') {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}-${Date.now().toString(36)}-${random[0].toString(36)}${random[1].toString(36)}`;
}

export function getFileName(filePath) {
  if (!filePath) return 'Untitled';
  return String(filePath).split(/[/\\]/).pop() || 'Untitled';
}

export function detectFileType(filePath, title = '') {
  const name = (filePath || title || '').toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  const types = {
    txt: 'Plain Text',
    md: 'Markdown',
    json: 'JSON',
    js: 'JavaScript',
    html: 'HTML',
    css: 'CSS',
    csv: 'CSV',
    log: 'Log',
    xml: 'XML',
    yaml: 'YAML',
    yml: 'YAML'
  };
  return types[ext] || 'Plain Text';
}

export function countWords(text) {
  const matches = String(text).trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function safeText(value, maxLength = 20 * 1024 * 1024) {
  return typeof value === 'string' ? value.slice(0, maxLength).replace(/\0/g, '') : '';
}

export function formatError(error, fallback = 'Something went wrong.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
}
