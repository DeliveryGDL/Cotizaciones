/* =========================================================
   DELIVERY GDL · Cotizador — lógica de la app
   Persistencia: localStorage (100% en el dispositivo del usuario)
   ========================================================= */
 
(() => {
  "use strict";
 
  /* ---------------- Almacenamiento ---------------- */
  const LS_SETTINGS = "gdl_settings";
  const LS_QUOTES = "gdl_quotes";
  const LS_LOTES = "gdl_lotes";
 
  const defaultSettings = {
    name: "DELIVERY GDL",
    phone: "",
    zone: "Guadalajara y zona metropolitana",
    footer: "Gracias por tu preferencia",
    nextFolio: 1,
    nextLoteFolio: 1,
  };
 
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
    } catch (e) {
      return { ...defaultSettings };
    }
  }
  function saveSettings(s) {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  }
  function loadQuotes() {
    try {
      const raw = localStorage.getItem(LS_QUOTES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveQuotes(list) {
    localStorage.setItem(LS_QUOTES, JSON.stringify(list));
  }
  function loadLotes() {
    try {
      const raw = localStorage.getItem(LS_LOTES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function saveLotes(list) {
    localStorage.setItem(LS_LOTES, JSON.stringify(list));
  }
 
  let settings = loadSettings();
  let quotes = loadQuotes();
  let lotes = loadLotes();
 
  /* ---------------- Tabs (se registra primero: si algo más abajo llega a
     fallar, la navegación entre pestañas sigue funcionando) ---------------- */
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      const view = document.getElementById(`view-${tab.dataset.tab}`);
      if (view) view.classList.add("active");
    });
  });
 
  /* ---------------- Estado del formulario actual ---------------- */
  let items = []; // {id, name, qty, price, img}
  let editingId = null; // id de la cotización que se está editando (null = cotización nueva)
 
  /* ---------------- Utilidades ---------------- */
  function uid() {
    return "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function itemUid() {
    return "it" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function money(n) {
    const v = isFinite(n) ? n : 0;
    return v.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  }
  function folioStr(n) {
    return "GDL-" + String(n).padStart(4, "0");
  }
  function loteFolioStr(n) {
    return "LOTE-" + String(n).padStart(2, "0");
  }
 
  /* ---------------- Etapas de pedido / lote (rastreo) ---------------- */
  const PEDIDO_STAGES = [
    { key: "preparacion", label: "En preparación" },
    { key: "comprado", label: "Comprado" },
    { key: "en_camino", label: "En camino" },
    { key: "en_mexico", label: "Llegó a México" },
    { key: "listo_entrega", label: "Listo para entrega" },
  ];
  function stageLabel(key) {
    const s = PEDIDO_STAGES.find((s) => s.key === key);
    return s ? s.label : "En preparación";
  }
 
  /* ---------------- Pastilla de % cobrado ---------------- */
  function paymentPct(cobrado, esperado) {
    if (!esperado || esperado <= 0) return 0;
    return Math.min(100, (cobrado / esperado) * 100);
  }
  function pillClass(pct) {
    if (pct >= 80) return "pill-green";
    if (pct >= 50) return "pill-yellow";
    if (pct >= 30) return "pill-red";
    if (pct >= 10) return "pill-purple";
    return "pill-gray";
  }
  function todayISO() {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }
  function formatDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => t.classList.remove("show"), 2200);
  }
 
  function resizeImageFile(file, maxDim = 480, quality = 0.72) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Imagen inválida"));
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height >= width && height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
 
  /* ---------------- Render: lista editable de productos ---------------- */
  const itemsListEl = document.getElementById("itemsList");
  const itemCountHint = document.getElementById("itemCountHint");
 
  function renderItemsList() {
    itemsListEl.innerHTML = "";
    items.forEach((item) => {
      const card = document.createElement("div");
      card.className = "item-card";
      card.dataset.id = item.id;
      card.innerHTML = `
        <div class="item-thumb" title="Subir foto">
          ${item.img ? `<img src="${item.img}" alt="">` : `<span class="placeholder">📷</span>`}
          <input type="file" accept="image/*" capture="environment" class="item-file">
        </div>
        <input type="text" class="item-desc" placeholder="Descripción del producto" value="${escapeHtml(item.name)}">
        <button type="button" class="item-remove" aria-label="Quitar">✕</button>
        <div class="item-nums">
          <div class="mini-field">
            <label>Cant.</label>
            <input type="number" class="item-qty" min="0" step="1" value="${item.qty}">
          </div>
          <div class="mini-field">
            <label>Precio</label>
            <input type="number" class="item-price price-input" min="0" step="0.01" value="${item.price}">
          </div>
        </div>
      `;
      itemsListEl.appendChild(card);
 
      card.querySelector(".item-file").addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          item.img = await resizeImageFile(file);
          renderItemsList();
          renderTicket();
        } catch (err) {
          toast("No se pudo procesar la imagen");
        }
      });
      card.querySelector(".item-desc").addEventListener("input", (e) => {
        item.name = e.target.value;
        renderTicket();
      });
      card.querySelector(".item-qty").addEventListener("input", (e) => {
        item.qty = parseFloat(e.target.value) || 0;
        renderTicket();
      });
      card.querySelector(".item-price").addEventListener("input", (e) => {
        item.price = parseFloat(e.target.value) || 0;
        renderTicket();
      });
      card.querySelector(".item-remove").addEventListener("click", () => {
        items = items.filter((i) => i.id !== item.id);
        renderItemsList();
        renderTicket();
      });
    });
    itemCountHint.textContent = `${items.length} artículo${items.length === 1 ? "" : "s"}`;
  }
 
  document.getElementById("addItemBtn").addEventListener("click", () => {
    items.push({ id: itemUid(), name: "", qty: 1, price: 0, img: null });
    renderItemsList();
    renderTicket();
  });
 
  /* ---------------- Descuento ---------------- */
  const discountEnabled = document.getElementById("discountEnabled");
  const discountFields = document.getElementById("discountFields");
  const discountType = document.getElementById("discountType");
  const discountValue = document.getElementById("discountValue");
 
  discountEnabled.addEventListener("change", () => {
    discountFields.hidden = !discountEnabled.checked;
    renderTicket();
  });
  [discountType, discountValue].forEach((el) => el.addEventListener("input", renderTicket));
 
  /* ---------------- Cálculo de totales ---------------- */
  function computeTotals(quoteItems, discount) {
    const subtotal = quoteItems.reduce((sum, i) => sum + (i.qty * i.price || 0), 0);
    let discountAmount = 0;
    if (discount && discount.enabled) {
      if (discount.type === "percent") {
        discountAmount = subtotal * (Math.min(discount.value, 100) / 100);
      } else {
        discountAmount = Math.min(discount.value, subtotal);
      }
    }
    const total = Math.max(subtotal - discountAmount, 0);
    return { subtotal, discountAmount, total };
  }
 
  function currentDiscount() {
    return {
      enabled: discountEnabled.checked,
      type: discountType.value,
      value: parseFloat(discountValue.value) || 0,
    };
  }
 
  /* ---------------- Plantilla del ticket (usada en vivo, guardado y PDF) ---------------- */
  function ticketHTML(quote) {
    const { subtotal, discountAmount, total } = computeTotals(quote.items, quote.discount);
    const hasDiscount = quote.discount && quote.discount.enabled && discountAmount > 0;
 
    const itemsHTML = quote.items.length
      ? quote.items.map((it) => `
        <div class="tk-item">
          <div class="tk-thumb ${it.img ? "" : "empty"}">
            ${it.img ? `<img src="${it.img}" alt="">` : "🧾"}
          </div>
          <div class="tk-item-info">
            <div class="tk-item-name">${escapeHtml(it.name || "Producto sin nombre")}</div>
            <div class="tk-item-calc">${it.qty} × ${money(it.price)}</div>
          </div>
          <div class="tk-item-amount">${money(it.qty * it.price)}</div>
        </div>
      `).join("")
      : `<div class="tk-empty-items">Agrega productos para ver la cotización</div>`;
 
    const totalsHTML = `
      ${hasDiscount ? `
        <div class="tk-row muted"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        <div class="tk-row discount"><span>Descuento${quote.discount.type === "percent" ? ` (${quote.discount.value}%)` : ""}</span><span>&minus;${money(discountAmount)}</span></div>
      ` : ""}
      <div class="tk-row total"><span>Total</span><span>${money(total)}</span></div>
    `;
 
    return `
      <div class="tk-header">
        <div class="tk-brand">${escapeHtml(settings.name)}</div>
        <div class="tk-sub">${escapeHtml([settings.zone, settings.phone].filter(Boolean).join(" · "))}</div>
        <div class="tk-folio">COTIZACIÓN ${escapeHtml(quote.folioLabel)}</div>
      </div>
      <div class="tk-divider"></div>
      <div class="tk-meta"><span>Cliente</span><span>${escapeHtml(quote.client || "—")}</span></div>
      <div class="tk-meta"><span>Fecha</span><span>${formatDate(quote.date)}</span></div>
      <div class="tk-divider"></div>
      <div class="tk-items">${itemsHTML}</div>
      <div class="tk-divider"></div>
      <div class="tk-totals">${totalsHTML}</div>
      ${quote.notes ? `<div class="tk-notes">${escapeHtml(quote.notes)}</div>` : ""}
      <div class="tk-footer">
        <span class="thanks">${escapeHtml(settings.footer)}</span>
        Esta cotización no incluye envío salvo que se indique lo contrario.
      </div>
      <div class="tk-barcode"></div>
    `;
  }
 
  function buildQuoteFromForm() {
    return {
      client: document.getElementById("clientName").value.trim(),
      date: document.getElementById("quoteDate").value || todayISO(),
      items: items,
      discount: currentDiscount(),
      notes: document.getElementById("notes").value.trim(),
      folioLabel: folioStr(settings.nextFolio),
    };
  }
 
  const ticketPreviewEl = document.getElementById("ticketPreview");
  function renderTicket() {
    ticketPreviewEl.innerHTML = ticketHTML(buildQuoteFromForm());
  }
 
  /* ---------------- Folios: mantener numeración continua ---------------- */
  function renumberFolios() {
    const sorted = [...quotes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    sorted.forEach((q, idx) => {
      q.folio = idx + 1;
      q.folioLabel = folioStr(q.folio);
    });
    settings.nextFolio = quotes.length + 1;
    saveQuotes(quotes);
    saveSettings(settings);
  }
  function renumberLoteFolios() {
    const sorted = [...lotes].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    sorted.forEach((l, idx) => {
      l.folio = idx + 1;
      l.folioLabel = loteFolioStr(l.folio);
    });
    settings.nextLoteFolio = lotes.length + 1;
    saveLotes(lotes);
    saveSettings(settings);
  }
 
  /* ---------------- Modo edición ---------------- */
  const editBanner = document.getElementById("editBanner");
  const editBannerText = document.getElementById("editBannerText");
  const saveQuoteBtn = document.getElementById("saveQuoteBtn");
 
  function updateFormMode() {
    if (editingId) {
      const q = quotes.find((x) => x.id === editingId);
      editBannerText.textContent = `Editando cotización ${q ? q.folioLabel : ""}`;
      editBanner.hidden = false;
      saveQuoteBtn.textContent = "Guardar cambios";
    } else {
      editBanner.hidden = true;
      saveQuoteBtn.textContent = "Guardar cotización";
    }
  }
 
  function openEditFromViewer(id) {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    editingId = id;
    items = q.items.map((it) => ({ ...it }));
    document.getElementById("clientName").value = q.client;
    document.getElementById("quoteDate").value = q.date;
    document.getElementById("notes").value = q.notes || "";
    discountEnabled.checked = !!(q.discount && q.discount.enabled);
    discountFields.hidden = !discountEnabled.checked;
    discountType.value = (q.discount && q.discount.type) || "percent";
    discountValue.value = (q.discount && q.discount.value) || "";
 
    renderItemsList();
    renderTicket();
    updateFormMode();
 
    viewerModal.hidden = true;
    document.querySelector('.tab[data-tab="nueva"]').click();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
 
  document.getElementById("cancelEditBtn").addEventListener("click", () => {
    editingId = null;
    resetForm();
    toast("Edición cancelada");
  });
 
  /* ---------------- Guardar cotización ---------------- */
  saveQuoteBtn.addEventListener("click", () => {
    const client = document.getElementById("clientName").value.trim();
    if (!client) {
      toast("Escribe el nombre del cliente");
      document.getElementById("clientName").focus();
      return;
    }
    if (items.length === 0) {
      toast("Agrega al menos un producto");
      return;
    }
 
    if (editingId) {
      const q = quotes.find((x) => x.id === editingId);
      if (!q) { editingId = null; resetForm(); return; }
      q.client = client;
      q.date = document.getElementById("quoteDate").value || todayISO();
      q.items = items;
      q.discount = currentDiscount();
      q.notes = document.getElementById("notes").value.trim();
      q.updatedAt = new Date().toISOString();
      saveQuotes(quotes);
      toast(`Cotización ${q.folioLabel} actualizada`);
      editingId = null;
      renderLists();
      resetForm();
      return;
    }
 
    const quote = buildQuoteFromForm();
    quote.id = uid();
    quote.status = "activa";
    quote.createdAt = new Date().toISOString();
    quote.folio = settings.nextFolio;
 
    quotes.unshift(quote);
    saveQuotes(quotes);
 
    settings.nextFolio += 1;
    saveSettings(settings);
 
    toast(`Cotización ${quote.folioLabel} guardada`);
    renderLists();
    resetForm();
  });
 
  function resetForm() {
    items = [];
    document.getElementById("clientName").value = "";
    document.getElementById("quoteDate").value = todayISO();
    document.getElementById("notes").value = "";
    discountEnabled.checked = false;
    discountFields.hidden = true;
    discountValue.value = "";
    discountType.value = "percent";
    renderItemsList();
    renderTicket();
    updateFormMode();
  }
 
  /* ---------------- Listas: Activas y Pedidos ---------------- */
  const savedListEl = document.getElementById("savedList");
  const emptyMsgEl = document.getElementById("emptyMsg");
  const tabCountEl = document.getElementById("tabCount");
  const pedidosListEl = document.getElementById("pedidosList");
  const emptyMsgPedidosEl = document.getElementById("emptyMsgPedidos");
  const pedidosCountEl = document.getElementById("pedidosCount");
  const lotesListEl = document.getElementById("lotesList");
  const emptyMsgLotesEl = document.getElementById("emptyMsgLotes");
  const lotesCountEl = document.getElementById("lotesCount");
 
  function savedCardEl(q) {
    const { total } = computeTotals(q.items, q.discount);
    const card = document.createElement("div");
    card.className = "saved-card";
 
    if (q.status === "pedido") {
      const anticipo = (q.pedido && q.pedido.anticipo) || 0;
      const pct = paymentPct(anticipo, total);
      const lote = q.loteId ? lotes.find((l) => l.id === q.loteId) : null;
      const extraBits = [];
      if (q.pedido && q.pedido.fechaEstimada) extraBits.push(`Entrega ${formatDate(q.pedido.fechaEstimada)}`);
      if (lote) extraBits.push(lote.folioLabel);
      const extra = extraBits.length ? ` · ${extraBits.join(" · ")}` : "";
      card.innerHTML = `
        <div class="saved-main">
          <strong>${escapeHtml(q.client)}</strong>
          <span class="saved-meta">${q.folioLabel} · ${formatDate(q.date)}${extra}</span>
        </div>
        <div class="saved-amount">
          <div class="amt">${money(total)}</div>
          <div class="badge-row">
            <span class="status-badge stage-${q.pedidoStatus || "preparacion"}">${stageLabel(q.pedidoStatus)}</span>
            <span class="pay-pill ${pillClass(pct)}">${Math.round(pct)}%</span>
          </div>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="saved-main">
          <strong>${escapeHtml(q.client)}</strong>
          <span class="saved-meta">${q.folioLabel} · ${formatDate(q.date)}</span>
        </div>
        <div class="saved-amount">
          <div class="amt">${money(total)}</div>
          <span class="status-badge activa">Activa</span>
        </div>
      `;
    }
    card.addEventListener("click", () => openViewer(q.id));
    return card;
  }
 
  function loteFinancials(lote) {
    const members = quotes.filter((q) => q.loteId === lote.id);
    const esperado = members.reduce((s, q) => s + computeTotals(q.items, q.discount).total, 0);
    const cobrado = members.reduce((s, q) => s + ((q.pedido && q.pedido.anticipo) || 0), 0);
    const costoTotal = (lote.costoMercancia || 0) + (lote.costoEnvio || 0);
    const ganancia = esperado - costoTotal;
    const pendiente = Math.max(esperado - cobrado, 0);
    const pct = paymentPct(cobrado, esperado);
    return { members, esperado, cobrado, costoTotal, ganancia, pendiente, pct };
  }
 
  function loteCardEl(l) {
    const f = loteFinancials(l);
    const card = document.createElement("div");
    card.className = "saved-card";
    card.innerHTML = `
      <div class="saved-main">
        <strong>${escapeHtml(l.folioLabel)}${l.label ? " · " + escapeHtml(l.label) : ""}</strong>
        <span class="saved-meta">${f.members.length} pedido${f.members.length === 1 ? "" : "s"} · costo ${money(f.costoTotal)} · ganancia ${money(f.ganancia)}</span>
      </div>
      <div class="saved-amount">
        <div class="amt">${money(f.esperado)}</div>
        <div class="badge-row">
          <span class="status-badge stage-${l.status}">${stageLabel(l.status)}</span>
          <span class="pay-pill ${pillClass(f.pct)}">${Math.round(f.pct)}%</span>
        </div>
      </div>
    `;
    card.addEventListener("click", () => openLoteModal(l.id));
    return card;
  }
 
  function renderLists() {
    const activas = quotes.filter((q) => q.status === "activa");
    const pedidos = quotes.filter((q) => q.status === "pedido");
 
    savedListEl.innerHTML = "";
    activas.forEach((q) => savedListEl.appendChild(savedCardEl(q)));
    tabCountEl.textContent = activas.length;
    emptyMsgEl.hidden = activas.length > 0;
 
    pedidosListEl.innerHTML = "";
    pedidos.forEach((q) => pedidosListEl.appendChild(savedCardEl(q)));
    pedidosCountEl.textContent = pedidos.length;
    emptyMsgPedidosEl.hidden = pedidos.length > 0;
 
    lotesListEl.innerHTML = "";
    lotes.forEach((l) => lotesListEl.appendChild(loteCardEl(l)));
    lotesCountEl.textContent = lotes.length;
    emptyMsgLotesEl.hidden = lotes.length > 0;
  }
 
  /* ---------------- Visor / modal de cotización guardada ---------------- */
  const viewerModal = document.getElementById("viewerModal");
  const viewerTicket = document.getElementById("viewerTicket");
  const viewerTitle = document.getElementById("viewerTitle");
  const slideConfirm = document.getElementById("slideConfirm");
  const orderInfo = document.getElementById("orderInfo");
  let viewerQuoteId = null;
 
  function openViewer(id) {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    viewerQuoteId = id;
    viewerTitle.textContent = `${q.folioLabel} · ${q.client}`;
    viewerTicket.innerHTML = ticketHTML(q);
 
    if (q.status === "pedido") {
      slideConfirm.hidden = true;
      orderInfo.hidden = false;
      const { total } = computeTotals(q.items, q.discount);
      const anticipo = (q.pedido && q.pedido.anticipo) || 0;
      const lote = q.loteId ? lotes.find((l) => l.id === q.loteId) : null;
      document.getElementById("oiStageBadge").textContent = stageLabel(q.pedidoStatus);
      document.getElementById("oiStageBadge").className = `status-badge stage-${q.pedidoStatus || "preparacion"}`;
      document.getElementById("oiAnticipo").textContent = money(anticipo);
      document.getElementById("oiSaldo").textContent = money(Math.max(total - anticipo, 0));
      document.getElementById("oiFecha").textContent = q.pedido && q.pedido.fechaEstimada ? formatDate(q.pedido.fechaEstimada) : "—";
      document.getElementById("oiPhone").textContent = (q.pedido && q.pedido.clientPhone) || "—";
      document.getElementById("oiLote").textContent = lote ? lote.folioLabel : "Sin lote asignar";
      document.getElementById("oiAddress").textContent = (q.pedido && q.pedido.clientAddress)
        ? `📍 ${q.pedido.clientAddress}` : "";
    } else {
      orderInfo.hidden = true;
      slideConfirm.hidden = false;
      toOrderSlider.reset();
    }
    viewerModal.hidden = false;
  }
  document.getElementById("closeViewer").addEventListener("click", () => (viewerModal.hidden = true));
  viewerModal.addEventListener("click", (e) => { if (e.target === viewerModal) viewerModal.hidden = true; });
 
  document.getElementById("deleteQuoteBtn").addEventListener("click", () => {
    if (!viewerQuoteId) return;
    if (!confirm("¿Eliminar esta cotización? Esta acción no se puede deshacer.")) return;
    quotes = quotes.filter((q) => q.id !== viewerQuoteId);
    renumberFolios();
    renderLists();
    viewerModal.hidden = true;
    toast("Cotización eliminada — folios reacomodados");
  });
 
  document.getElementById("editQuoteBtn").addEventListener("click", () => {
    if (!viewerQuoteId) return;
    openEditFromViewer(viewerQuoteId);
  });
 
  document.getElementById("editOrderBtn").addEventListener("click", () => {
    if (!viewerQuoteId) return;
    openOrderModal(viewerQuoteId);
  });
 
  document.getElementById("viewerPdfBtn").addEventListener("click", () => {
    const q = quotes.find((x) => x.id === viewerQuoteId);
    if (!q) return;
    generatePDF(viewerTicket, `${q.folioLabel}_${q.client}`);
  });
 
  /* ---------------- Barra deslizable (fábrica reutilizable) ---------------- */
  function setupSlider(track, thumb, onConfirm) {
    let dragging = false, startX = 0, thumbX = 0, maxTravel = 0;
 
    function reset() {
      thumbX = 0;
      thumb.style.transform = "translateX(0px)";
      track.classList.remove("confirmed", "dragging");
    }
    function trackMax() {
      return track.clientWidth - thumb.offsetWidth - 8; // 8 = padding (4px * 2)
    }
    thumb.addEventListener("pointerdown", (e) => {
      dragging = true;
      startX = e.clientX - thumbX;
      maxTravel = trackMax();
      track.classList.add("dragging");
      thumb.setPointerCapture(e.pointerId);
    });
    thumb.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      let x = e.clientX - startX;
      x = Math.max(0, Math.min(x, maxTravel));
      thumbX = x;
      thumb.style.transform = `translateX(${x}px)`;
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("dragging");
      if (maxTravel > 0 && thumbX >= maxTravel * 0.82) {
        track.classList.add("confirmed");
        thumb.style.transform = `translateX(${maxTravel}px)`;
        const ok = onConfirm();
        if (ok === false) setTimeout(reset, 350);
      } else {
        reset();
      }
    }
    thumb.addEventListener("pointerup", endDrag);
    thumb.addEventListener("pointercancel", endDrag);
    return { reset };
  }
 
  // Barra 1: dentro del visor, cotización activa → abre el modal de confirmar pedido
  const toOrderSlider = setupSlider(
    document.getElementById("slideTrack"),
    document.getElementById("slideThumb"),
    () => { openOrderModal(viewerQuoteId); return true; }
  );
 
  // Barra 2: dentro del modal de confirmar pedido → guarda ya con anticipo y fecha
  const confirmOrderSlider = setupSlider(
    document.getElementById("orderSlideTrack"),
    document.getElementById("orderSlideThumb"),
    () => commitOrder()
  );
 
  /* ---------------- Confirmar pedido (modal) ---------------- */
  const orderModal = document.getElementById("orderModal");
  const orderSummary = document.getElementById("orderSummary");
  let orderQuoteId = null;
 
  function openOrderModal(id) {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    orderQuoteId = id;
    const { total } = computeTotals(q.items, q.discount);
 
    orderSummary.innerHTML = `
      <div class="os-client">${escapeHtml(q.client)} · ${escapeHtml(q.folioLabel)}</div>
      <div class="os-row"><span>${q.items.length} artículo${q.items.length === 1 ? "" : "s"}</span><span>${formatDate(q.date)}</span></div>
      <div class="os-row total"><span>Total</span><span>${money(total)}</span></div>
    `;
 
    document.getElementById("orderAnticipo").value = (q.pedido && q.pedido.anticipo) || "";
    document.getElementById("orderFecha").value = (q.pedido && q.pedido.fechaEstimada) || "";
    document.getElementById("orderClientName").value = q.client || "";
    document.getElementById("orderClientPhone").value = (q.pedido && q.pedido.clientPhone) || settings.phone || "";
    document.getElementById("orderClientAddress").value = (q.pedido && q.pedido.clientAddress) || "";
 
    viewerModal.hidden = true;
    orderModal.hidden = false;
  }
 
  function closeOrderModal() {
    orderModal.hidden = true;
    confirmOrderSlider.reset();
    if (viewerQuoteId) {
      toOrderSlider.reset();
      viewerModal.hidden = false;
    }
  }
  document.getElementById("closeOrderModal").addEventListener("click", closeOrderModal);
  document.getElementById("cancelOrderBtn").addEventListener("click", closeOrderModal);
  orderModal.addEventListener("click", (e) => { if (e.target === orderModal) closeOrderModal(); });
 
  function commitOrder() {
    const q = quotes.find((x) => x.id === orderQuoteId);
    if (!q) return false;
    const clientName = document.getElementById("orderClientName").value.trim();
    if (!clientName) {
      toast("Escribe el nombre del cliente");
      return false;
    }
    q.client = clientName;
    q.status = "pedido";
    if (!q.pedidoStatus) q.pedidoStatus = "preparacion";
    if (q.loteId === undefined) q.loteId = null;
    q.pedido = {
      anticipo: parseFloat(document.getElementById("orderAnticipo").value) || 0,
      fechaEstimada: document.getElementById("orderFecha").value || "",
      clientPhone: document.getElementById("orderClientPhone").value.trim(),
      clientAddress: document.getElementById("orderClientAddress").value.trim(),
    };
    saveQuotes(quotes);
    renderLists();
    toast(`Pedido confirmado ✓ ${q.folioLabel}`);
 
    orderModal.hidden = true;
    viewerModal.hidden = true;
    toOrderSlider.reset();
    setTimeout(() => confirmOrderSlider.reset(), 350);
 
    const pedidosTab = document.querySelector('.tab[data-tab="pedidos"]');
    if (pedidosTab) pedidosTab.click();
    return true;
  }
 
  /* ---------------- Lotes (envíos / rastreo general) ---------------- */
  const loteModal = document.getElementById("loteModal");
  let editingLoteId = null;
 
  function selectedPedidoIds() {
    return Array.from(document.querySelectorAll("#lotePedidosPicker .picker-check:checked")).map((i) => i.dataset.qid);
  }
 
  function renderLotePicker(currentLoteId) {
    const pickerEl = document.getElementById("lotePedidosPicker");
    const pedidos = quotes.filter((q) => q.status === "pedido");
    pickerEl.innerHTML = "";
    if (pedidos.length === 0) {
      pickerEl.innerHTML = `<p class="empty-msg" style="margin:8px 0;">Aún no tienes pedidos confirmados para asignar.</p>`;
      return;
    }
    pedidos.forEach((q) => {
      const otherLote = q.loteId && q.loteId !== currentLoteId ? lotes.find((l) => l.id === q.loteId) : null;
      const total = computeTotals(q.items, q.discount).total;
      const row = document.createElement("label");
      row.className = "picker-row";
      row.innerHTML = `
        <input type="checkbox" class="picker-check" data-qid="${q.id}" ${q.loteId === currentLoteId ? "checked" : ""}>
        <span class="picker-info">
          <strong>${escapeHtml(q.client)}</strong>
          <small>${q.folioLabel} · ${money(total)}${otherLote ? ` · ya en ${escapeHtml(otherLote.folioLabel)}` : ""}</small>
        </span>
      `;
      pickerEl.appendChild(row);
    });
  }
 
  function currentSelectionFinancials() {
    const ids = selectedPedidoIds();
    const members = quotes.filter((q) => ids.includes(q.id));
    const esperado = members.reduce((s, q) => s + computeTotals(q.items, q.discount).total, 0);
    const cobrado = members.reduce((s, q) => s + ((q.pedido && q.pedido.anticipo) || 0), 0);
    const costoMercancia = parseFloat(document.getElementById("loteCostoMercancia").value) || 0;
    const costoEnvio = parseFloat(document.getElementById("loteCostoEnvio").value) || 0;
    const costoTotal = costoMercancia + costoEnvio;
    const ganancia = esperado - costoTotal;
    const pendiente = Math.max(esperado - cobrado, 0);
    const pct = paymentPct(cobrado, esperado);
    return { members, esperado, cobrado, costoTotal, ganancia, pendiente, pct };
  }
 
  function refreshLoteSummary() {
    const f = currentSelectionFinancials();
    document.getElementById("loteSummary").innerHTML = `
      <div class="os-row"><span>${f.members.length} pedido${f.members.length === 1 ? "" : "s"}</span><span>Costo total ${money(f.costoTotal)}</span></div>
      <div class="os-row"><span>Ingreso esperado</span><span>${money(f.esperado)}</span></div>
      <div class="os-row"><span>Ganancia estimada</span><span>${money(f.ganancia)}</span></div>
      <div class="os-row"><span>Cobrado (anticipos)</span><span>${money(f.cobrado)}</span></div>
      <div class="os-row total"><span>Pendiente por cobrar</span><span>${money(f.pendiente)}</span></div>
      <div class="badge-row" style="justify-content:flex-start; margin-top:10px;">
        <span class="pay-pill ${pillClass(f.pct)}">${Math.round(f.pct)}% cobrado</span>
      </div>
    `;
  }
 
  document.getElementById("loteCostoMercancia").addEventListener("input", refreshLoteSummary);
  document.getElementById("loteCostoEnvio").addEventListener("input", refreshLoteSummary);
  document.getElementById("lotePedidosPicker").addEventListener("change", (e) => {
    if (e.target.classList.contains("picker-check")) refreshLoteSummary();
  });
 
  function openLoteModal(id) {
    editingLoteId = id || null;
    const l = id ? lotes.find((x) => x.id === id) : null;
 
    document.getElementById("loteModalTitle").textContent = l
      ? `${l.folioLabel}${l.label ? " · " + l.label : ""}`
      : "Nuevo lote";
    document.getElementById("loteLabel").value = l ? (l.label || "") : "";
    document.getElementById("loteStatus").value = l ? l.status : "preparacion";
    document.getElementById("loteCostoMercancia").value = l && l.costoMercancia ? l.costoMercancia : "";
    document.getElementById("loteCostoEnvio").value = l && l.costoEnvio ? l.costoEnvio : "";
    document.getElementById("deleteLoteBtn").hidden = !l;
 
    renderLotePicker(l ? l.id : null);
    refreshLoteSummary();
    loteModal.hidden = false;
  }
 
  document.getElementById("addLoteBtn").addEventListener("click", () => openLoteModal(null));
  document.getElementById("closeLoteModal").addEventListener("click", () => (loteModal.hidden = true));
  loteModal.addEventListener("click", (e) => { if (e.target === loteModal) loteModal.hidden = true; });
 
  document.getElementById("saveLoteBtn").addEventListener("click", () => {
    const selectedIds = selectedPedidoIds();
    const label = document.getElementById("loteLabel").value.trim();
    const status = document.getElementById("loteStatus").value;
    const costoMercancia = parseFloat(document.getElementById("loteCostoMercancia").value) || 0;
    const costoEnvio = parseFloat(document.getElementById("loteCostoEnvio").value) || 0;
 
    let lote;
    if (editingLoteId) {
      lote = lotes.find((x) => x.id === editingLoteId);
      if (!lote) return;
      lote.label = label;
      lote.status = status;
      lote.costoMercancia = costoMercancia;
      lote.costoEnvio = costoEnvio;
    } else {
      lote = {
        id: uid(),
        folio: settings.nextLoteFolio,
        folioLabel: loteFolioStr(settings.nextLoteFolio),
        label,
        status,
        costoMercancia,
        costoEnvio,
        createdAt: new Date().toISOString(),
        statusHistory: [],
      };
      lotes.unshift(lote);
      settings.nextLoteFolio += 1;
      saveSettings(settings);
    }
 
    // Registro simple de cambios de estatus, para rastreo general del lote.
    if (!lote.statusHistory) lote.statusHistory = [];
    const lastEntry = lote.statusHistory[lote.statusHistory.length - 1];
    if (!lastEntry || lastEntry.status !== status) {
      lote.statusHistory.push({ status, at: new Date().toISOString() });
    }
 
    // Membresía: quitar el lote de quien ya no esté marcado, asignar a quien sí,
    // y sincronizar el estatus del lote a cada pedido asignado (cascada automática).
    quotes.forEach((q) => {
      if (q.loteId === lote.id && !selectedIds.includes(q.id)) q.loteId = null;
    });
    selectedIds.forEach((qid) => {
      const q = quotes.find((x) => x.id === qid);
      if (!q) return;
      q.loteId = lote.id;
      q.pedidoStatus = lote.status;
    });
 
    saveQuotes(quotes);
    saveLotes(lotes);
    toast(editingLoteId ? `${lote.folioLabel} actualizado` : `${lote.folioLabel} creado`);
    loteModal.hidden = true;
    renderLists();
    if (viewerQuoteId) openViewer(viewerQuoteId);
  });
 
  document.getElementById("deleteLoteBtn").addEventListener("click", () => {
    if (!editingLoteId) return;
    if (!confirm("¿Eliminar este lote? Los pedidos asignados se quedan sin lote, pero conservan su estatus actual.")) return;
    quotes.forEach((q) => { if (q.loteId === editingLoteId) q.loteId = null; });
    lotes = lotes.filter((l) => l.id !== editingLoteId);
    saveQuotes(quotes);
    renumberLoteFolios();
    loteModal.hidden = true;
    toast("Lote eliminado — folios reacomodados");
    renderLists();
  });
 
  /* ---------------- Configuración (modal) ---------------- */
  const settingsModal = document.getElementById("settingsModal");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("cfgName").value = settings.name;
    document.getElementById("cfgPhone").value = settings.phone;
    document.getElementById("cfgZone").value = settings.zone;
    document.getElementById("cfgFooter").value = settings.footer;
    document.getElementById("cfgFolio").value = settings.nextFolio;
    settingsModal.hidden = false;
  });
  document.getElementById("closeSettings").addEventListener("click", () => (settingsModal.hidden = true));
  settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) settingsModal.hidden = true; });
 
  document.getElementById("saveSettingsBtn").addEventListener("click", () => {
    settings.name = document.getElementById("cfgName").value.trim() || defaultSettings.name;
    settings.phone = document.getElementById("cfgPhone").value.trim();
    settings.zone = document.getElementById("cfgZone").value.trim();
    settings.footer = document.getElementById("cfgFooter").value.trim() || defaultSettings.footer;
    settings.nextFolio = Math.max(1, parseInt(document.getElementById("cfgFolio").value) || 1);
    saveSettings(settings);
    document.getElementById("brandName").textContent = settings.name;
    settingsModal.hidden = true;
    renderTicket();
    toast("Configuración guardada");
  });
 
  /* ---------------- Generar PDF ---------------- */
  async function generatePDF(ticketEl, filenameBase) {
    const btns = [document.getElementById("pdfBtn"), document.getElementById("viewerPdfBtn")];
    btns.forEach((b) => b && (b.disabled = true));
    toast("Generando PDF…");
    try {
      const canvas = await html2canvas(ticketEl, {
        scale: 2,
        backgroundColor: "#FBF8F2",
        useCORS: true,
      });
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({
        unit: "px",
        format: [canvas.width, canvas.height],
        hotfixes: ["px_scaling"],
      });
      pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
      const safeName = (filenameBase || "cotizacion").replace(/[^a-z0-9_\-]+/gi, "_");
      pdf.save(`Cotizacion_${safeName}.pdf`);
      toast("PDF generado ✓");
    } catch (err) {
      console.error(err);
      toast("No se pudo generar el PDF");
    } finally {
      btns.forEach((b) => b && (b.disabled = false));
    }
  }
 
  document.getElementById("pdfBtn").addEventListener("click", () => {
    if (items.length === 0) {
      toast("Agrega al menos un producto");
      return;
    }
    const client = document.getElementById("clientName").value.trim() || "cliente";
    generatePDF(ticketPreviewEl, `${folioStr(settings.nextFolio)}_${client}`);
  });
 
  /* ---------------- Inicialización ---------------- */
  function init() {
    document.getElementById("brandName").textContent = settings.name;
    document.getElementById("quoteDate").value = todayISO();
    renderItemsList();
    renderTicket();
    renderLists();
    updateFormMode();
 
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => {});
      });
    }
  }
  init();
})();
