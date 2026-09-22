(() => {
  const DB_NAME = 'ZeichenLexDB';
  const STORE = 'entries';
  let db;
  let chosenFile = null;
  let currentPreviewUrl = null;
  let playToken = 0;
  let sequenceItems = [];
  let deferredInstallPrompt = null;

  const $ = (s) => document.querySelector(s);
  const grid = $('#grid');
  const modal = $('#modal');
  const form = $('#form');
  const search = $('#search');

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1700);
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('word', 'word', { unique: false });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  function getAll() {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function getOne(id) {
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function putEntry(entry) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function deleteEntry(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[c]);
  }

  function normalize(value = '') {
    return String(value)
      .toLocaleLowerCase('de-DE')
      .trim()
      .replace(/[.,!?;:"“”„()[\]{}]/g, '')
      .replace(/\s+/g, ' ');
  }

  function mediaHTML(entry, className = '') {
    if (!entry.mediaBlob) return '<div class="placeholder">🤟</div>';
    const url = URL.createObjectURL(entry.mediaBlob);
    const type = entry.mediaType || entry.mediaBlob.type || '';
    if (type.startsWith('video/')) {
      return `<video class="${className}" src="${url}" controls playsinline preload="metadata"></video>`;
    }
    return `<img class="${className}" src="${url}" alt="">`;
  }

  async function renderDictionary() {
    const q = normalize(search.value);
    let entries = await getAll();
    entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const filtered = entries.filter(e =>
      !q || normalize(`${e.word || ''} ${e.notes || ''}`).includes(q)
    );

    $('#count').textContent = `${filtered.length} ${filtered.length === 1 ? 'Eintrag' : 'Einträge'}`;

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="empty">
          <div style="font-size:46px">${q ? '🔎' : '🤟'}</div>
          <b style="color:#fff">${q ? 'Nichts gefunden' : 'Noch keine Gebärden'}</b>
          <div style="margin-top:7px">${q ? 'Probier ein anderes Wort.' : 'Tippe unten auf Hinzufügen.'}</div>
        </div>`;
      return;
    }

    grid.innerHTML = filtered.map(e => `
      <article class="card">
        <div class="media">${mediaHTML(e)}</div>
        <div class="content">
          <div class="word">${esc(e.word)}</div>
          ${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}
          <div class="actions">
            <button class="ghost" data-edit="${e.id}">✏️ Bearbeiten</button>
            <button class="danger" data-del="${e.id}">🗑️ Löschen</button>
          </div>
        </div>
      </article>
    `).join('');
  }

  function resetForm() {
    form.reset();
    $('#editId').value = '';
    chosenFile = null;
    $('#modalTitle').textContent = 'Neue Gebärde';
    $('#preview').style.display = 'none';
    $('#preview').innerHTML = '';
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = null;
  }

  function showPreview(blob, type = '') {
    const p = $('#preview');
    if (currentPreviewUrl) URL.revokeObjectURL(currentPreviewUrl);
    currentPreviewUrl = URL.createObjectURL(blob);
    const actualType = type || blob.type || '';
    p.innerHTML = actualType.startsWith('video/')
      ? `<video src="${currentPreviewUrl}" controls playsinline></video>`
      : `<img src="${currentPreviewUrl}" alt="">`;
    p.style.display = 'block';
  }

  function openModal() {
    modal.classList.add('open');
    setTimeout(() => $('#word').focus(), 120);
  }

  function closeModal() {
    modal.classList.remove('open');
    resetForm();
  }

  async function editEntry(id) {
    const e = await getOne(id);
    if (!e) return;
    resetForm();
    $('#editId').value = e.id;
    $('#word').value = e.word || '';
    $('#notes').value = e.notes || '';
    $('#modalTitle').textContent = 'Gebärde bearbeiten';
    if (e.mediaBlob) showPreview(e.mediaBlob, e.mediaType || e.mediaBlob.type);
    openModal();
  }

  function attachFileInput(input) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      chosenFile = file;
      showPreview(file, file.type);
    });
  }

  attachFileInput($('#mediaFile'));
  attachFileInput($('#photoFile'));
  attachFileInput($('#videoFile'));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const editId = $('#editId').value;
    const old = editId ? await getOne(editId) : null;

    const entry = {
      id: editId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      word: $('#word').value.trim(),
      notes: $('#notes').value.trim(),
      mediaBlob: chosenFile || old?.mediaBlob || null,
      mediaType: chosenFile ? chosenFile.type : (old?.mediaType || ''),
      createdAt: old?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    await putEntry(entry);
    closeModal();
    await renderDictionary();
    toast(editId ? 'Aktualisiert' : 'Gespeichert');
  });

  grid.addEventListener('click', async (ev) => {
    const editBtn = ev.target.closest('[data-edit]');
    const deleteBtn = ev.target.closest('[data-del]');

    if (editBtn) editEntry(editBtn.dataset.edit);

    if (deleteBtn && confirm('Diese Gebärde wirklich löschen?')) {
      await deleteEntry(deleteBtn.dataset.del);
      await renderDictionary();
      toast('Gelöscht');
    }
  });

  function switchView(view) {
    playToken++;
    const dictionary = view === 'dict';
    $('#dictView').classList.toggle('hidden', !dictionary);
    $('#translatorView').classList.toggle('hidden', dictionary);
    $('#searchWrap').classList.toggle('hidden', !dictionary);

    document.querySelectorAll('.navbtn').forEach(btn => btn.classList.remove('active'));
    $(dictionary ? '#navDict' : '#navTranslate').classList.add('active');
  }

  async function buildSequence() {
    playToken++;
    const text = $('#translateText').value.trim();
    const sequence = $('#sequence');
    const status = $('#translateStatus');
    sequence.innerHTML = '';
    sequenceItems = [];

    if (!text) {
      status.textContent = 'Schreib zuerst einen Text hinein.';
      $('#playerBar').classList.add('hidden');
      return;
    }

    const entries = await getAll();
    const byWord = new Map();
    for (const entry of entries) {
      const key = normalize(entry.word);
      if (key && !byWord.has(key)) byWord.set(key, entry);
    }

    const rawWords = text.split(/\s+/).map(w => w.trim()).filter(Boolean);
    const cleanWords = rawWords.map(normalize).filter(Boolean);
    const phraseKeys = [...byWord.keys()].sort(
      (a, b) => b.split(' ').length - a.split(' ').length
    );

    let i = 0;
    let missing = 0;

    while (i < cleanWords.length) {
      let matchedKey = null;
      let matchedLength = 0;

      for (const key of phraseKeys) {
        const parts = key.split(' ');
        if (parts.length <= matchedLength) continue;
        if (cleanWords.slice(i, i + parts.length).join(' ') === key) {
          matchedKey = key;
          matchedLength = parts.length;
          break;
        }
      }

      if (matchedKey) {
        const entry = byWord.get(matchedKey);
        sequenceItems.push({
          entry,
          label: rawWords.slice(i, i + matchedLength).join(' '),
          found: true
        });
        i += matchedLength;
      } else {
        sequenceItems.push({ entry: null, label: rawWords[i], found: false });
        missing++;
        i++;
      }
    }

    sequence.innerHTML = sequenceItems.map((item, idx) => {
      if (!item.found) {
        return `
          <div class="seq-card missing" data-seq="${idx}">
            <div class="seq-media">?</div>
            <div class="seq-word">${esc(item.label)}</div>
          </div>`;
      }

      return `
        <div class="seq-card" data-seq="${idx}">
          <div class="seq-media">${mediaHTML(item.entry, 'seq-playable')}</div>
          <div class="seq-word">${esc(item.entry.word)}</div>
        </div>`;
    }).join('');

    $('#playerBar').classList.remove('hidden');
    const found = sequenceItems.length - missing;
    status.textContent = missing
      ? `${found} gefunden · ${missing} nicht im Wörterbuch`
      : `Alle ${found} gefunden`;

    await playSequence();
  }

  async function playSequence() {
    const token = ++playToken;
    const cards = [...document.querySelectorAll('.seq-card')];

    document.querySelectorAll('.seq-playable').forEach(media => {
      if (media.tagName === 'VIDEO') {
        media.pause();
        try { media.currentTime = 0; } catch {}
      }
    });
    cards.forEach(c => c.classList.remove('current'));

    for (let idx = 0; idx < sequenceItems.length; idx++) {
      if (token !== playToken) return;
      const item = sequenceItems[idx];
      if (!item.found) continue;

      const card = cards[idx];
      if (!card) continue;

      card.classList.add('current');
      card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

      const media = card.querySelector('.seq-playable');

      if (media?.tagName === 'VIDEO') {
        try {
          media.muted = true;
          media.currentTime = 0;
          await media.play();

          await new Promise(resolve => {
            let finished = false;
            const done = () => {
              if (finished) return;
              finished = true;
              resolve();
            };
            media.addEventListener('ended', done, { once: true });
            media.addEventListener('error', done, { once: true });
            setTimeout(done, Math.max(1500, ((media.duration || 4) + 1) * 1000));
          });
        } catch {
          await new Promise(r => setTimeout(r, 900));
        }
      } else {
        await new Promise(r => setTimeout(r, 1200));
      }

      card.classList.remove('current');
    }
  }

  $('#translateBtn').addEventListener('click', buildSequence);
  $('#translateText').addEventListener('keydown', e => {
    if (e.key === 'Enter') buildSequence();
  });
  $('#playAll').addEventListener('click', playSequence);
  $('#stopAll').addEventListener('click', () => {
    playToken++;
    document.querySelectorAll('.seq-playable').forEach(media => {
      if (media.tagName === 'VIDEO') {
        media.pause();
        try { media.currentTime = 0; } catch {}
      }
    });
    document.querySelectorAll('.seq-card').forEach(c => c.classList.remove('current'));
  });

  $('#addTop').addEventListener('click', () => { resetForm(); openModal(); });
  $('#navAdd').addEventListener('click', () => { resetForm(); openModal(); });
  $('#close').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  search.addEventListener('input', renderDictionary);
  $('#navDict').addEventListener('click', () => switchView('dict'));
  $('#navTranslate').addEventListener('click', () => switchView('translate'));

  // PWA installation
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $('#installBtn').classList.remove('hidden');
  });

  $('#installBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      toast('Im Browser-Menü „App installieren“ wählen.');
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    $('#installBtn').classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    $('#installBtn').classList.add('hidden');
    toast('ZeichenLex wurde installiert');
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('./sw.js');
      } catch (err) {
        console.warn('Service Worker konnte nicht registriert werden:', err);
      }
    });
  }

  openDB()
    .then(renderDictionary)
    .catch(() => alert('Der lokale Speicher konnte nicht geöffnet werden.'));
})();
