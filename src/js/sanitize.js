import DOMPurify from 'dompurify';

export const PLAIN_EXTENSIONS = new Set(['md', 'log', 'csv']);

const ALLOWED_TAGS = [
  'b', 'i', 'u', 's', 'strike', 'strong', 'em', 'br', 'p', 'div', 'span', 'font'
];

const ALLOWED_ATTR = ['style', 'face', 'size', 'color'];

const ALLOWED_STYLES = [
  'font-size', 'font-family', 'text-align', 'color', 'background-color',
  'font-weight', 'font-style', 'text-decoration'
];

const STYLE_ALLOW = {
  'font-size': /^\d+(?:px|pt)$/,
  'text-align': /^(?:left|center|right|justify)$/,
  color: /^#[0-9a-f]{3,8}$|^rgb\(/i,
  'background-color': /^#[0-9a-f]{3,8}$|^rgb\(/i,
  'font-family': /^.+$/,
  'font-weight': /^(?:normal|bold|[1-9]00)$/,
  'font-style': /^(?:normal|italic)$/,
  'text-decoration': /^(?:none|underline|line-through)$/
};

let hooksInstalled = false;

function installHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'style') return;
    const validated = data.attrValue
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((rule) => {
        const [prop, val] = rule.split(':').map((v) => v.trim());
        if (!prop || !val) return false;
        const pattern = STYLE_ALLOW[prop];
        return pattern ? pattern.test(val) : false;
      });
    data.attrValue = validated.join('; ');
  });
}

export function isPlainExtension(filePathOrTitle = '') {
  const name = String(filePathOrTitle).toLowerCase();
  const ext = name.includes('.') ? name.split('.').pop() : '';
  return PLAIN_EXTENSIONS.has(ext);
}

export function sanitizeRichHtml(html) {
  installHooks();
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_STYLES
  });
}

export function sanitizePlainText(text) {
  if (typeof text !== 'string') return '';
  let finalContent = text;
  if (finalContent.includes('&lt;') && finalContent.includes('&gt;')) {
    const temp = document.createElement('div');
    temp.innerHTML = finalContent;
    const decoded = temp.textContent;
    if (decoded.includes('<') && decoded.includes('>')) {
      temp.innerHTML = sanitizeRichHtml(decoded);
      finalContent = temp.innerText;
    }
  }
  return finalContent.replace(/\0/g, '');
}
