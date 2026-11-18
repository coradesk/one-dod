(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ICON = {
    check: '<path d="m5 12 5 5L20 7"/>',
    minus: '<path d="M6 12h12"/>',
    alert: '<path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    down: '<path d="M12 4v12m0 0-4-4m4 4 4-4M4 20h16"/>',
    prev: '<path d="m15 5-7 7 7 7"/>',
    next: '<path d="m9 5 7 7-7 7"/>',
  };
  const svg = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = ICON[name]; return s; };
  const fmtBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

  /* ---------- tema ---------- */
  const themeSel = $('#theme');
  try { themeSel.value = localStorage.getItem('dod-theme') || 'system'; } catch (e) {}
  const applyTheme = () => {
    const t = themeSel.value;
    const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  };
  themeSel.addEventListener('change', () => { try { localStorage.setItem('dod-theme', themeSel.value); } catch (e) {} applyTheme(); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ---------- toast ---------- */
  const toast = (msg, tone = 'ok') => {
    const t = el('div', 'toast ' + tone, msg);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), tone === 'ok' ? 3000 : 8000);
  };

  /* ---------- status worker ---------- */
  const statusEl = $('#worker-status');
  const checkWorker = async () => {
    try {
      const r = await fetch('api/health.php', { cache: 'no-store' });
      const d = await r.json();
      statusEl.className = 'badge ' + (d.worker ? 'ok' : 'bad');
      statusEl.textContent = d.worker ? `Worker AI aktif · ${d.gpu ? 'GPU' : 'CPU'}` : 'Worker AI mati';
      statusEl.title = d.worker ? '' : 'Enhance & hapus background AI tidak tersedia. Mode warna solid tetap bisa dipakai.';
    } catch (e) {
      statusEl.className = 'badge bad'; statusEl.textContent = 'Server tidak merespons';
    }
  };
  checkWorker(); setInterval(checkWorker, 30000);

  /* ---------- antrean ---------- */
  const queue = []; // {file, url, id}
  const qEl = $('#queue'), runBtn = $('#run'), runLabel = $('#run-label'), clearBtn = $('#clear');
  const input = $('#file'), drop = $('#drop'), formErr = $('#form-error');
  let busy = false;

  const renderQueue = () => {
    qEl.replaceChildren(...queue.map((q) => {
      const li = el('li');
      const img = el('img'); img.src = q.url; img.alt = '';
      const name = el('span', 'q-name', q.file.name); name.title = q.file.name;
      const size = el('span', 'q-size num', fmtBytes(q.file.size));
      const rm = el('button', 'btn icon'); rm.type = 'button'; rm.append(svg('x'));
      rm.setAttribute('aria-label', 'Hapus ' + q.file.name + ' dari antrean');
      rm.disabled = busy;
      rm.addEventListener('click', () => { URL.revokeObjectURL(q.url); queue.splice(queue.indexOf(q), 1); renderQueue(); });
      li.append(img, name, size, rm);
      return li;
    }));
    runBtn.disabled = busy || queue.length === 0;
    clearBtn.hidden = busy || queue.length === 0;
    runLabel.textContent = busy ? 'Memproses…' : queue.length > 1 ? `Proses ${queue.length} gambar` : 'Proses';
  };

  const addFiles = (files) => {
    formErr.hidden = true;
    let skipped = 0;
    for (const f of files) {
      const okType = f.type.startsWith('image/') || /\.(heic|heif|avif)$/i.test(f.name);
      if (!okType) { skipped++; continue; }
      if (queue.some((q) => q.file.name === f.name && q.file.size === f.size)) continue;
      queue.push({ file: f, url: URL.createObjectURL(f) });
    }
    if (skipped) toast(`${skipped} file dilewati karena bukan gambar.`, 'warn');
    renderQueue();
  };

  drop.addEventListener('click', () => !busy && input.click());
  drop.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => !busy && addFiles(e.dataTransfer.files));
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && !busy) { addFiles(files); toast('Gambar dari clipboard ditambahkan.'); }
  });
  clearBtn.addEventListener('click', () => { queue.forEach((q) => URL.revokeObjectURL(q.url)); queue.length = 0; renderQueue(); });

  /* ---------- preview (lightbox): klik gambar hasil untuk melihatnya besar, tanpa membuka Koreksi ---------- */
  const lightbox = (() => {
    let root, stage, img, cap, items = [], idx = 0, opener = null;
    const show = () => {
      const f = items[idx];
      stage.className = 'lb-stage ' + (f.transparent ? 'checker' : 'square');
      img.src = f.url; img.alt = f.alt;
      cap.textContent = `${f.label} · ${f.w}×${f.h} · ${fmtBytes(f.bytes)}`;
      root.classList.toggle('single', items.length < 2);
    };
    const step = (d) => { idx = (idx + d + items.length) % items.length; show(); };
    const close = () => {
      if (!root || root.hidden) return;
      root.hidden = true; img.removeAttribute('src');
      document.body.classList.remove('modal-open');
      opener?.focus?.(); opener = null;
    };
    const build = () => {
      root = el('div', 'lb-overlay'); root.hidden = true;
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Preview gambar');
      stage = el('div', 'lb-stage'); img = el('img');
      stage.append(img);
      cap = el('div', 'lb-cap');
      const mk = (cls, label, icon, fn) => { const b = el('button', 'lb-btn ' + cls); b.type = 'button'; b.setAttribute('aria-label', label); b.append(svg(icon)); b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
      root.append(stage, cap, mk('lb-close', 'Tutup', 'x', close), mk('lb-prev', 'Sebelumnya', 'prev', () => step(-1)), mk('lb-next', 'Berikutnya', 'next', () => step(1)));
      root.addEventListener('click', (e) => { if (e.target !== img) close(); });
      document.body.append(root);
      document.addEventListener('keydown', (e) => {
        if (root.hidden) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft' && items.length > 1) step(-1);
        else if (e.key === 'ArrowRight' && items.length > 1) step(1);
        else if (e.key === 'Tab') { e.preventDefault(); root.querySelector('.lb-close').focus(); }
        else return;
        e.preventDefault(); e.stopPropagation();
      }, true);
    };
    return {
      open(list, i, from) {
        if (!root) build();
        items = list; idx = i; opener = from;
        show(); root.hidden = false;
        document.body.classList.add('modal-open');
        root.querySelector('.lb-close').focus();
      },
    };
  })();

  /* ---------- hasil ---------- */
  const listEl = $('#list'), emptyEl = $('#empty'), zipEl = $('#zip'), summaryEl = $('#summary');
  const progEl = $('#progress'), progBar = $('#progress i');
  const doneIds = [];

  const setBadge = (card, tone, text, spinning) => {
    const b = $('.result-badge', card);
    b.className = 'badge result-badge ' + tone;
    b.replaceChildren();
    if (spinning) b.append(el('span', 'spin'));
    b.append(text);
  };

  const newCard = (q) => {
    const card = $('#tpl-result').content.firstElementChild.cloneNode(true);
    $('.result-thumb', card).src = q.url;
    $('.result-name', card).textContent = q.file.name;
    $('.result-meta', card).textContent = fmtBytes(q.file.size);
    listEl.prepend(card);
    emptyEl.hidden = true;
    return card;
  };

  const fillCard = (card, d) => {
    const meta = $('.result-meta', card);
    meta.textContent = `Asli ${d.original.w}×${d.original.h}px · selesai dalam ${d.seconds} dtk`;
    const steps = $('.steps', card);
    steps.replaceChildren();
    d.steps.forEach((s) => { const li = el('li', s.done ? '' : 'muted'); li.append(svg(s.done ? 'check' : 'minus'), s.text); steps.append(li); });
    d.warnings.forEach((w) => { const li = el('li', 'warn'); li.append(svg('alert'), w); steps.append(li); });

    const outs = $('.outputs', card);
    const gallery = Object.entries(d.files).map(([k, f]) => ({ ...f, transparent: k === 'transparan', alt: `${f.label} – ${d.name}` }));
    outs.replaceChildren(...Object.entries(d.files).map(([k, f], n) => {
      const box = el('div', 'out');
      const view = el('div', 'out-view zoomable ' + (k === 'transparan' ? 'checker' : 'square'));
      const img = el('img'); img.src = f.url; img.loading = 'lazy';
      img.alt = `${f.label} – ${d.name}`;
      view.append(img);
      view.tabIndex = 0; view.setAttribute('role', 'button'); view.title = 'Klik untuk melihat besar';
      view.setAttribute('aria-label', `Lihat besar: ${f.label}`);
      const open = () => lightbox.open(gallery, n, view);
      view.addEventListener('click', open);
      view.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      const foot = el('div', 'out-foot');
      const info = el('div');
      info.append(el('div', 'out-label', f.label), el('div', 'out-meta num', `${f.w}×${f.h} · ${fmtBytes(f.bytes)}`));
      const a = el('a', 'btn outline sm'); a.href = f.url + '&dl=1'; a.setAttribute('download', f.file);
      a.append(svg('down'), 'Unduh'); a.setAttribute('aria-label', `Unduh ${f.file}`);
      foot.append(info, a);
      box.append(view, foot);
      return box;
    }));

    // tombol Koreksi -> editor magic eraser
    const edBtn = $('.result-edit', card);
    edBtn.hidden = !d.edit || !window.ImgEditor;
    edBtn.onclick = () => window.ImgEditor.open({
      id: d.id, name: d.name, edit: d.edit, margin: d.opt ? Math.round(d.opt.margin * 100) : Number($('#margin').value),
      onApply: (nd) => {
        fillCard(card, nd);
        setBadge(card, 'ok', 'Dikoreksi');
        toast('Koreksi diterapkan, output diperbarui.');
        zipEl.href = 'api/file.php?ids=' + doneIds.join(',') + '&t=' + Date.now();
      },
      onError: (msg) => toast(msg, 'bad'),
    });
  };

  const processOne = async (q, opts) => {
    const card = newCard(q);
    setBadge(card, 'brand', 'Memproses', true);
    $('.outputs', card).replaceChildren(el('div', 'skel'), el('div', 'skel'), el('div', 'skel'));
    const fd = new FormData();
    fd.append('file', q.file);
    Object.entries(opts).forEach(([k, v]) => fd.append(k, v));
    try {
      const r = await fetch('api/process.php', { method: 'POST', body: fd });
      let d;
      try { d = await r.json(); } catch (e) { throw new Error(r.status === 413 ? 'File terlalu besar untuk server.' : `Server mengembalikan galat (${r.status}).`); }
      if (!r.ok || d.error) throw new Error(d.error || `Galat ${r.status}`);
      fillCard(card, d);
      setBadge(card, d.warnings.length ? 'warn' : 'ok', d.warnings.length ? 'Selesai, ada catatan' : 'Selesai');
      doneIds.push(d.id);
      return true;
    } catch (e) {
      $('.outputs', card).replaceChildren();
      const err = $('.result-error', card); err.textContent = e.message; err.hidden = false;
      setBadge(card, 'bad', 'Gagal');
      return false;
    }
  };

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !queue.length) return;
    const margin = Number($('#margin').value);
    if (!(margin >= 0 && margin <= 20)) {
      formErr.textContent = 'Margin harus di antara 0 dan 20%.'; formErr.hidden = false; $('#margin').focus(); return;
    }
    formErr.hidden = true;
    const opts = { enhance: $('#enhance').value, bg: $('#bg').value, margin: String(margin) };
    const batch = queue.splice(0, queue.length);
    busy = true; renderQueue();
    document.querySelectorAll('#form select, #form input').forEach((c) => (c.disabled = true));
    progEl.hidden = false; progBar.style.width = '0%';

    let ok = 0;
    for (let i = 0; i < batch.length; i++) {
      summaryEl.textContent = `Memproses ${i + 1} dari ${batch.length}…`;
      if (await processOne(batch[i], opts)) ok++;
      const pct = Math.round(((i + 1) / batch.length) * 100);
      progBar.style.width = pct + '%'; progEl.setAttribute('aria-valuenow', String(pct));
    }

    busy = false;
    document.querySelectorAll('#form select, #form input').forEach((c) => (c.disabled = false));
    renderQueue();
    setTimeout(() => { progEl.hidden = true; }, 1200);
    const fail = batch.length - ok;
    summaryEl.textContent = `${doneIds.length} gambar siap diunduh · 3 PNG per gambar · disimpan 24 jam`;
    if (doneIds.length) { zipEl.hidden = false; zipEl.href = 'api/file.php?ids=' + doneIds.join(','); }
    if (fail === 0) toast(ok > 1 ? `${ok} gambar selesai diproses.` : 'Gambar selesai diproses.');
    else toast(`${ok} berhasil, ${fail} gagal. Lihat keterangan di kartu hasil.`, 'bad');
  });

  renderQueue();
})();
