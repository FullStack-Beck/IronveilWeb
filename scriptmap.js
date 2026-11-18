/* Ironveil Dev Portal — Script Map add-on
   Include in admin.html just before </body>:  <script src="scriptmap.js"></script>
   Needs the `sb` Supabase client from admin.html and the `script_maps` table. */
(() => {
  const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.esm.min.mjs';
  const LEFT  = [['||','exactly one'],['|o','zero or one'],['}o','zero or many'],['}|','one or many']];
  const RIGHT = [['||','exactly one'],['o|','zero or one'],['o{','zero or many'],['|{','one or many']];
  const TYPES = ['ref','net','method','event','enum','int','float','bool','string','list','prop','note','comp'];

  let maps = [], cur = 0, mermaid = null, loaded = false, rid = 0, timer = null, zoom = 1;

  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  const ident = s => String(s || '').trim().replace(/\s+/g, '_').replace(/[^\w]/g, '');
  const blank = () => ({ entities: [], rels: [] });
  const data = () => maps[cur].data;

  /* ── Inject nav + page + styles ─────────────────────────── */
  const style = document.createElement('style');
  style.textContent = `
  .sm-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;align-items:center}
  .sm-tab{font-family:'Cinzel',serif;font-size:11px;letter-spacing:.08em;padding:7px 14px;border:1px solid var(--border2);background:transparent;color:var(--ink3);cursor:pointer}
  .sm-tab.active{background:var(--gold);color:var(--parch);border-color:var(--gold)}
  .sm-tab.dirty::after{content:' •'}
  .sm-layout{display:grid;grid-template-columns:minmax(340px,440px) 1fr;gap:22px;align-items:start}
  @media(max-width:1100px){.sm-layout{grid-template-columns:1fr}}
  .sm-ent{border:1px solid var(--border2);background:rgba(255,255,255,.35);padding:12px;margin-bottom:12px}
  .sm-row{display:flex;gap:6px;margin-bottom:6px;align-items:center}
  .sm-row input,.sm-row select{min-width:0;background:rgba(255,255,255,.55);border:1px solid var(--border2);padding:6px 8px;font-family:'Crimson Pro',serif;font-size:15px;color:var(--ink);outline:none}
  .sm-row input:focus,.sm-row select:focus{border-color:var(--gold2)}
  .sm-name{flex:1;font-family:'Cinzel',serif !important;color:var(--gold) !important;font-size:13px !important}
  .sm-x{background:none;border:none;color:var(--ink4);cursor:pointer;font-size:15px;padding:2px 6px}
  .sm-x:hover{color:var(--ember)}
  .sm-rel{flex-wrap:wrap;border-bottom:1px dashed var(--border);padding-bottom:8px;margin-bottom:8px}
  .sm-canvas{overflow:auto;min-height:420px;padding:18px;background:rgba(255,255,255,.3)}
  .sm-canvas svg{max-width:none}
  .sm-src{width:100%;min-height:200px;font-family:'JetBrains Mono',monospace;font-size:12px;background:rgba(255,255,255,.55);border:1px solid var(--border2);padding:10px;color:var(--ink);resize:vertical;outline:none}
  .sm-err{color:var(--ember);font-family:'Cinzel',serif;font-size:11px;padding:12px}
  .sm-actions{display:flex;gap:8px;flex-wrap:wrap}`;
  document.head.appendChild(style);

  const navBtn = document.createElement('button');
  navBtn.className = 'nav-item';
  navBtn.innerHTML = '<span class="nav-icon">◇</span><span>Script Map</span>';
  navBtn.onclick = () => window.showPage('scriptmap', navBtn);
  document.querySelector('.sidebar-nav').appendChild(navBtn);

  const page = document.createElement('div');
  page.className = 'page';
  page.id = 'page-scriptmap';
  page.innerHTML = `
    <div class="sm-tabs" id="sm-tabs"></div>
    <div class="sm-layout">
      <div>
        <div class="panel"><div class="panel-header"><div class="panel-title">View</div>
          <div class="sm-actions">
            <button class="btn sm" id="sm-save"><span>Save</span></button>
            <button class="btn danger sm" id="sm-del"><span>Delete</span></button>
          </div></div>
          <div class="panel-body"><div class="field" style="margin:0"><label>View Name</label><input id="sm-viewname"></div></div>
        </div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Scripts</div>
          <button class="btn success sm" id="sm-add-ent"><span>+ Script</span></button></div>
          <div class="panel-body" id="sm-ents"></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Relationships</div>
          <button class="btn success sm" id="sm-add-rel"><span>+ Relationship</span></button></div>
          <div class="panel-body" id="sm-rels"></div></div>
        <div class="panel"><div class="panel-header"><div class="panel-title">Mermaid Source</div>
          <div class="sm-actions">
            <button class="btn secondary sm" id="sm-copy"><span>Copy</span></button>
            <button class="btn sm" id="sm-apply"><span>Apply to editor</span></button>
          </div></div>
          <div class="panel-body"><textarea class="sm-src" id="sm-src" spellcheck="false" placeholder="Paste a Mermaid erDiagram here, then Apply to editor"></textarea></div></div>
      </div>
      <div class="panel"><div class="panel-header"><div class="panel-title">Diagram</div>
        <div class="sm-actions">
          <button class="btn secondary sm" id="sm-zout"><span>−</span></button>
          <button class="btn secondary sm" id="sm-zin"><span>+</span></button>
          <button class="btn secondary sm" id="sm-svg"><span>⬇ SVG</span></button>
        </div></div>
        <div class="sm-canvas" id="sm-canvas"></div></div>
    </div>
    <datalist id="sm-types">${TYPES.map(t => `<option value="${t}">`).join('')}</datalist>`;
  document.querySelector('.content').appendChild(page);

  const $ = id => document.getElementById(id);

  /* ── Mermaid source <-> model ───────────────────────────── */
  function toSource(d) {
    const out = ['erDiagram'];
    d.entities.forEach(e => {
      const n = ident(e.name); if (!n) return;
      const fs = e.fields.filter(f => ident(f.name));
      if (!fs.length) { out.push(`  ${n}`); return; }
      out.push(`  ${n} {`);
      fs.forEach(f => out.push(`    ${ident(f.type) || 'ref'} ${ident(f.name)}${f.note ? ` "${f.note.replace(/"/g, "'")}"` : ''}`));
      out.push('  }');
    });
    d.rels.forEach(r => {
      if (!ident(r.a) || !ident(r.b)) return;
      out.push(`  ${ident(r.a)} ${r.l}${r.dash || '--'}${r.r} ${ident(r.b)} : "${(r.label || 'relates').replace(/"/g, "'")}"`);
    });
    return out.join('\n');
  }

  function parse(src) {
    const d = blank(); let cur = null, m;
    const ensure = n => { if (!d.entities.find(e => e.name === n)) d.entities.push({ name: n, fields: [] }); };
    for (let line of src.split('\n')) {
      line = line.trim();
      if (!line || line === 'erDiagram') continue;
      if (cur) {
        if (line === '}') { cur = null; continue; }
        if ((m = line.match(/^(\S+)\s+(\S+)(?:\s+"([^"]*)")?/))) cur.fields.push({ type: m[1], name: m[2], note: m[3] || '' });
        continue;
      }
      if ((m = line.match(/^(\w+)\s*\{$/))) { cur = { name: m[1], fields: [] }; d.entities.push(cur); continue; }
      if ((m = line.match(/^(\w+)\s+(\|\||\|o|\}o|\}\|)(--|\.\.)(\|\||o\||o\{|\|\{)\s+(\w+)\s*:\s*"?([^"]*)"?\s*$/))) {
        ensure(m[1]); ensure(m[5]);
        d.rels.push({ a: m[1], l: m[2], dash: m[3], r: m[4], b: m[5], label: m[6] });
        continue;
      }
      if ((m = line.match(/^(\w+)$/))) ensure(m[1]);
    }
    return d;
  }

  /* ── Rendering ──────────────────────────────────────────── */
  function renderTabs() {
    $('sm-tabs').innerHTML = maps.map((m, i) =>
      `<button class="sm-tab ${i === cur ? 'active' : ''} ${m._dirty ? 'dirty' : ''}" data-i="${i}">${esc(m.name)}</button>`).join('') +
      `<button class="btn success sm" id="sm-new"><span>+ New View</span></button>`;
    $('sm-tabs').querySelectorAll('.sm-tab').forEach(b => b.onclick = () => { cur = +b.dataset.i; renderAll(); });
    $('sm-new').onclick = newView;
  }

  function renderEditor() {
    const d = data();
    $('sm-viewname').value = maps[cur].name;
    $('sm-ents').innerHTML = d.entities.map((e, i) => `
      <div class="sm-ent" data-e="${i}">
        <div class="sm-row"><input class="sm-name" data-k="ename" value="${esc(e.name)}" placeholder="ScriptName">
          <button class="sm-x" data-act="del-ent" title="Remove script">✕</button></div>
        ${e.fields.map((f, j) => `
          <div class="sm-row" data-f="${j}">
            <input data-k="ftype" list="sm-types" value="${esc(f.type)}" placeholder="type" style="width:76px">
            <input data-k="fname" value="${esc(f.name)}" placeholder="name" style="flex:1">
            <input data-k="fnote" value="${esc(f.note)}" placeholder="note" style="flex:1">
            <button class="sm-x" data-act="del-f">✕</button></div>`).join('')}
        <button class="btn secondary sm" data-act="add-f"><span>+ Field</span></button>
      </div>`).join('') || '<div class="empty-state">No scripts yet.</div>';

    const opts = sel => d.entities.map(e => `<option ${e.name === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    const co = (arr, v) => arr.map(([s, t]) => `<option value="${esc(s)}" ${s === v ? 'selected' : ''}>${esc(s)}  ${t}</option>`).join('');
    $('sm-rels').innerHTML = d.rels.map((r, i) => `
      <div class="sm-row sm-rel" data-r="${i}">
        <select data-k="a" style="flex:1">${opts(r.a)}</select>
        <select data-k="l">${co(LEFT, r.l)}</select>
        <select data-k="dash"><option value="--" ${r.dash !== '..' ? 'selected' : ''}>solid</option><option value=".." ${r.dash === '..' ? 'selected' : ''}>dotted</option></select>
        <select data-k="r">${co(RIGHT, r.r)}</select>
        <select data-k="b" style="flex:1">${opts(r.b)}</select>
        <input data-k="label" value="${esc(r.label)}" placeholder="label" style="flex-basis:100%">
        <button class="sm-x" data-act="del-rel">✕ remove</button>
      </div>`).join('') || '<div class="empty-state">No relationships yet.</div>';
  }

  async function renderDiagram() {
    const src = toSource(data());
    if (document.activeElement !== $('sm-src')) $('sm-src').value = src;
    const box = $('sm-canvas');
    if (!data().entities.length) { box.innerHTML = '<div class="empty-state">Add a script to begin.</div>'; return; }
    try {
      if (!mermaid) {
        mermaid = (await import(MERMAID_URL)).default;
        mermaid.initialize({ startOnLoad: false, theme: 'base', fontFamily: 'Crimson Pro, serif', themeVariables: {
          primaryColor: '#e8dcc0', primaryBorderColor: '#8b6914', primaryTextColor: '#1e160c',
          lineColor: '#5a4030', textColor: '#1e160c', fontSize: '14px',
          attributeBackgroundColorOdd: '#f0e8d0', attributeBackgroundColorEven: '#e8dcc0' } });
      }
      const { svg } = await mermaid.render('sm-svg-' + (++rid), src);
      box.innerHTML = svg;
      box.firstElementChild.style.zoom = zoom;
    } catch (err) {
      document.querySelectorAll('[id^="dsm-svg-"]').forEach(n => n.remove());
      box.innerHTML = `<div class="sm-err">Could not draw diagram: ${esc(err.message || err)}</div>`;
    }
  }
  const queueDiagram = () => { clearTimeout(timer); timer = setTimeout(renderDiagram, 250); };
  const renderAll = () => { renderTabs(); renderEditor(); renderDiagram(); };
  const dirty = () => { maps[cur]._dirty = true; renderTabs(); queueDiagram(); };

  /* ── Editor events ──────────────────────────────────────── */
  $('sm-ents').addEventListener('input', ev => {
    const k = ev.target.dataset.k, entEl = ev.target.closest('.sm-ent'); if (!k || !entEl) return;
    const e = data().entities[+entEl.dataset.e];
    if (k === 'ename') {
      const old = e.name; e.name = ev.target.value;
      data().rels.forEach(r => { if (r.a === old) r.a = e.name; if (r.b === old) r.b = e.name; });
    } else {
      const f = e.fields[+ev.target.closest('[data-f]').dataset.f];
      f[{ ftype: 'type', fname: 'name', fnote: 'note' }[k]] = ev.target.value;
    }
    dirty();
  });
  $('sm-ents').addEventListener('change', ev => { if (ev.target.dataset.k === 'ename') renderEditor(); });
  $('sm-ents').addEventListener('click', ev => {
    const act = ev.target.dataset.act; if (!act) return;
    const entEl = ev.target.closest('.sm-ent'), e = data().entities[+entEl.dataset.e];
    if (act === 'add-f') e.fields.push({ type: 'ref', name: '', note: '' });
    if (act === 'del-f') e.fields.splice(+ev.target.closest('[data-f]').dataset.f, 1);
    if (act === 'del-ent') {
      if (!confirm(`Remove ${e.name || 'this script'} and its relationships?`)) return;
      data().entities.splice(+entEl.dataset.e, 1);
      data().rels = data().rels.filter(r => r.a !== e.name && r.b !== e.name);
    }
    renderEditor(); dirty();
  });
  $('sm-add-ent').onclick = () => {
    data().entities.push({ name: 'NewScript', fields: [{ type: 'ref', name: '', note: '' }] });
    renderEditor(); dirty();
  };

  $('sm-rels').addEventListener('input', ev => {
    const k = ev.target.dataset.k; if (!k) return;
    data().rels[+ev.target.closest('[data-r]').dataset.r][k] = ev.target.value; dirty();
  });
  $('sm-rels').addEventListener('click', ev => {
    if (ev.target.dataset.act !== 'del-rel') return;
    data().rels.splice(+ev.target.closest('[data-r]').dataset.r, 1); renderEditor(); dirty();
  });
  $('sm-add-rel').onclick = () => {
    const es = data().entities;
    if (es.length < 1) { window.toast('Add a script first.', true); return; }
    data().rels.push({ a: es[0].name, l: '||', dash: '--', r: 'o{', b: (es[1] || es[0]).name, label: 'relates' });
    renderEditor(); dirty();
  };

  $('sm-viewname').oninput = e => { maps[cur].name = e.target.value || 'Untitled'; dirty(); };
  $('sm-apply').onclick = () => {
    const d = parse($('sm-src').value);
    if (!d.entities.length) { window.toast('Nothing recognised in that source.', true); return; }
    maps[cur].data = d; renderEditor(); dirty(); renderDiagram();
    window.toast('Source applied to editor.');
  };
  $('sm-copy').onclick = () => { navigator.clipboard.writeText(toSource(data())); window.toast('Mermaid source copied.'); };
  $('sm-zin').onclick  = () => { zoom = Math.min(2.5, zoom + .15); renderDiagram(); };
  $('sm-zout').onclick = () => { zoom = Math.max(.3, zoom - .15); renderDiagram(); };
  $('sm-svg').onclick = () => {
    const svg = $('sm-canvas').querySelector('svg'); if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (maps[cur].name || 'script-map').replace(/\W+/g, '_') + '.svg'; a.click();
  };

  /* ── Persistence ────────────────────────────────────────── */
  function newView() {
    maps.push({ name: 'New View', data: blank(), _dirty: true, _new: true });
    cur = maps.length - 1; renderAll();
  }

  $('sm-save').onclick = async () => {
    const m = maps[cur];
    const payload = { name: m.name, data: m.data, sort_order: cur, updated_at: new Date().toISOString() };
    let res;
    if (m.id) res = await sb.from('script_maps').update(payload).eq('id', m.id);
    else {
      res = await sb.from('script_maps').insert(payload).select('id').single();
      if (!res.error) m.id = res.data.id;
    }
    if (res.error) { window.toast('Save failed: ' + res.error.message, true); return; }
    m._dirty = false; m._new = false; renderTabs(); window.toast('Script map saved.');
  };

  $('sm-del').onclick = async () => {
    const m = maps[cur];
    if (!confirm(`Delete view "${m.name}"?`)) return;
    if (m.id) {
      const { error } = await sb.from('script_maps').delete().eq('id', m.id);
      if (error) { window.toast('Delete failed: ' + error.message, true); return; }
    }
    maps.splice(cur, 1); cur = Math.max(0, cur - 1);
    if (!maps.length) maps.push({ name: 'Untitled', data: blank(), _dirty: true });
    renderAll();
  };

  async function onOpen() {
    if (loaded) { renderDiagram(); return; }
    loaded = true;
    const { data: rows, error } = await sb.from('script_maps').select('*').order('sort_order').order('created_at');
    if (error) window.toast('Script Map table missing or blocked — run the SQL setup. (' + error.message + ')', true);
    maps = (rows || []).map(r => ({ id: r.id, name: r.name, data: r.data || blank() }));
    if (!maps.length) maps.push({ name: 'Player rig', data: blank(), _dirty: true });
    cur = 0; renderAll();
  }

  /* ── Hook into existing page navigation ─────────────────── */
  const origShow = window.showPage;
  window.showPage = function (id, btn) {
    origShow(id, btn);
    if (id === 'scriptmap') { $('page-title').textContent = 'Script Map'; onOpen(); }
  };
})();
