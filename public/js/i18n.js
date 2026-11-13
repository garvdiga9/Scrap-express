// Hindi pages: the server already translated the page (lib/i18n.js). This
// translates what scripts add afterwards (form messages, errors, labels),
// from the same dictionary (window.SE_HI, /js/i18n-hi.js) and the same rules.
// Loaded only when the page is in Hindi.
(() => {
  const HI = window.SE_HI;
  if (!HI || document.documentElement.lang !== 'hi-IN') return;

  const normalize = (s) => String(s).replace(/\s+/g, ' ').trim();
  const NUMBERISH = new Set(['n', 'a', 'b', 'km']);
  const placeholderRe = (name) => {
    if (NUMBERISH.has(name)) return '([₹\\d.,\\-]+)';
    if (name === 'x') return '([₹\\d.,()%\\s]+?)';
    return '(.+?)';
  };
  const exact = new Map();
  const lower = new Map();
  const patterns = [];
  Object.entries(HI).forEach(([en, hi]) => {
    const key = normalize(en);
    if (!/\{\w+\}/.test(key)) {
      exact.set(key, hi);
      if (!lower.has(key.toLowerCase())) lower.set(key.toLowerCase(), hi);
      return;
    }
    const names = [];
    let literal = 0;
    const source = key.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) {
        literal += part.length;
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      names.push(m[1]);
      return placeholderRe(m[1]);
    }).join('');
    patterns.push({ re: new RegExp(`^${source}$`), names, hi, literal });
  });
  patterns.sort((p, q) => q.literal - p.literal);

  function translate(text, depth = 0) {
    const key = normalize(text);
    if (!key || !/[A-Za-z]/.test(key)) return null;
    if (exact.has(key)) return exact.get(key);
    if (depth > 0 && lower.has(key.toLowerCase())) return lower.get(key.toLowerCase());
    if (depth > 2) return null;
    for (const p of patterns) {
      const m = p.re.exec(key);
      if (m) {
        let out = p.hi;
        p.names.forEach((name, i) => {
          const value = m[i + 1];
          out = out.split(`{${name}}`).join(translate(value, depth + 1) ?? value);
        });
        return out;
      }
    }
    return null;
  }
  window.SETranslate = (text) => translate(text) ?? text;

  const SKIP = 'script, style, textarea, code, pre, [contenteditable], [data-no-translate]';
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  function translateTextNode(node) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const value = node.nodeValue;
    const hi = translate(value);
    if (hi == null) return;
    const lead = value.match(/^\s*/)[0];
    const trail = value.match(/\s*$/)[0];
    node.nodeValue = `${lead}${hi}${trail}`;
  }
  function translateAttrs(el) {
    if (el.closest(SKIP)) return;
    ATTRS.forEach((name) => {
      const value = el.getAttribute(name);
      if (!value) return;
      const hi = translate(value);
      if (hi != null) el.setAttribute(name, hi);
    });
  }
  function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      translateTextNode(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttrs(root);
    root.querySelectorAll('[placeholder], [title], [aria-label], [alt]').forEach(translateAttrs);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateTextNode);
  }

  // Everything scripts add or change from now on. Translating changes the
  // text again, but Hindi isn't in the dictionary, so it stops there.
  new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === 'characterData') translateTextNode(m.target);
      else if (m.type === 'attributes') translateAttrs(m.target);
      else m.addedNodes.forEach(translateTree);
    });
  }).observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS,
  });

  // Pages the server didn't translate (the staff app) ask for the whole page.
  if (document.documentElement.hasAttribute('data-translate-all')) {
    const all = () => translateTree(document.body);
    if (document.body) all();
    else document.addEventListener('DOMContentLoaded', all);
  }

  // Browser alerts and confirmations.
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = (message) => nativeAlert(window.SETranslate(String(message)));
  window.confirm = (message) => nativeConfirm(window.SETranslate(String(message)));
})();
