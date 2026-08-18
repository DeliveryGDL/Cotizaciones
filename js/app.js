/* =========================================================
   DELIVERY GDL · Cotizador — lógica de la app
   Persistencia: localStorage (100% en el dispositivo del usuario)
   ========================================================= */
 
(() => {
  "use strict";
 
  /* ---------------- Almacenamiento ---------------- */
  const LS_SETTINGS = "gdl_settings";
  const LS_QUOTES = "gdl_quotes";
 
  const defaultSettings = {
    name: "DELIVERY GDL",
    phone: "",
    zone: "Guadalajara y zona metropolitana",
    footer: "Gracias por tu preferencia",
    nextFolio: 1,
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
 
  let settings = loadSettings();
  let quotes = loadQuotes();
 
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
 
  function savedCardEl(q) {
    const { total } = computeTotals(q.items, q.discount);
    const extra = q.status === "pedido" && q.pedido
      ? ` · Entrega ${q.pedido.fechaEstimada ? formatDate(q.pedido.fechaEstimada) : "—"}`
      : "";
    const card = document.createElement("div");
    card.className = "saved-card";
    card.innerHTML = `
      <div class="saved-main">
        <strong>${escapeHtml(q.client)}</strong>
        <span class="saved-meta">${q.folioLabel} · ${formatDate(q.date)}${extra}</span>
      </div>
      <div class="saved-amount">
        <div class="amt">${money(total)}</div>
        <span class="status-badge ${q.status}">${q.status === "pedido" ? "Pedido" : "Activa"}</span>
      </div>
    `;
    card.addEventListener("click", () => openViewer(q.id));
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
      document.getElementById("oiAnticipo").textContent = money(anticipo);
      document.getElementById("oiSaldo").textContent = money(Math.max(total - anticipo, 0));
      document.getElementById("oiFecha").textContent = q.pedido && q.pedido.fechaEstimada ? formatDate(q.pedido.fechaEstimada) : "—";
      document.getElementById("oiPhone").textContent = (q.pedido && q.pedido.clientPhone) || "—";
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
 
  /* ---------------- Tabs ---------------- */
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      document.getElementById(`view-${tab.dataset.tab}`).classList.add("active");
    });
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
