(() => {
  const DB_NAME = "ZeichenLexDB";
  const STORE = "entries";

  let db;
  let selectedFile = null;
  let previewUrl = null;
  let activeFilter = "all";
  let deferredInstallPrompt = null;
  let playToken = 0;
  let currentSequence = [];
  let cloudBusy = false;
  let cloudTimer = null;

  let editingTransform = defaultTransform();
  let dragState = null;

  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  const views = {
    homeView: $("#homeView"),
    dictionaryView: $("#dictionaryView"),
    translatorView: $("#translatorView"),
    dataView: $("#dataView")
  };

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 1700);
  }

  function esc(v = "") {
    return String(v).replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
    }[c]));
  }

  function norm(v = "") {
    return String(v)
      .toLocaleLowerCase("de-DE")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,!?;:"“”„()[\]{}<>/\\|_+=*#@~`´^]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function defaultTransform() {
    return { x: 0, y: 0, scale: 1, rotation: 0, fit: "cover" };
  }

  function getTransform(entry) {
    const raw = entry?.mediaTransform || {};
    return {
      x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
      y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
      scale: Number.isFinite(Number(raw.scale)) ? Number(raw.scale) : 1,
      rotation: Number.isFinite(Number(raw.rotation)) ? Number(raw.rotation) : 0,
      fit: raw.fit === "contain" ? "contain" : "cover"
    };
  }

  function transformStyle(entryOrTransform) {
    const t = entryOrTransform?.mediaTransform
      ? getTransform(entryOrTransform)
      : { ...defaultTransform(), ...(entryOrTransform || {}) };

    return [
      `object-fit:${t.fit}`,
      `transform:translate(${t.x}%,${t.y}%) scale(${t.scale}) rotate(${t.rotation}deg)`
    ].join(";");
  }

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, 2);
      r.onupgradeneeded = e => {
        const d = e.target.result;
        let s;
        if (!d.objectStoreNames.contains(STORE)) {
          s = d.createObjectStore(STORE, { keyPath: "id" });
        } else {
          s = e.target.transaction.objectStore(STORE);
        }
        if (!s.indexNames.contains("word")) s.createIndex("word", "word", { unique: false });
      };
      r.onsuccess = e => { db = e.target.result; res(); };
      r.onerror = () => rej(r.error);
    });
  }

  function all() {
    return new Promise((res, rej) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  }

  function one(id) {
    return new Promise((res, rej) => {
      const r = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  function put(entry) {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  function clearAll() {
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  }

  function cloudConfig() {
    const c = window.ZEICHENLEX_CLOUD || {};
    return {
      url: String(c.url || "").replace(/\/+$/, ""),
      anonKey: String(c.anonKey || ""),
      table: String(c.table || "zeichenlex_entries"),
      bucket: String(c.bucket || "zeichenlex-media")
    };
  }

  function cloudConfigured() {
    const c = cloudConfig();
    return /^https:\/\/.+\.supabase\.co$/i.test(c.url) && c.anonKey.length > 20;
  }

  function setCloudStatus(state, text) {
    const card = document.querySelector(".cloud-card");
    const label = $("#cloudStatusText");
    if (label) label.textContent = text;
    if (card) {
      card.classList.remove("syncing", "synced", "error");
      if (state) card.classList.add(state);
    }
  }

  function cloudHeaders(extra = {}) {
    const c = cloudConfig();
    return {
      apikey: c.anonKey,
      Authorization: `Bearer ${c.anonKey}`,
      ...extra
    };
  }

  function storagePathURL(path) {
    const c = cloudConfig();
    const encoded = String(path || "")
      .split("/")
      .map(part => encodeURIComponent(part))
      .join("/");
    return `${c.url}/storage/v1/object/public/${encodeURIComponent(c.bucket)}/${encoded}`;
  }

  function extensionFor(entry) {
    const type = entry.mediaType || entry.mediaBlob?.type || "";
    if (type.includes("webm")) return "webm";
    if (type.includes("quicktime")) return "mov";
    if (type.includes("png")) return "png";
    if (type.includes("webp")) return "webp";
    if (type.includes("gif")) return "gif";
    if (type.startsWith("image/")) return "jpg";
    return "mp4";
  }

  async function uploadCloudMedia(entry) {
    if (!entry.mediaBlob) return entry.cloudMediaPath || null;

    const c = cloudConfig();
    const path = `${entry.id}/media.${extensionFor(entry)}`;
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");

    const response = await fetch(
      `${c.url}/storage/v1/object/${encodeURIComponent(c.bucket)}/${encodedPath}`,
      {
        method: "POST",
        headers: cloudHeaders({
          "Content-Type": entry.mediaType || entry.mediaBlob.type || "application/octet-stream",
          "x-upsert": "true"
        }),
        body: entry.mediaBlob
      }
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`Medien-Upload fehlgeschlagen (${response.status}) ${message}`);
    }

    return path;
  }

  function localToCloudRow(entry, mediaPath) {
    return {
      id: entry.id,
      word: entry.word || "",
      aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
      notes: entry.notes || "",
      favorite: !!entry.favorite,
      media_path: mediaPath || null,
      media_type: entry.mediaType || null,
      media_transform: entry.mediaTransform || defaultTransform(),
      created_at: new Date(entry.createdAt || Date.now()).toISOString(),
      updated_at: new Date(entry.updatedAt || Date.now()).toISOString()
    };
  }

  async function pushCloudEntry(entry) {
    const c = cloudConfig();

    let mediaPath = entry.cloudMediaPath || null;
    if (entry.mediaBlob && (entry._mediaDirty || !mediaPath)) {
      mediaPath = await uploadCloudMedia(entry);
    }

    const response = await fetch(
      `${c.url}/rest/v1/${encodeURIComponent(c.table)}?on_conflict=id`,
      {
        method: "POST",
        headers: cloudHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        }),
        body: JSON.stringify(localToCloudRow(entry, mediaPath))
      }
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`Cloud-Speichern fehlgeschlagen (${response.status}) ${message}`);
    }

    await put({
      ...entry,
      cloudMediaPath: mediaPath,
      cloudSyncedAt: Date.now(),
      _syncPending: false,
      _mediaDirty: false
    });
  }

  async function fetchCloudRows() {
    const c = cloudConfig();
    const response = await fetch(
      `${c.url}/rest/v1/${encodeURIComponent(c.table)}?select=*`,
      { headers: cloudHeaders({ Accept: "application/json" }) }
    );

    if (!response.ok) {
      const message = await response.text().catch(() => "");
      throw new Error(`Cloud-Laden fehlgeschlagen (${response.status}) ${message}`);
    }

    return await response.json();
  }

  async function downloadCloudMedia(path) {
    if (!path) return null;
    const response = await fetch(storagePathURL(path), {
      headers: cloudHeaders()
    });
    if (!response.ok) return null;
    return await response.blob();
  }

  async function cloudRowToLocal(row, existing = null) {
    let mediaBlob = existing?.mediaBlob || null;

    if (row.media_path && (!mediaBlob || existing?.cloudMediaPath !== row.media_path)) {
      mediaBlob = await downloadCloudMedia(row.media_path);
    }

    return {
      ...(existing || {}),
      id: row.id,
      word: row.word || "",
      aliases: Array.isArray(row.aliases) ? row.aliases : [],
      notes: row.notes || "",
      favorite: !!row.favorite,
      mediaBlob,
      mediaType: row.media_type || mediaBlob?.type || "",
      mediaTransform: { ...defaultTransform(), ...(row.media_transform || {}) },
      cloudMediaPath: row.media_path || null,
      createdAt: Date.parse(row.created_at) || existing?.createdAt || Date.now(),
      updatedAt: Date.parse(row.updated_at) || Date.now(),
      cloudSyncedAt: Date.now(),
      _syncPending: false,
      _mediaDirty: false
    };
  }

  async function deleteCloudCollection() {
    if (!cloudConfigured()) return;
    const c = cloudConfig();
    const response = await fetch(
      `${c.url}/rest/v1/${encodeURIComponent(c.table)}?id=not.is.null`,
      {
        method: "DELETE",
        headers: cloudHeaders({ Prefer: "return=minimal" })
      }
    );
    if (!response.ok) throw new Error("Cloud-Sammlung konnte nicht gelöscht werden.");
  }

  async function syncCloud({ silent = false } = {}) {
    if (!cloudConfigured()) {
      setCloudStatus("", "Noch nicht eingerichtet – URL und anon key in cloud-config.js eintragen.");
      return false;
    }

    if (!navigator.onLine) {
      setCloudStatus("", "Offline – Änderungen werden lokal gespeichert und später synchronisiert.");
      return false;
    }

    if (cloudBusy) return false;
    cloudBusy = true;
    setCloudStatus("syncing", "Synchronisiere …");

    try {
      // 1) Lokale Änderungen zuerst hochladen.
      let locals = await all();
      for (const entry of locals) {
        if (entry._syncPending || !entry.cloudSyncedAt) {
          await pushCloudEntry(entry);
        }
      }

      // 2) Cloud laden und mit lokalem Stand zusammenführen.
      locals = await all();
      const localMap = new Map(locals.map(entry => [entry.id, entry]));
      const rows = await fetchCloudRows();

      for (const row of rows) {
        const local = localMap.get(row.id);
        const remoteUpdated = Date.parse(row.updated_at) || 0;
        const localUpdated = local?.updatedAt || 0;

        if (!local || remoteUpdated > localUpdated) {
          const merged = await cloudRowToLocal(row, local);
          await put(merged);
        } else if (localUpdated > remoteUpdated) {
          await pushCloudEntry(local);
        }
      }

      await refresh();
      setCloudStatus("synced", `Synchronisiert · ${rows.length} ${rows.length === 1 ? "Eintrag" : "Einträge"} in der Cloud`);
      if (!silent) toast("Cloud synchronisiert");
      return true;
    } catch (error) {
      console.error(error);
      setCloudStatus("error", "Cloud-Fehler – Supabase-Einstellungen und SQL prüfen.");
      if (!silent) toast("Cloud-Sync fehlgeschlagen");
      return false;
    } finally {
      cloudBusy = false;
    }
  }

  function startCloudSync() {
    clearInterval(cloudTimer);
    cloudTimer = setInterval(() => syncCloud({ silent: true }), 30000);
  }

  function kind(entry) {
    const t = entry.mediaType || entry.mediaBlob?.type || "";
    return t.startsWith("video/") ? "video" : t.startsWith("image/") ? "photo" : "none";
  }

  function media(entry, extraClass = "", controls = false) {
    if (!entry?.mediaBlob && !entry?.cloudMediaPath) return `<div class="entry-placeholder">🤟</div>`;

    const url = entry.mediaBlob ? URL.createObjectURL(entry.mediaBlob) : storagePathURL(entry.cloudMediaPath);
    const type = entry.mediaType || entry.mediaBlob?.type || "";
    const style = transformStyle(entry);
    const cls = `adjusted-media ${extraClass}`.trim();

    if (type.startsWith("video/")) {
      return `<video class="${cls}" src="${url}" style="${style}" ${controls ? "controls" : "muted"} playsinline preload="metadata"></video>`;
    }
    return `<img class="${cls}" src="${url}" style="${style}" alt="${esc(entry.word || "")}">`;
  }

  function card(entry) {
    const k = kind(entry);
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];

    return `<article class="entry-card">
      <button class="favorite-btn ${entry.favorite ? "active" : ""}" data-fav="${entry.id}">${entry.favorite ? "★" : "☆"}</button>
      <button class="entry-media" data-view-entry="${entry.id}">
        ${media(entry)}
        <span class="media-badge">${k === "video" ? "🎥 Video" : k === "photo" ? "📷 Foto" : "Ohne Medium"}</span>
      </button>
      <div class="entry-body">
        <div class="entry-title">${esc(entry.word || "Ohne Titel")}</div>
        <div class="entry-note">${esc(entry.notes || "Keine Notiz")}</div>
        ${aliases.length ? `<div class="entry-aliases">Auch: ${esc(aliases.join(", "))}</div>` : ""}
        <div class="entry-actions">
          <button data-view-entry="${entry.id}">Öffnen</button>
          <button data-edit="${entry.id}">Bearbeiten</button>
        </div>
      </div>
    </article>`;
  }

  async function refresh() {
    const entries = (await all()).map(e => ({
      ...e,
      aliases: Array.isArray(e.aliases) ? e.aliases : [],
      favorite: !!e.favorite
    }));

    $("#statEntries").textContent = entries.length;
    $("#statVideos").textContent = entries.filter(e => kind(e) === "video").length;
    $("#statFavs").textContent = entries.filter(e => e.favorite).length;

    const recent = [...entries]
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
      .slice(0, 6);

    $("#recentGrid").innerHTML = recent.length
      ? recent.map(card).join("")
      : `<div class="empty-state"><div style="font-size:42px">🤟</div><strong>Noch keine Gebärden</strong><span>Tippe auf „Video aufnehmen“ und leg los.</span></div>`;

    renderDict(entries);
  }

  async function renderDict(entriesArg) {
    const entries = entriesArg || await all();
    const q = norm($("#searchInput").value);
    const sort = $("#sortSelect").value;

    let list = entries.filter(entry => {
      const k = kind(entry);
      if (activeFilter === "video" && k !== "video") return false;
      if (activeFilter === "photo" && k !== "photo") return false;
      if (activeFilter === "favorite" && !entry.favorite) return false;

      if (!q) return true;
      return norm([
        entry.word,
        entry.notes,
        ...(Array.isArray(entry.aliases) ? entry.aliases : [])
      ].filter(Boolean).join(" ")).includes(q);
    });

    if (sort === "az") list.sort((a, b) => (a.word || "").localeCompare(b.word || "", "de"));
    if (sort === "za") list.sort((a, b) => (b.word || "").localeCompare(a.word || "", "de"));
    if (sort === "recent") list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    $("#resultCount").textContent = `${list.length} ${list.length === 1 ? "Eintrag" : "Einträge"}`;
    $("#dictionaryGrid").innerHTML = list.length
      ? list.map(card).join("")
      : `<div class="empty-state"><div style="font-size:40px">⌕</div><strong>Nichts gefunden</strong><span>Anderen Suchbegriff oder Filter probieren.</span></div>`;
  }

  function view(id) {
    playToken++;
    Object.entries(views).forEach(([key, el]) => el.classList.toggle("active", key === id));
    $$(".nav-item[data-view]").forEach(btn => btn.classList.toggle("active", btn.dataset.view === id));
    if (id === "dictionaryView") renderDict();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetAdjuster() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $("#cropMedia").innerHTML = "";
    $("#mediaAdjuster").classList.add("hidden");
    editingTransform = defaultTransform();
    updateAdjusterControls();
  }

  function updateAdjusterControls() {
    $("#zoomSlider").value = editingTransform.scale;
    $("#zoomValue").textContent = `${Math.round(editingTransform.scale * 100)}%`;
    $$("[data-fit-mode]").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.fitMode === editingTransform.fit);
    });

    const visual = $("#cropMedia").querySelector("video,img");
    if (visual) visual.style.cssText = transformStyle(editingTransform);
  }

  function showAdjuster(blob, type = "", transform = defaultTransform()) {
    resetAdjuster();
    editingTransform = { ...defaultTransform(), ...transform };
    previewUrl = URL.createObjectURL(blob);

    const actualType = type || blob.type || "";
    const cropMedia = $("#cropMedia");

    if (actualType.startsWith("video/")) {
      cropMedia.innerHTML = `<video id="cropVisual" src="${previewUrl}" muted loop autoplay playsinline></video>`;
      const video = $("#cropVisual");
      video.addEventListener("loadedmetadata", () => {
        if (video.videoHeight > video.videoWidth) {
          $("#orientationHint").textContent = "Hochkant erkannt: Verschieb das Video nach oben oder unten, bis die Hände gut im Querformat sitzen.";
        } else {
          $("#orientationHint").textContent = "Zieh das Video mit dem Finger an die richtige Stelle.";
        }
        video.play().catch(() => {});
      }, { once: true });
    } else {
      cropMedia.innerHTML = `<img id="cropVisual" src="${previewUrl}" alt="Vorschau">`;
      $("#orientationHint").textContent = "Zieh das Bild mit dem Finger an die richtige Stelle.";
    }

    $("#mediaAdjuster").classList.remove("hidden");
    updateAdjusterControls();
  }

  function openEntry(mode = "new", entry = null, capture = null) {
    $("#entryForm").reset();
    $("#entryId").value = entry?.id || "";
    $("#wordInput").value = entry?.word || "";
    $("#aliasesInput").value = Array.isArray(entry?.aliases) ? entry.aliases.join(", ") : "";
    $("#noteInput").value = entry?.notes || "";
    $("#favoriteInput").checked = !!entry?.favorite;

    $("#modalEyebrow").textContent = mode === "edit" ? "EINTRAG BEARBEITEN" : "NEUE GEBÄRDE";
    $("#modalTitle").textContent = mode === "edit" ? "Gebärde ändern" : "Schnell hinzufügen";

    selectedFile = null;
    resetAdjuster();

    if (entry?.mediaBlob) {
      showAdjuster(entry.mediaBlob, entry.mediaType || entry.mediaBlob.type, getTransform(entry));
    }

    $("#entryModal").classList.add("open");
    setTimeout(() => $("#wordInput").focus(), 120);

    if (capture === "video") setTimeout(() => $("#videoCapture").click(), 220);
  }

  function closeEntry() {
    $("#entryModal").classList.remove("open");
    resetAdjuster();
  }

  ["#videoCapture", "#photoCapture", "#galleryInput"].forEach(selector => {
    $(selector).addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (!file) return;
      selectedFile = file;
      editingTransform = defaultTransform();
      showAdjuster(file, file.type, editingTransform);
    });
  });

  $("#zoomSlider").addEventListener("input", event => {
    editingTransform.scale = Number(event.target.value);
    updateAdjusterControls();
  });

  $$("[data-fit-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      editingTransform.fit = btn.dataset.fitMode;
      updateAdjusterControls();
    });
  });

  $("#rotateMedia").addEventListener("click", () => {
    editingTransform.rotation = (editingTransform.rotation + 90) % 360;
    updateAdjusterControls();
  });

  $("#centerMedia").addEventListener("click", () => {
    editingTransform.x = 0;
    editingTransform.y = 0;
    updateAdjusterControls();
  });

  $("#resetMedia").addEventListener("click", () => {
    editingTransform = defaultTransform();
    updateAdjusterControls();
  });

  const cropStage = $("#cropStage");

  cropStage.addEventListener("pointerdown", event => {
    if (!$("#cropMedia").children.length) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: editingTransform.x,
      baseY: editingTransform.y
    };
    cropStage.setPointerCapture(event.pointerId);
    cropStage.classList.add("dragging");
  });

  cropStage.addEventListener("pointermove", event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const rect = cropStage.getBoundingClientRect();
    const dx = ((event.clientX - dragState.startX) / rect.width) * 100;
    const dy = ((event.clientY - dragState.startY) / rect.height) * 100;

    editingTransform.x = Math.max(-100, Math.min(100, dragState.baseX + dx));
    editingTransform.y = Math.max(-100, Math.min(100, dragState.baseY + dy));
    updateAdjusterControls();
  });

  function finishDrag(event) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    cropStage.classList.remove("dragging");
    try { cropStage.releasePointerCapture(event.pointerId); } catch {}
  }

  cropStage.addEventListener("pointerup", finishDrag);
  cropStage.addEventListener("pointercancel", finishDrag);

  $("#entryForm").addEventListener("submit", async event => {
    event.preventDefault();

    const id = $("#entryId").value;
    const old = id ? await one(id) : null;
    const word = $("#wordInput").value.trim();
    if (!word) return;

    const hasMedia = !!(selectedFile || old?.mediaBlob);

    const entry = {
      id: id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
      word,
      aliases: $("#aliasesInput").value.split(",").map(x => x.trim()).filter(Boolean),
      notes: $("#noteInput").value.trim(),
      favorite: $("#favoriteInput").checked,
      mediaBlob: selectedFile || old?.mediaBlob || null,
      mediaType: selectedFile ? selectedFile.type : (old?.mediaType || old?.mediaBlob?.type || ""),
      mediaTransform: hasMedia ? { ...editingTransform } : defaultTransform(),
      cloudMediaPath: selectedFile ? null : (old?.cloudMediaPath || null),
      cloudSyncedAt: old?.cloudSyncedAt || null,
      _syncPending: true,
      _mediaDirty: !!selectedFile || (!!(old?.mediaBlob) && !old?.cloudMediaPath),
      createdAt: old?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    await put(entry);
    closeEntry();
    await refresh();
    toast(id ? "Gebärde aktualisiert" : "Gebärde gespeichert");
    syncCloud({ silent: true });
  });

  async function openViewer(id) {
    const entry = await one(id);
    if (!entry) return;

    $("#viewerWord").textContent = entry.word || "";
    $("#viewerNote").textContent = entry.notes || "";

    const m = $("#viewerMedia");
    m.innerHTML = (entry.mediaBlob || entry.cloudMediaPath)
      ? media(entry, "viewer-playable", true)
      : `<div style="font-size:68px;padding:70px">🤟</div>`;

    $("#viewerModal").classList.add("open");

    const vid = m.querySelector("video");
    if (vid) vid.play().catch(() => {});
  }

  function closeViewer() {
    $("#viewerModal").classList.remove("open");
    $("#viewerMedia").innerHTML = "";
  }

  document.body.addEventListener("click", async event => {
    const fav = event.target.closest("[data-fav]");
    if (fav) {
      const entry = await one(fav.dataset.fav);
      if (entry) {
        entry.favorite = !entry.favorite;
        entry.updatedAt = Date.now();
        entry._syncPending = true;
        await put(entry);
        await refresh();
        syncCloud({ silent: true });
      }
      return;
    }

    const viewer = event.target.closest("[data-view-entry]");
    if (viewer) {
      openViewer(viewer.dataset.viewEntry);
      return;
    }

    const edit = event.target.closest("[data-edit]");
    if (edit) {
      const entry = await one(edit.dataset.edit);
      if (entry) openEntry("edit", entry);
    }
  });

  $$("[data-close-entry]").forEach(x => x.addEventListener("click", closeEntry));
  $$("[data-close-viewer]").forEach(x => x.addEventListener("click", closeViewer));

  $("#quickAddBtn").onclick = () => openEntry();
  $("#dictAddBtn").onclick = () => openEntry();
  $("#navAddBtn").onclick = () => openEntry();
  $("#heroVideo").onclick = () => openEntry("new", null, "video");
  $("#heroTranslate").onclick = () => view("translatorView");
  $("#showAllBtn").onclick = () => view("dictionaryView");
  $("#brandHome").onclick = () => view("homeView");

  $$(".nav-item[data-view]").forEach(btn => btn.onclick = () => view(btn.dataset.view));

  $("#searchInput").oninput = () => renderDict();
  $("#sortSelect").onchange = () => renderDict();

  $("#filterChips").onclick = event => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    activeFilter = chip.dataset.filter;
    $$(".chip").forEach(c => c.classList.toggle("active", c === chip));
    renderDict();
  };

  async function translate() {
    playToken++;
    const text = $("#translateInput").value.trim();

    if (!text) {
      $("#translateStatus").textContent = "Schreib zuerst einen Satz.";
      return;
    }

    const entries = await all();
    const lookup = new Map();

    for (const entry of entries) {
      for (const key of [entry.word, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].map(norm).filter(Boolean)) {
        if (!lookup.has(key)) lookup.set(key, entry);
      }
    }

    const raw = text.split(/\s+/).filter(Boolean);
    const clean = raw.map(norm).filter(Boolean);
    const keys = [...lookup.keys()].sort((a, b) => b.split(" ").length - a.split(" ").length);

    currentSequence = [];
    let i = 0;
    let missing = 0;

    while (i < clean.length) {
      let match = null;
      let len = 0;

      for (const key of keys) {
        const parts = key.split(" ");
        if (parts.length <= len) continue;
        if (clean.slice(i, i + parts.length).join(" ") === key) {
          match = key;
          len = parts.length;
          break;
        }
      }

      if (match) {
        currentSequence.push({
          found: true,
          entry: lookup.get(match),
          label: raw.slice(i, i + len).join(" ")
        });
        i += len;
      } else {
        currentSequence.push({ found: false, label: raw[i] });
        missing++;
        i++;
      }
    }

    $("#sequenceWrap").classList.remove("hidden");
    $("#playAgainBtn").classList.remove("hidden");
    $("#stopBtn").classList.remove("hidden");

    $("#sequence").innerHTML = currentSequence.map((item, index) => {
      if (!item.found) {
        return `<div class="seq-card missing">
          <button class="seq-media" data-add-missing="${esc(item.label)}">＋</button>
          <div class="seq-word">${esc(item.label)}</div>
        </div>`;
      }

      return `<div class="seq-card" data-seq="${index}">
        <div class="seq-media">${media(item.entry, "seq-playable")}</div>
        <div class="seq-word">${esc(item.entry.word)}</div>
      </div>`;
    }).join("");

    $("#translateStatus").textContent = missing
      ? `${currentSequence.length - missing} gefunden · ${missing} fehlen`
      : `Alle ${currentSequence.length} gefunden`;

    playSequence();
  }

  async function playSequence() {
    const token = ++playToken;
    const cards = $$(".seq-card");

    for (const m of $$(".seq-playable")) {
      if (m.tagName === "VIDEO") {
        m.pause();
        try { m.currentTime = 0; } catch {}
      }
    }

    cards.forEach(c => c.classList.remove("current"));

    for (let i = 0; i < currentSequence.length; i++) {
      if (token !== playToken) return;

      const item = currentSequence[i];
      if (!item.found) continue;

      const card = cards[i];
      if (!card) continue;

      card.classList.add("current");
      card.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });

      const m = card.querySelector(".seq-playable");

      if (m?.tagName === "VIDEO") {
        try {
          m.muted = true;
          m.currentTime = 0;
          await m.play();

          await new Promise(resolve => {
            let done = false;
            const finish = () => {
              if (done) return;
              done = true;
              resolve();
            };
            m.addEventListener("ended", finish, { once: true });
            m.addEventListener("error", finish, { once: true });
            setTimeout(finish, Math.max(1600, ((m.duration || 3) + .8) * 1000));
          });
        } catch {
          await new Promise(r => setTimeout(r, 900));
        }
      } else {
        await new Promise(r => setTimeout(r, 1100));
      }

      card.classList.remove("current");
    }
  }

  $("#translateBtn").onclick = translate;
  $("#playAgainBtn").onclick = playSequence;

  $("#stopBtn").onclick = () => {
    playToken++;
    $$(".seq-playable").forEach(m => {
      if (m.tagName === "VIDEO") {
        m.pause();
        try { m.currentTime = 0; } catch {}
      }
    });
    $$(".seq-card").forEach(c => c.classList.remove("current"));
  };

  $("#sequence").onclick = event => {
    const btn = event.target.closest("[data-add-missing]");
    if (!btn) return;
    openEntry();
    $("#wordInput").value = btn.dataset.addMissing;
  };

  function blobToURL(blob) {
    return new Promise((res, rej) => {
      if (!blob) return res(null);
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  function urlToBlob(s) {
    if (!s) return null;
    const [head, data] = s.split(",");
    const mime = head.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
    const bytes = atob(data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  $("#exportBtn").onclick = async () => {
    const data = [];
    for (const entry of await all()) {
      data.push({
        ...entry,
        mediaBlob: undefined,
        mediaData: await blobToURL(entry.mediaBlob)
      });
    }

    const blob = new Blob([JSON.stringify({
      app: "ZeichenLex",
      version: 4,
      entries: data
    })], { type: "application/json" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zeichenlex-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup erstellt");
  };

  $("#importInput").onchange = async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.entries)) throw new Error("bad file");

      for (const raw of parsed.entries) {
        await put({
          ...raw,
          id: raw.id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
          aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
          favorite: !!raw.favorite,
          mediaBlob: urlToBlob(raw.mediaData),
          mediaTransform: { ...defaultTransform(), ...(raw.mediaTransform || {}) },
          cloudMediaPath: null,
          cloudSyncedAt: null,
          _syncPending: true,
          _mediaDirty: !!urlToBlob(raw.mediaData),
          updatedAt: Date.now()
        });
      }

      await refresh();
      toast(`${parsed.entries.length} Einträge importiert`);
      syncCloud({ silent: true });
    } catch {
      alert("Die Datei konnte nicht importiert werden.");
    }

    event.target.value = "";
  };

  $("#deleteAllBtn").onclick = async () => {
    if (
      confirm("Wirklich ALLE Gebärden löschen?") &&
      confirm("Letzte Bestätigung: Das kann nicht rückgängig gemacht werden.")
    ) {
      try {
        await deleteCloudCollection();
      } catch (error) {
        console.warn(error);
      }
      await clearAll();
      await refresh();
      toast("Alle Daten gelöscht");
      syncCloud({ silent: true });
    }
  };

  function connection() {
    const e = $("#connectionState");
    e.textContent = navigator.onLine ? "● Online" : "● Offline";
    e.style.color = navigator.onLine ? "#86efac" : "#fbbf24";
  }

  window.addEventListener("online", () => {
    connection();
    syncCloud({ silent: true });
  });
  window.addEventListener("offline", connection);
  connection();

  $("#syncNowBtn").onclick = () => syncCloud({ silent: false });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncCloud({ silent: true });
  });

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#installBtn").classList.remove("hidden");
  });

  async function install() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      $("#installBtn").classList.add("hidden");
    } else {
      toast('Im Browser-Menü „App installieren“ wählen');
    }
  }

  $("#installBtn").onclick = install;
  $("#settingsInstallBtn").onclick = install;
  window.addEventListener("appinstalled", () => toast("ZeichenLex installiert"));

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }

  openDB()
    .then(async () => {
      await refresh();
      if (cloudConfigured()) {
        await syncCloud({ silent: true });
        startCloudSync();
      } else {
        setCloudStatus("", "Noch nicht eingerichtet – URL und anon key in cloud-config.js eintragen.");
      }
    })
    .catch(() => alert("Der lokale Speicher konnte nicht geöffnet werden."));
})();