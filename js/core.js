/* KobunshoSafe core: unzip, decode, pair XML↔XSL, transform, rewrite resources.
 * Runs entirely in the browser. Nothing here touches the network. */
(function (global) {
  'use strict';

  const XSLT_NS = 'http://www.w3.org/1999/XSL/Transform';
  const MIME = {
    png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp',
    svg: 'image/svg+xml', webp: 'image/webp', css: 'text/css', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject', xml: 'application/xml',
    xsl: 'application/xml', csv: 'text/csv', txt: 'text/plain', pdf: 'application/pdf',
  };

  // ---------- paths ----------
  const ext = (p) => { const m = /\.([^./]+)$/.exec(p); return m ? m[1].toLowerCase() : ''; };
  const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i + 1); };
  const baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  const stem = (p) => baseName(p).replace(/\.[^.]+$/, '');
  const normPath = (p) => {
    const out = [];
    for (const seg of p.replace(/\\/g, '/').split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') out.pop(); else out.push(seg);
    }
    return out.join('/');
  };
  /** Resolve a reference found in `fromPath` to a path inside the bundle, or null if external. */
  function resolveRef(fromPath, ref) {
    if (!ref) return null;
    ref = ref.trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null; // http:, data:, blob:, mailto:, #frag
    let clean = ref.split('#')[0].split('?')[0];
    try { clean = decodeURIComponent(clean); } catch (_) { /* keep raw */ }
    if (!clean) return null;
    return clean.startsWith('/') ? normPath(clean) : normPath(dirOf(fromPath) + clean);
  }

  // ---------- encoding ----------
  const LABELS = { 'shift_jis': 'shift_jis', 'shift-jis': 'shift_jis', 'sjis': 'shift_jis', 'x-sjis': 'shift_jis',
    'windows-31j': 'shift_jis', 'ms932': 'shift_jis', 'cp932': 'shift_jis', 'euc-jp': 'euc-jp',
    'iso-2022-jp': 'iso-2022-jp', 'utf-8': 'utf-8', 'utf8': 'utf-8', 'utf-16': 'utf-16le' };
  function sniffEncoding(bytes) {
    if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) return 'utf-8';
    if (bytes[0] === 0xFF && bytes[1] === 0xFE) return 'utf-16le';
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) return 'utf-16be';
    const head = String.fromCharCode.apply(null, bytes.subarray(0, 256));
    const m = /^\s*<\?xml[^?]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
    if (m) return LABELS[m[1].toLowerCase()] || m[1].toLowerCase();
    return null;
  }
  /** Decode bytes honoring BOM / XML declaration; fall back UTF-8 → Shift_JIS. */
  function decodeText(bytes, hint) {
    const enc = hint || sniffEncoding(bytes);
    if (enc) {
      try { return { text: new TextDecoder(enc).decode(bytes).replace(/^\uFEFF/, ''), encoding: enc }; }
      catch (_) { /* unknown label → fall through */ }
    }
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''), encoding: 'utf-8' }; }
    catch (_) { return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' }; }
  }
  /** ZIP entry names: UTF-8 if valid, else Shift_JIS (Windows-made ZIPs). */
  function decodeFileName(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes, (c) => (typeof c === 'string' ? c.charCodeAt(0) : c));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (_) { return new TextDecoder('shift_jis').decode(u8); }
  }
  // Text is already decoded, so drop the declaration's encoding to stop the parser second-guessing.
  const stripEncodingDecl = (t) => t.replace(/^(\s*<\?xml[^?]*?)\sencoding\s*=\s*["'][^"']*["']/i, '$1');

  function parseXml(text, path) {
    const doc = new DOMParser().parseFromString(stripEncodingDecl(text), 'application/xml');
    const err = doc.getElementsByTagName('parsererror')[0];
    if (err) {
      const msg = (err.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      throw new KsError(`XMLとして読めませんでした（${baseName(path)}）: ${msg}`);
    }
    return doc;
  }
  class KsError extends Error {}

  // ---------- bundle loading ----------
  /** A Bundle = one source (a ZIP, or the set of loose files) with a path → bytes map. */
  async function loadZip(name, data, depth = 0) {
    if (!global.JSZip) throw new KsError('JSZip が読み込まれていません');
    let zip;
    try { zip = await global.JSZip.loadAsync(data, { decodeFileName }); }
    catch (e) { throw new KsError(`ZIPを開けませんでした（${name}）: ${e.message || e}`); }
    const files = new Map();
    const nested = [];
    const entries = [];
    zip.forEach((p, f) => { if (!f.dir) entries.push([p, f]); });
    for (const [p, f] of entries) {
      const path = normPath(p);
      if (/^__MACOSX\//.test(path) || /(^|\/)\.DS_Store$/.test(path)) continue;
      const bytes = await f.async('uint8array');
      if (ext(path) === 'zip' && depth < 2) nested.push([path, bytes]); else files.set(path, bytes);
    }
    const bundles = [{ name, files }];
    for (const [p, bytes] of nested) {
      try { bundles.push(...await loadZip(`${name} › ${p}`, bytes, depth + 1)); }
      catch (e) { bundles.push({ name: `${name} › ${p}`, files: new Map(), error: e.message }); }
    }
    return bundles;
  }

  /** Case-insensitive lookup (Windows-made bundles often differ in case). */
  function lookup(files, path) {
    if (path == null) return null;
    if (files.has(path)) return path;
    const lower = path.toLowerCase();
    for (const k of files.keys()) if (k.toLowerCase() === lower) return k;
    return null;
  }

  // ---------- discovery & pairing ----------
  function stylesheetPI(doc) {
    for (const n of doc.childNodes) {
      if (n.nodeType === 7 && n.target === 'xml-stylesheet') {
        const type = (/type\s*=\s*["']([^"']*)["']/.exec(n.data) || [])[1] || '';
        const href = (/href\s*=\s*["']([^"']*)["']/.exec(n.data) || [])[1];
        if (href && (!type || /xsl|xml/i.test(type))) return href;
      }
    }
    return null;
  }
  const isXslDoc = (doc) => doc.documentElement && doc.documentElement.namespaceURI === XSLT_NS;

  /** Find every document in a bundle and pick its stylesheet. */
  function discover(bundle) {
    const { files } = bundle;
    const docs = [];
    const xslPaths = [...files.keys()].filter((p) => ext(p) === 'xsl' || ext(p) === 'xslt');
    for (const path of [...files.keys()].sort(naturalCompare)) {
      const e = ext(path);
      if (e === 'csv') { docs.push({ kind: 'csv', path, bundle }); continue; }
      if (e !== 'xml') continue;
      const item = { kind: 'xml', path, bundle, xslPath: null, pairedBy: null, error: null };
      try {
        const { text, encoding } = decodeText(files.get(path));
        const doc = parseXml(text, path);
        if (isXslDoc(doc)) continue; // stylesheet saved as .xml
        item.xmlText = text; item.encoding = encoding; item.xmlDoc = doc;
        const href = stylesheetPI(doc);
        const viaPI = href ? lookup(files, resolveRef(path, href)) : null;
        if (viaPI) { item.xslPath = viaPI; item.pairedBy = 'xml-stylesheet'; }
        else {
          const same = xslPaths.find((x) => dirOf(x) === dirOf(path) && stem(x).toLowerCase() === stem(path).toLowerCase());
          const inDir = xslPaths.filter((x) => dirOf(x) === dirOf(path));
          if (same) { item.xslPath = same; item.pairedBy = '同名'; }
          else if (inDir.length === 1) { item.xslPath = inDir[0]; item.pairedBy = 'フォルダ内唯一のXSL'; }
          else if (href) item.error = `指定されたスタイルシート「${href}」がZIP内に見つかりません。`;
          else if (inDir.length > 1) item.error = 'スタイルシートの指定（xml-stylesheet）がなく、同じフォルダのXSLも複数あるため組み合わせを決められませんでした。署名情報などの補助ファイルの可能性があります。';
          else item.error = '対応するXSL（スタイルシート）がありません。署名情報などの補助ファイルの可能性があります。';
        }
      } catch (err) { item.error = err.message || String(err); }
      docs.push(item);
    }
    // 鑑（表紙）first, then the rest in natural order.
    const isKagami = (d) => d.xslPath && /kagami/i.test(baseName(d.xslPath));
    docs.forEach((d) => { d.isKagami = !!isKagami(d); });
    docs.sort((a, b) => (b.isKagami - a.isKagami) || ((a.kind === 'csv') - (b.kind === 'csv')) || naturalCompare(a.path, b.path));
    return docs;
  }
  const collator = new Intl.Collator('ja', { numeric: true });
  const naturalCompare = (a, b) => collator.compare(a, b);

  // ---------- stylesheet preparation ----------
  /** Inline xsl:include / xsl:import from the bundle (the polyfill's sync API cannot fetch). */
  function loadStylesheet(files, xslPath, seen = new Set()) {
    if (seen.has(xslPath)) throw new KsError(`XSLの読み込みが循環しています: ${baseName(xslPath)}`);
    seen.add(xslPath);
    const { text } = decodeText(files.get(xslPath));
    const doc = parseXml(text, xslPath);
    if (!isXslDoc(doc)) throw new KsError(`${baseName(xslPath)} はXSLTスタイルシートではありません。`);
    const root = doc.documentElement;
    const kids = [...root.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === XSLT_NS &&
      (n.localName === 'include' || n.localName === 'import'));
    let importAnchor = null;
    for (const el of kids) {
      const href = el.getAttribute('href');
      const target = lookup(files, resolveRef(xslPath, href));
      if (!target) throw new KsError(`${baseName(xslPath)} が読み込む「${href}」がZIP内に見つかりません。`);
      const sub = loadStylesheet(files, target, new Set(seen)).documentElement;
      for (const a of [...sub.attributes]) {
        if ((a.name.startsWith('xmlns:') || a.name === 'exclude-result-prefixes') && !root.hasAttribute(a.name)) root.setAttribute(a.name, a.value);
      }
      const frag = doc.createDocumentFragment();
      for (const c of [...sub.childNodes]) frag.appendChild(doc.importNode(c, true));
      if (el.localName === 'import') {
        // Imported rules have lower precedence: place them first (later rules win in libxslt).
        const ref = importAnchor ? importAnchor.nextSibling : root.firstChild;
        const last = frag.lastChild;
        root.insertBefore(frag, ref); el.remove();
        importAnchor = last || importAnchor;
      } else el.replaceWith(frag);
    }
    // Output is consumed as a JS string, so force UTF-8 to avoid Shift_JIS round-trips.
    for (const o of root.getElementsByTagNameNS(XSLT_NS, 'output')) if (o.hasAttribute('encoding')) o.setAttribute('encoding', 'UTF-8');
    return doc;
  }

  // ---------- transform ----------
  async function transform(item) {
    if (global.xsltPolyfillReady) await global.xsltPolyfillReady();
    const xsl = loadStylesheet(item.bundle.files, item.xslPath);
    const proc = new global.XSLTProcessor();
    try { proc.importStylesheet(xsl); }
    catch (e) { throw new KsError(`XSLを読み込めませんでした（${baseName(item.xslPath)}）: ${e.message || e}`); }
    let out;
    try { out = proc.transformToDocument(item.xmlDoc); }
    catch (e) { throw new KsError(`変換に失敗しました（${baseName(item.path)} × ${baseName(item.xslPath)}）: ${e.message || e}`); }
    if (!out || !out.documentElement) throw new KsError(`変換結果が空でした（${baseName(item.path)}）。`);
    const err = out.getElementsByTagName('parsererror')[0];
    if (err) throw new KsError(`変換結果を表示できませんでした: ${(err.textContent || '').trim().slice(0, 200)}`);
    let html;
    if (out.documentElement.localName.toLowerCase() === 'html' || out.contentType === 'text/html') html = '<!DOCTYPE html>' + out.documentElement.outerHTML;
    else if (out.contentType === 'text/plain' || out.documentElement.localName === 'pre') html = `<!DOCTYPE html><pre>${escapeHtml(out.documentElement.textContent)}</pre>`;
    else html = '<!DOCTYPE html>' + new XMLSerializer().serializeToString(out); // XHTML or other XML
    return html;
  }

  // ---------- resource rewriting ----------
  class UrlPool {
    constructor() { this.byBundle = new Map(); this.count = 0; }
    get(files, path) {
      let m = this.byBundle.get(files);
      if (!m) { m = new Map(); this.byBundle.set(files, m); }
      if (m.has(path)) return m.get(path);
      const type = MIME[ext(path)] || 'application/octet-stream';
      const url = URL.createObjectURL(new Blob([files.get(path)], { type }));
      m.set(path, url); this.count++;
      return url;
    }
    revokeAll() {
      for (const m of this.byBundle.values()) for (const u of m.values()) URL.revokeObjectURL(u);
      this.byBundle.clear(); this.count = 0;
    }
  }

  function rewriteCss(css, cssPath, files, pool, missing, depth = 0) {
    css = css.replace(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?\s*;/gi, (m, ref) => {
      const p = lookup(files, resolveRef(cssPath, ref));
      if (!p || depth > 3) { if (!p) missing.add(ref); return ''; }
      return rewriteCss(decodeText(files.get(p)).text, p, files, pool, missing, depth + 1);
    });
    return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (m, q, ref) => {
      if (/^(data|blob):/i.test(ref)) return m;
      const p = lookup(files, resolveRef(cssPath, ref));
      if (!p) { if (!/^[a-z]+:/i.test(ref)) missing.add(ref); return m; }
      return `url("${pool.get(files, p)}")`;
    });
  }

  /** Make a self-contained, script-free HTML document for a sandboxed iframe. */
  function finalizeHtml(html, item, pool, docIndex) {
    const files = item.bundle.files;
    const missing = new Set();
    const d = new DOMParser().parseFromString(html, 'text/html');
    d.querySelectorAll('script, iframe, frame, frameset, object, embed, applet, meta[http-equiv], base').forEach((n) => n.remove());
    for (const el of d.querySelectorAll('*')) {
      for (const a of [...el.attributes]) {
        if (/^on/i.test(a.name)) el.removeAttribute(a.name);
        else if (/^\s*javascript:/i.test(a.value)) el.setAttribute(a.name, '#');
      }
    }
    const swap = (el, attr) => {
      const ref = el.getAttribute(attr);
      if (!ref || /^(data|blob):/i.test(ref)) return;
      const p = lookup(files, resolveRef(item.path, ref));
      if (p) el.setAttribute(attr, pool.get(files, p));
      else if (!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(ref)) missing.add(ref);
    };
    d.querySelectorAll('img[src], input[src], image[href], [background]').forEach((el) => {
      if (el.hasAttribute('src')) swap(el, 'src');
      if (el.hasAttribute('background')) swap(el, 'background');
      if (el.hasAttribute('href')) swap(el, 'href');
    });
    d.querySelectorAll('link[rel~="stylesheet" i][href]').forEach((el) => {
      const ref = el.getAttribute('href');
      const p = lookup(files, resolveRef(item.path, ref));
      if (!p) { if (!/^[a-z]+:|^\/\//i.test(ref)) missing.add(ref); el.remove(); return; }
      const st = d.createElement('style');
      st.textContent = rewriteCss(decodeText(files.get(p)).text, p, files, pool, missing);
      if (el.media) st.media = el.media;
      el.replaceWith(st);
    });
    d.querySelectorAll('style').forEach((st) => { st.textContent = rewriteCss(st.textContent, item.path, files, pool, missing); });
    d.querySelectorAll('[style]').forEach((el) => el.setAttribute('style', rewriteCss(el.getAttribute('style'), item.path, files, pool, missing)));
    // In-bundle links (e.g. 鑑 → 本文) are marked so the app can open them in the viewer.
    d.querySelectorAll('a[href]').forEach((a) => {
      const p = lookup(files, resolveRef(item.path, a.getAttribute('href')));
      if (p && docIndex) { const id = docIndex(item.bundle, p); if (id != null) a.setAttribute('data-ks-doc', String(id)); }
    });
    const head = d.head || d.documentElement.insertBefore(d.createElement('head'), d.body);
    const csp = d.createElement('meta');
    csp.setAttribute('http-equiv', 'Content-Security-Policy');
    csp.setAttribute('content', "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:; media-src blob: data:");
    const cs = d.createElement('meta'); cs.setAttribute('charset', 'utf-8');
    head.prepend(cs, csp);
    const title = (d.title || (d.querySelector('h1, h2') || {}).textContent || '').replace(/\s+/g, ' ').trim();
    return { html: '<!DOCTYPE html>\n' + d.documentElement.outerHTML, title, missing: [...missing] };
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function csvHtml(item) {
    const { text, encoding } = decodeText(item.bundle.files.get(item.path));
    const rows = parseCsv(text);
    const body = rows.map((r, i) => `<tr>${r.map((c) => `<${i ? 'td' : 'th'}>${escapeHtml(c)}</${i ? 'td' : 'th'}>`).join('')}</tr>`).join('\n');
    return { html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHtml(baseName(item.path))}</title>
<style>body{font:13px/1.5 system-ui,sans-serif;margin:16px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:3px 8px;white-space:nowrap}th{background:#f1efe9}caption{text-align:left;color:#666;padding-bottom:6px}</style></head>
<body><table><caption>${escapeHtml(baseName(item.path))}（${rows.length}行・${encoding}）</caption>${body}</table></body></html>`, title: baseName(item.path), missing: [] };
  }

  /** Fallback: show raw XML as readable text when there is no stylesheet. */
  function rawXmlHtml(item) {
    const text = item.xmlText != null ? item.xmlText : decodeText(item.bundle.files.get(item.path)).text;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{margin:16px}pre{white-space:pre-wrap;word-break:break-all;font:12px/1.5 ui-monospace,monospace}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
  }

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  global.KS = { loadZip, discover, transform, finalizeHtml, csvHtml, rawXmlHtml, UrlPool, decodeText, decodeFileName,
    resolveRef, normPath, baseName, dirOf, ext, escapeHtml, KsError };
})(window);
