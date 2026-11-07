/* KobunshoSafe UI. All processing is local; see core.js. */
(function () {
  'use strict';
  const KS = window.KS;
  const $ = (id) => document.getElementById(id);
  const app = $('app'), list = $('list'), frame = $('frame'), printFrame = $('printFrame');
  const state = { items: [], current: -1, pool: new KS.UrlPool(), cache: new Map(), loose: null, showRaw: false };

  // ---------- input ----------
  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    hideNotice();
    setBusy(true);
    const errors = [];
    const newBundles = [];
    const looseFiles = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
        try { newBundles.push(...await KS.loadZip(f.name, await f.arrayBuffer())); }
        catch (e) { errors.push(e.message || String(e)); }
      } else looseFiles.push(f);
    }
    if (looseFiles.length) {
      if (!state.loose) state.loose = { name: '個別ファイル', files: new Map() };
      for (const f of looseFiles) {
        const path = KS.normPath(f.webkitRelativePath || f.name);
        state.loose.files.set(path, new Uint8Array(await f.arrayBuffer()));
      }
      // Re-discover loose files each time so newly added XSLs pair with earlier XMLs.
      state.items = state.items.filter((it) => it.bundle !== state.loose);
      newBundles.push(state.loose);
    }
    for (const b of newBundles) {
      if (b.error) { errors.push(`${b.name}: ${b.error}`); continue; }
      const docs = KS.discover(b);
      if (!docs.length) { errors.push(`${b.name}: XML公文書が見つかりませんでした（空のZIP、または対象外のファイルです）。`); continue; }
      state.items.push(...docs);
    }
    state.items.forEach((it, i) => { it.id = i; });
    state.cache.clear();
    renderList();
    setBusy(false);
    if (state.items.length) {
      app.classList.remove('empty');
      const first = state.items.findIndex((it) => it.bundle === newBundles[0] && !it.error);
      await select(first >= 0 ? first : (state.current >= 0 ? state.current : 0));
    }
    if (errors.length) showNotice(errors.join('\n'), 'error');
  }

  function docIndex(bundle, path) {
    const it = state.items.find((x) => x.bundle === bundle && x.path === path);
    return it ? it.id : null;
  }

  // ---------- list ----------
  function renderList() {
    list.textContent = '';
    let lastBundle = null;
    const ok = state.items.filter((it) => !it.error).length;
    $('count').textContent = `${state.items.length}件` + (ok < state.items.length ? `（表示できないもの ${state.items.length - ok}）` : '');
    for (const it of state.items) {
      if (it.bundle !== lastBundle) {
        lastBundle = it.bundle;
        const g = document.createElement('li'); g.className = 'group'; g.textContent = it.bundle.name; list.appendChild(g);
      }
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'item' + (it.error ? ' bad' : '') + (it.id === state.current ? ' active' : '');
      b.dataset.id = it.id;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = it.title || KS.baseName(it.path);
      const meta = document.createElement('span'); meta.className = 'meta';
      const tag = it.kind === 'csv' ? '明細CSV' : it.error ? 'XSLなし/エラー' : it.isKagami ? '鑑（表紙）' : '本文';
      meta.textContent = `${tag} · ${KS.dirOf(it.path) || '/'}`;
      b.append(name, meta);
      b.title = it.path;
      li.appendChild(b); list.appendChild(li);
    }
    $('printAll').disabled = !state.items.some((it) => !it.error);
  }
  list.addEventListener('click', (e) => { const b = e.target.closest('button.item'); if (b) select(+b.dataset.id); });
  list.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const n = Math.max(0, Math.min(state.items.length - 1, state.current + (e.key === 'ArrowDown' ? 1 : -1)));
    select(n).then(() => { const b = list.querySelector(`button[data-id="${n}"]`); if (b) b.focus(); });
  });

  // ---------- render ----------
  async function render(it) {
    if (state.cache.has(it.id)) return state.cache.get(it.id);
    let r;
    if (it.kind === 'csv') r = KS.csvHtml(it);
    else if (it.error) r = { html: KS.rawXmlHtml(it), title: KS.baseName(it.path), missing: [], error: it.error };
    else {
      try { r = KS.finalizeHtml(await KS.transform(it), it, state.pool, docIndex); }
      catch (e) { r = { html: KS.rawXmlHtml(it), title: KS.baseName(it.path), missing: [], error: e.message || String(e) }; it.error = r.error; }
    }
    state.cache.set(it.id, r);
    return r;
  }

  async function select(id) {
    const it = state.items[id];
    if (!it) return;
    state.current = id; state.showRaw = false;
    setBusy(true);
    const r = await render(it);
    if (r.title && !it.title && it.kind === 'xml' && !it.error) it.title = r.title;
    renderList();
    $('docTitle').textContent = it.title || KS.baseName(it.path);
    $('docPath').textContent = `${it.bundle.name} / ${it.path}` + (it.xslPath ? `  ←  ${KS.baseName(it.xslPath)}（${it.pairedBy}）` : '');
    $('raw').hidden = it.kind !== 'xml' || !!it.error;
    $('raw').textContent = 'XMLを表示';
    $('print').disabled = false;
    if (r.error) showNotice(`${KS.baseName(it.path)}: ${r.error}\n元のXMLをそのまま表示しています。`, 'error');
    else if (r.missing.length) showNotice(`ZIP内に見つからない参照があります（画像・外字・CSSなど）: ${r.missing.slice(0, 8).join('、')}${r.missing.length > 8 ? ' ほか' : ''}`, 'warn');
    else hideNotice();
    load(frame, r.html);
    setBusy(false);
  }

  function load(target, html) {
    return new Promise((resolve) => {
      target.onload = () => { wireFrame(target); resolve(); };
      target.srcdoc = html;
    });
  }
  function wireFrame(target) {
    const doc = target.contentDocument;
    if (!doc || target !== frame) return;
    doc.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      if (a.dataset.ksDoc) select(+a.dataset.ksDoc);
      else if (/^https?:/i.test(a.getAttribute('href')) && confirm(`外部サイトを開きますか？\n${a.href}`)) window.open(a.href, '_blank', 'noopener,noreferrer');
    });
  }

  $('raw').addEventListener('click', () => {
    const it = state.items[state.current];
    if (!it) return;
    state.showRaw = !state.showRaw;
    $('raw').textContent = state.showRaw ? '整形表示に戻す' : 'XMLを表示';
    load(frame, state.showRaw ? KS.rawXmlHtml(it) : state.cache.get(it.id).html);
  });

  // ---------- print ----------
  $('print').addEventListener('click', () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { window.print(); } });
  $('printAll').addEventListener('click', async () => {
    setBusy(true);
    const parts = [];
    for (const it of state.items) {
      if (it.error) continue;
      const r = await render(it);
      if (r.error) continue;
      const d = new DOMParser().parseFromString(r.html, 'text/html');
      const styles = [...d.querySelectorAll('style')].map((s) => s.outerHTML).join('');
      // Each document goes into its own page; styles are scoped only by order (see README limits).
      parts.push(`<section class="ks-page">${styles}${d.body ? d.body.innerHTML : ''}</section>`);
    }
    renderList();
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob:; font-src blob: data:"><style>.ks-page{break-after:page;page-break-after:always}.ks-page:last-child{break-after:auto;page-break-after:auto}</style></head><body>${parts.join('\n')}</body></html>`;
    await load(printFrame, html);
    setBusy(false);
    if (!parts.length) return showNotice('印刷できる文書がありません。', 'error');
    printFrame.contentWindow.focus(); printFrame.contentWindow.print();
  });

  // ---------- reset ----------
  $('clear').addEventListener('click', reset);
  function reset() {
    state.pool.revokeAll();
    state.items = []; state.cache.clear(); state.loose = null; state.current = -1;
    frame.srcdoc = ''; printFrame.srcdoc = '';
    list.textContent = ''; $('count').textContent = '0件';
    $('docTitle').textContent = ''; $('docPath').textContent = '';
    $('print').disabled = true; $('printAll').disabled = true; $('raw').hidden = true;
    hideNotice();
    app.classList.add('empty');
    for (const id of ['picker', 'picker2', 'dirpicker']) $(id).value = '';
  }

  // ---------- misc UI ----------
  let noticeTimeout = null;
  function showNotice(msg, kind) {
    const n = $('notice');
    n.textContent = msg;
    n.className = `notice ${kind}`;
    n.hidden = false;
    if (noticeTimeout) clearTimeout(noticeTimeout);
    // Keep error/warn notices visible for 10 seconds
    if (kind === 'error' || kind === 'warn') {
      noticeTimeout = setTimeout(() => { n.hidden = true; noticeTimeout = null; }, 10000);
    }
  }
  function hideNotice() {
    if (noticeTimeout) { clearTimeout(noticeTimeout); noticeTimeout = null; }
    $('notice').hidden = true;
  }
  function setBusy(b) { document.body.classList.toggle('busy', b); }

  for (const id of ['picker', 'picker2', 'dirpicker']) $(id).addEventListener('change', (e) => addFiles(e.target.files));
  const drop = $('drop');
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('picker').click(); } });

  // Test hook (used by test/smoke.mjs): load files programmatically.
  window.KobunshoSafe = { addFiles, select, reset, state };
})();
