import {
  auth, db,
  signInWithEmailAndPassword, onAuthStateChanged, signOut,
  doc, getDoc, setDoc, onSnapshot,
} from "./firebase-init.js";
 
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
    // Costeo de importación (interno, nunca se muestra al cliente).
    // Quedan fijos hasta que el usuario los edite en Configuración.
    rmbToUsd: 6.8,
    dolarChina: 17.5,
    comisionPct: 10,
    envioInternoUsd: 3,
    usdPorKilo: 19.5,
    deltaDolarEnvio: 1.25,
  };
 
  // Lectura de las claves antiguas de localStorage — solo se usan una vez,
  // para migrar datos de pruebas anteriores a Firestore en el primer login.
  function loadLegacySettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      return raw ? { ...defaultSettings, ...JSON.parse(raw) } : { ...defaultSettings };
    } catch (e) {
      return { ...defaultSettings };
    }
  }
  function loadLegacyQuotes() {
    try {
      const raw = localStorage.getItem(LS_QUOTES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function loadLegacyLotes() {
    try {
      const raw = localStorage.getItem(LS_LOTES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
 
  // currentUid se asigna al iniciar sesión (ver sección de Autenticación,
  // al final del archivo). Mientras no haya sesión, guardar no hace nada.
  let currentUid = null;
  function settingsDocRef(uid) { return doc(db, "businesses", uid, "data", "settings"); }
  function quotesDocRef(uid) { return doc(db, "businesses", uid, "data", "quotes"); }
  function lotesDocRef(uid) { return doc(db, "businesses", uid, "data", "lotes"); }
 
  function saveSettings(s) {
    if (!currentUid) return;
    setDoc(settingsDocRef(currentUid), s).catch(() => toast("No se pudo guardar — revisa tu conexión"));
  }
  function saveQuotes(list) {
    if (!currentUid) return;
    setDoc(quotesDocRef(currentUid), { list }).catch(() => toast("No se pudo guardar — revisa tu conexión"));
  }
  function saveLotes(list) {
    if (!currentUid) return;
    setDoc(lotesDocRef(currentUid), { list }).catch(() => toast("No se pudo guardar — revisa tu conexión"));
  }
 
  // Se llenan de verdad cuando llegan los datos de Firestore (ver
  // attachRemoteListeners). Arrancan vacíos mientras carga la sesión.
  let settings = { ...defaultSettings };
  let quotes = [];
  let lotes = [];
 
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
  function formatDateTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const datePart = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const timePart = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return `${datePart} · ${timePart}`;
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
          <input type="file" accept="image/*" class="item-file">
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
        <div class="item-cost-row">
          <div class="mini-field">
            <label>Peso (g)</label>
            <input type="number" class="item-peso" min="0" step="1" value="${item.pesoGramos || ""}" placeholder="0">
          </div>
          <div class="mini-field">
            <label>Costo (RMB)</label>
            <input type="number" class="item-rmb" min="0" step="0.01" value="${item.costoRMB || ""}" placeholder="0">
          </div>
          <span class="item-cost-readout" data-role="costReadout">—</span>
        </div>
      `;
      itemsListEl.appendChild(card);
 
      const costReadout = card.querySelector('[data-role="costReadout"]');
      function refreshCostReadout() {
        const c = computeItemCost(item, costConfig());
        costReadout.textContent = c ? `≈ ${money(c.totalMXN)} c/u` : "—";
      }
      refreshCostReadout();
 
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
        refreshCostReadout();
        renderTicket();
      });
      card.querySelector(".item-price").addEventListener("input", (e) => {
        item.price = parseFloat(e.target.value) || 0;
        renderTicket();
      });
      card.querySelector(".item-peso").addEventListener("input", (e) => {
        item.pesoGramos = e.target.value;
        refreshCostReadout();
        renderTicket();
      });
      card.querySelector(".item-rmb").addEventListener("input", (e) => {
        item.costoRMB = e.target.value;
        refreshCostReadout();
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
 
  /* ---------------- Abonos de un pedido ----------------
     Un pedido puede recibir varios abonos a lo largo del tiempo. Se guardan
     como lista dentro de q.pedido.abonos. Si el pedido viene de una versión
     anterior de la app (un solo campo "anticipo"), se migra automáticamente
     a un primer abono la primera vez que se lee. */
  function abonosOf(q) {
    if (!q.pedido) return [];
    if (!Array.isArray(q.pedido.abonos)) {
      const legacy = q.pedido.anticipo;
      q.pedido.abonos = legacy && legacy > 0
        ? [{ id: uid(), amount: legacy, date: q.date || todayISO(), note: "Anticipo inicial" }]
        : [];
      delete q.pedido.anticipo;
    }
    return q.pedido.abonos;
  }
  function abonosTotal(q) {
    return abonosOf(q).reduce((sum, a) => sum + (a.amount || 0), 0);
  }
 
  /* ---------------- Costeo de importación (interno) ----------------
     Flujo real: RMB -> USD (tipo de cambio China) -> + comisión del agente
     de compras -> + envío interno dentro de China -> convertir a MXN con el
     "dólar en China" -> sumar envío internacional por peso, convertido con
     un dólar ligeramente más caro. Todo esto es SOLO para uso interno del
     negocio; nunca se muestra en el PDF ni al cliente. */
  function costConfig() {
    return {
      rmbToUsd: settings.rmbToUsd,
      dolarChina: settings.dolarChina,
      comisionPct: settings.comisionPct,
      envioInternoUsd: settings.envioInternoUsd,
      usdPorKilo: settings.usdPorKilo,
      deltaDolarEnvio: settings.deltaDolarEnvio,
    };
  }
  function computeItemCost(item, cfg) {
    const rmb = parseFloat(item.costoRMB) || 0;
    const gramos = parseFloat(item.pesoGramos) || 0;
    if (!rmb && !gramos) return null; // nada capturado todavía para esta prenda
 
    const usdProducto = cfg.rmbToUsd > 0 ? rmb / cfg.rmbToUsd : 0;
    const comisionUsd = usdProducto * ((cfg.comisionPct || 0) / 100);
    const envioInternoUsd = cfg.envioInternoUsd || 0;
    const subtotalChinaUsd = usdProducto + comisionUsd + envioInternoUsd;
    const costoChinaMXN = subtotalChinaUsd * (cfg.dolarChina || 0);
 
    const pesoKg = gramos / 1000;
    const dolarEnvio = (cfg.dolarChina || 0) + (cfg.deltaDolarEnvio || 0);
    const envioUsd = pesoKg * (cfg.usdPorKilo || 0);
    const envioMXN = envioUsd * dolarEnvio;
 
    return { usdProducto, comisionUsd, envioInternoUsd, costoChinaMXN, envioUsd, envioMXN, totalMXN: costoChinaMXN + envioMXN };
  }
  function quoteCostSummary(quoteItems) {
    const cfg = costConfig();
    let totalCosto = 0, withData = 0;
    quoteItems.forEach((it) => {
      const c = computeItemCost(it, cfg);
      if (c) {
        totalCosto += c.totalMXN * (it.qty || 1);
        withData++;
      }
    });
    return { totalCosto, withData, totalItems: quoteItems.length };
  }
  function renderCostSummaryInto(boxEl, bodyEl, quoteItems, discount) {
    if (!boxEl || !bodyEl) return;
    const { totalCosto, withData, totalItems } = quoteCostSummary(quoteItems);
    if (withData === 0) {
      boxEl.hidden = true;
      return;
    }
    boxEl.hidden = false;
    const { total } = computeTotals(quoteItems, discount);
    const ganancia = total - totalCosto;
    const margen = total > 0 ? (ganancia / total) * 100 : 0;
    const incompleto = withData < totalItems
      ? `<div class="cost-summary-warn">⚠️ ${totalItems - withData} de ${totalItems} producto${totalItems === 1 ? "" : "s"} sin peso/RMB capturado — este cálculo es parcial.</div>`
      : "";
    bodyEl.innerHTML = `
      <div class="os-row"><span>Costo estimado (China + envío)</span><span>${money(totalCosto)}</span></div>
      <div class="os-row"><span>Precio de venta</span><span>${money(total)}</span></div>
      <div class="os-row total"><span>Ganancia estimada</span><span>${money(ganancia)}</span></div>
      <div class="os-row muted"><span>Margen</span><span>${margen.toFixed(1)}%</span></div>
      ${incompleto}
    `;
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
      clientPhone: document.getElementById("clientPhone").value.trim(),
      date: document.getElementById("quoteDate").value || todayISO(),
      items: items,
      discount: currentDiscount(),
      notes: document.getElementById("notes").value.trim(),
      folioLabel: folioStr(settings.nextFolio),
    };
  }
 
  const ticketPreviewEl = document.getElementById("ticketPreview");
  const costSummaryBoxEl = document.getElementById("costSummaryBox");
  const costSummaryBodyEl = document.getElementById("costSummaryBody");
  function renderTicket() {
    const quote = buildQuoteFromForm();
    ticketPreviewEl.innerHTML = ticketHTML(quote);
    renderCostSummaryInto(costSummaryBoxEl, costSummaryBodyEl, quote.items, quote.discount);
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
    document.getElementById("clientPhone").value = q.clientPhone || "";
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
      q.clientPhone = document.getElementById("clientPhone").value.trim();
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
    document.getElementById("clientPhone").value = "";
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
  const clientesListEl = document.getElementById("clientesList");
  const emptyMsgClientesEl = document.getElementById("emptyMsgClientes");
  const clientesCountEl = document.getElementById("clientesCount");
 
  function savedCardEl(q) {
    const { total } = computeTotals(q.items, q.discount);
    const card = document.createElement("div");
    card.className = "saved-card";
 
    if (q.status === "pedido") {
      const anticipo = abonosTotal(q);
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
    const cobrado = members.reduce((s, q) => s + abonosTotal(q), 0);
    const costoTotal = (lote.costoMercancia || 0) + (lote.costoEnvio || 0);
    const ganancia = esperado - costoTotal;
    const pendiente = Math.max(esperado - cobrado, 0);
    const pct = paymentPct(cobrado, esperado);
    return { members, esperado, cobrado, costoTotal, ganancia, pendiente, pct };
  }
 
  /* ---------------- Clientes (agrupados por teléfono; nombre como respaldo) ---------------- */
  function aggregateClients() {
    const map = new Map();
    quotes.forEach((q) => {
      const phone = resolveClientPhone(q);
      const key = phone ? normalizePhoneMX(phone) : `name:${(q.client || "").trim().toLowerCase()}`;
      if (!key || key === "name:") return; // sin nombre ni teléfono, no hay con qué agrupar
      if (!map.has(key)) map.set(key, { key, name: "", phone: "", address: "", quotes: [], _latestAt: null });
      const entry = map.get(key);
      entry.quotes.push(q);
      const at = q.updatedAt || q.createdAt || q.date || "";
      if (!entry._latestAt || new Date(at) > new Date(entry._latestAt)) {
        entry._latestAt = at;
        entry.name = q.client || entry.name;
        if (phone) entry.phone = phone;
        if (q.pedido && q.pedido.clientAddress) entry.address = q.pedido.clientAddress;
      }
    });
    return Array.from(map.values())
      .map((c) => {
        const totalComprado = c.quotes.reduce((s, q) => s + (q.status === "pedido" ? computeTotals(q.items, q.discount).total : 0), 0);
        return { ...c, totalComprado };
      })
      .sort((a, b) => new Date(b._latestAt || 0) - new Date(a._latestAt || 0));
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
 
  function clienteCardEl(c) {
    const card = document.createElement("div");
    card.className = "saved-card";
    card.innerHTML = `
      <div class="saved-main">
        <strong>${escapeHtml(c.name || "Sin nombre")}</strong>
        <span class="saved-meta">${escapeHtml(c.phone || "Sin teléfono")} · ${c.quotes.length} cotizaci${c.quotes.length === 1 ? "ón" : "ones"}</span>
      </div>
      <div class="saved-amount">
        <div class="amt">${money(c.totalComprado)}</div>
        <span class="saved-meta">histórico comprado</span>
      </div>
    `;
    card.addEventListener("click", () => openClienteModal(c.key));
    return card;
  }
 
  const clienteModal = document.getElementById("clienteModal");
  function openClienteModal(key) {
    const c = aggregateClients().find((x) => x.key === key);
    if (!c) return;
    document.getElementById("clienteModalTitle").textContent = c.name || "Cliente";
    document.getElementById("clienteInfoGrid").innerHTML = `
      <div><span>Teléfono</span><strong>${escapeHtml(c.phone || "—")}</strong></div>
      <div><span>Domicilio</span><strong>${escapeHtml(c.address || "—")}</strong></div>
      <div><span>Cotizaciones</span><strong>${c.quotes.length}</strong></div>
      <div><span>Total histórico</span><strong>${money(c.totalComprado)}</strong></div>
    `;
    const histEl = document.getElementById("clienteHistoryList");
    histEl.innerHTML = "";
    [...c.quotes]
      .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0))
      .forEach((q) => {
        const card = savedCardEl(q);
        card.addEventListener("click", () => { clienteModal.hidden = true; });
        histEl.appendChild(card);
      });
    clienteModal.hidden = false;
  }
  document.getElementById("closeClienteModal").addEventListener("click", () => (clienteModal.hidden = true));
  clienteModal.addEventListener("click", (e) => { if (e.target === clienteModal) clienteModal.hidden = true; });
 
  function renderLists() {
    const activas = quotes.filter((q) => q.status === "activa");
    const pedidos = quotes.filter((q) => q.status === "pedido");
 
    savedListEl.innerHTML = "";
    activas.forEach((q) => savedListEl.appendChild(savedCardEl(q)));
    tabCountEl.textContent = activas.length;
    tabCountEl.hidden = activas.length === 0;
    emptyMsgEl.hidden = activas.length > 0;
 
    pedidosListEl.innerHTML = "";
    pedidos.forEach((q) => pedidosListEl.appendChild(savedCardEl(q)));
    pedidosCountEl.textContent = pedidos.length;
    pedidosCountEl.hidden = pedidos.length === 0;
    emptyMsgPedidosEl.hidden = pedidos.length > 0;
 
    lotesListEl.innerHTML = "";
    lotes.forEach((l) => lotesListEl.appendChild(loteCardEl(l)));
    lotesCountEl.textContent = lotes.length;
    lotesCountEl.hidden = lotes.length === 0;
    emptyMsgLotesEl.hidden = lotes.length > 0;
 
    const clients = aggregateClients();
    clientesListEl.innerHTML = "";
    clients.forEach((c) => clientesListEl.appendChild(clienteCardEl(c)));
    clientesCountEl.textContent = clients.length;
    clientesCountEl.hidden = clients.length === 0;
    emptyMsgClientesEl.hidden = clients.length > 0;
 
    renderDashboard(activas, pedidos);
  }
 
  /* ---------------- Dashboard (Resumen) ---------------- */
  function renderDashboard(activas, pedidos) {
    const porCobrar = pedidos.reduce((s, q) => s + Math.max(computeTotals(q.items, q.discount).total - abonosTotal(q), 0), 0);
    const cobradoTotal = pedidos.reduce((s, q) => s + abonosTotal(q), 0);
    const lotesActivos = lotes.filter((l) => l.status !== "listo_entrega").length;
    const gananciaLotes = lotes.reduce((s, l) => s + loteFinancials(l).ganancia, 0);
 
    const flowEl = document.getElementById("dashboardFlow");
    flowEl.innerHTML = `
      <div class="dash-hero">
        <div class="dash-label">Por cobrar</div>
        <div class="dash-hero-value">${money(porCobrar)}</div>
        <div class="dash-hero-label">${pedidos.length} pedido${pedidos.length === 1 ? "" : "s"} confirmado${pedidos.length === 1 ? "" : "s"}</div>
      </div>
 
      <div class="dash-stats">
        <div class="dash-stat"><span class="v">${activas.length}</span><span class="l">Activas</span></div>
        <div class="dash-stat"><span class="v good">${money(cobradoTotal)}</span><span class="l">Cobrado</span></div>
        <div class="dash-stat"><span class="v">${lotesActivos}</span><span class="l">Lotes activos</span></div>
        <div class="dash-stat"><span class="v ${gananciaLotes >= 0 ? "good" : ""}">${money(gananciaLotes)}</span><span class="l">Ganancia lotes</span></div>
      </div>
 
      ${pedidos.length > 0 ? `
        <div class="dash-stages">
          ${PEDIDO_STAGES.map((s) => {
            const count = pedidos.filter((q) => (q.pedidoStatus || "preparacion") === s.key).length;
            return `<span class="dash-stage-pill ${s.key === "listo_entrega" ? "done" : ""}"><span class="dot"></span>${s.label} <b>${count}</b></span>`;
          }).join("")}
        </div>
      ` : ""}
 
      <div class="dash-upcoming">
        <div class="dash-label">Próximas entregas</div>
        <div id="upcomingList" class="saved-list"></div>
      </div>
    `;
 
    const upcomingListEl = document.getElementById("upcomingList");
    const upcoming = pedidos
      .filter((q) => q.pedido && q.pedido.fechaEstimada)
      .sort((a, b) => new Date(a.pedido.fechaEstimada) - new Date(b.pedido.fechaEstimada))
      .slice(0, 5);
    if (upcoming.length === 0) {
      upcomingListEl.innerHTML = `<p class="empty-msg" style="margin-top:8px;">No hay entregas con fecha programada.</p>`;
    } else {
      upcoming.forEach((q) => upcomingListEl.appendChild(savedCardEl(q)));
    }
  }
 
  /* ---------------- Visor / modal de cotización guardada ---------------- */
  const viewerModal = document.getElementById("viewerModal");
  const viewerTicket = document.getElementById("viewerTicket");
  const viewerTitle = document.getElementById("viewerTitle");
  const slideConfirm = document.getElementById("slideConfirm");
  const orderInfo = document.getElementById("orderInfo");
  let viewerQuoteId = null;
 
  function renderAbonosList(q) {
    const el = document.getElementById("oiAbonosList");
    const list = abonosOf(q);
    if (list.length === 0) {
      el.innerHTML = `<p class="abonos-empty">Aún no hay abonos registrados.</p>`;
      return;
    }
    el.innerHTML = [...list]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((a) => `
        <div class="abono-row">
          <span class="abono-date">${formatDate(a.date)}</span>
          <span class="abono-note">${escapeHtml(a.note || "")}</span>
          <span class="abono-amt">${money(a.amount)}</span>
          <button type="button" class="abono-del" data-aid="${a.id}" aria-label="Eliminar abono">×</button>
        </div>
      `).join("");
  }
 
  function openViewer(id) {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    viewerQuoteId = id;
    viewerTitle.textContent = `${q.folioLabel} · ${q.client}`;
    viewerTicket.innerHTML = ticketHTML(q);
    renderCostSummaryInto(
      document.getElementById("viewerCostSummaryBox"),
      document.getElementById("viewerCostSummaryBody"),
      q.items, q.discount
    );
 
    if (q.status === "pedido") {
      slideConfirm.hidden = true;
      orderInfo.hidden = false;
      const { total } = computeTotals(q.items, q.discount);
      const anticipo = abonosTotal(q);
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
      renderAbonosList(q);
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
 
  /* ---------------- Enviar por WhatsApp ----------------
     WhatsApp no permite, desde una página web, abrir el chat de un contacto
     específico CON un archivo ya adjunto al mismo tiempo — esa combinación
     no está disponible para ningún sitio externo (solo para la propia app
     de WhatsApp). Lo más cercano y confiable: se descarga el PDF y, aparte,
     se abre directo el chat del cliente con el mensaje ya escrito — solo
     falta adjuntar el PDF desde el 📎 y dar enviar. */
  function resolveClientPhone(q) {
    return (q.pedido && q.pedido.clientPhone) || q.clientPhone || "";
  }
  function normalizePhoneMX(raw) {
    const digits = (raw || "").replace(/\D/g, "");
    if (!digits) return "";
    if (digits.length === 10) return "52" + digits; // celular MX sin lada país
    return digits; // ya trae lada país o formato distinto: se usa tal cual
  }
 
  document.getElementById("whatsappBtn").addEventListener("click", async () => {
    const q = quotes.find((x) => x.id === viewerQuoteId);
    if (!q) return;
    const rawPhone = resolveClientPhone(q);
    if (!rawPhone) {
      toast(q.status === "pedido"
        ? "Agrega el teléfono del cliente en 'Editar detalles'"
        : "Agrega el teléfono del cliente en el formulario de la cotización");
      return;
    }
    const phone = normalizePhoneMX(rawPhone);
    const { total } = computeTotals(q.items, q.discount);
    const lines = [`Hola ${q.client}, te comparto tu cotización ${q.folioLabel} de ${settings.name}.`, `Total: ${money(total)}`];
    if (q.status === "pedido") {
      const saldo = Math.max(total - abonosTotal(q), 0);
      lines.push(`Saldo pendiente: ${money(saldo)}`);
    }
    lines.push("En un momento te mando el PDF por aquí mismo. ¡Gracias!");
    const message = lines.join("\n");
 
    await generatePDF(viewerTicket, `${q.folioLabel}_${q.client}`);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
    toast("Se abrió el chat del cliente — adjunta el PDF descargado con 📎 y da enviar");
  });
 
  /* ---------------- Abonos ---------------- */
  const abonoModal = document.getElementById("abonoModal");
  let abonoQuoteId = null;
 
  function openAbonoModal(qid) {
    const q = quotes.find((x) => x.id === qid);
    if (!q) return;
    abonoQuoteId = qid;
    const total = computeTotals(q.items, q.discount).total;
    const disponible = Math.max(total - abonosTotal(q), 0);
    document.getElementById("abonoMaxNote").textContent = `Máximo disponible: ${money(disponible)}`;
    document.getElementById("abonoMonto").value = "";
    document.getElementById("abonoMonto").max = disponible;
    document.getElementById("abonoFecha").value = todayISO();
    document.getElementById("abonoNota").value = "";
    abonoModal.hidden = false;
  }
  document.getElementById("addAbonoBtn").addEventListener("click", () => {
    if (viewerQuoteId) openAbonoModal(viewerQuoteId);
  });
  function closeAbonoModal() { abonoModal.hidden = true; }
  document.getElementById("closeAbonoModal").addEventListener("click", closeAbonoModal);
  document.getElementById("cancelAbonoBtn").addEventListener("click", closeAbonoModal);
  abonoModal.addEventListener("click", (e) => { if (e.target === abonoModal) closeAbonoModal(); });
 
  document.getElementById("saveAbonoBtn").addEventListener("click", () => {
    const q = quotes.find((x) => x.id === abonoQuoteId);
    if (!q) return;
    const monto = parseFloat(document.getElementById("abonoMonto").value) || 0;
    if (monto <= 0) {
      toast("Escribe un monto válido");
      return;
    }
    const total = computeTotals(q.items, q.discount).total;
    const yaAbonado = abonosTotal(q);
    if (yaAbonado + monto > total) {
      toast(`Ese abono excede el total del pedido. Máximo disponible: ${money(Math.max(total - yaAbonado, 0))}`);
      return;
    }
    abonosOf(q).push({
      id: uid(),
      amount: monto,
      date: document.getElementById("abonoFecha").value || todayISO(),
      note: document.getElementById("abonoNota").value.trim(),
    });
    saveQuotes(quotes);
    toast("Abono agregado");
    abonoModal.hidden = true;
    renderLists();
    if (viewerQuoteId === q.id) openViewer(q.id);
  });
 
  // Eliminar un abono (delegado, porque las filas se vuelven a dibujar cada vez)
  document.getElementById("oiAbonosList").addEventListener("click", (e) => {
    const btn = e.target.closest(".abono-del");
    if (!btn) return;
    const q = quotes.find((x) => x.id === viewerQuoteId);
    if (!q) return;
    if (!confirm("¿Eliminar este abono?")) return;
    q.pedido.abonos = abonosOf(q).filter((a) => a.id !== btn.dataset.aid);
    saveQuotes(quotes);
    renderLists();
    openViewer(viewerQuoteId);
  });
 
  /* ---------------- Barra deslizable (fábrica reutilizable) ---------------- */
  function setupSlider(track, thumb, onConfirm) {
    let dragging = false, startX = 0, thumbX = 0, maxTravel = 0;
    const label = track.querySelector(".slide-label");
 
    function reset() {
      thumbX = 0;
      thumb.style.transform = "translateX(0px)";
      track.classList.remove("confirmed", "dragging");
      if (label) label.style.opacity = "1";
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
      if (label) label.style.opacity = String(Math.max(0, 1 - x / (maxTravel || 1)));
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      track.classList.remove("dragging");
      if (maxTravel > 0 && thumbX >= maxTravel * 0.82) {
        track.classList.add("confirmed");
        thumb.style.transform = `translateX(${maxTravel}px)`;
        if (label) label.style.opacity = "0";
        const ok = onConfirm();
        if (ok === false) setTimeout(reset, 350);
      } else {
        reset(); // el thumb Y el texto regresan juntos
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
    const isFirstConfirm = q.status !== "pedido";
 
    orderSummary.innerHTML = `
      <div class="os-client">${escapeHtml(q.client)} · ${escapeHtml(q.folioLabel)}</div>
      <div class="os-row"><span>${q.items.length} artículo${q.items.length === 1 ? "" : "s"}</span><span>${formatDate(q.date)}</span></div>
      <div class="os-row total"><span>Total</span><span>${money(total)}</span></div>
    `;
 
    document.getElementById("orderAnticipoFieldWrap").hidden = !isFirstConfirm;
    if (isFirstConfirm) {
      document.getElementById("orderAnticipo").value = "";
      document.getElementById("orderAnticipo").max = total;
      document.getElementById("orderAnticipoNote").textContent = `No puede ser mayor al total del pedido (${money(total)}).`;
    } else {
      document.getElementById("orderAnticipoNote").textContent = "";
    }
    document.getElementById("orderFecha").value = (q.pedido && q.pedido.fechaEstimada) || "";
    document.getElementById("orderClientName").value = q.client || "";
    document.getElementById("orderClientPhone").value = (q.pedido && q.pedido.clientPhone) || q.clientPhone || "";
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
    const total = computeTotals(q.items, q.discount).total;
    const isFirstConfirm = q.status !== "pedido";
 
    if (isFirstConfirm) {
      const anticipoInicial = parseFloat(document.getElementById("orderAnticipo").value) || 0;
      if (anticipoInicial > total) {
        toast(`El anticipo no puede ser mayor al total del pedido (${money(total)})`);
        return false;
      }
    }
 
    if (!q.pedido) q.pedido = {};
    if (!Array.isArray(q.pedido.abonos)) q.pedido.abonos = [];
    if (isFirstConfirm) {
      const anticipoInicial = parseFloat(document.getElementById("orderAnticipo").value) || 0;
      if (anticipoInicial > 0) {
        q.pedido.abonos.push({ id: uid(), amount: anticipoInicial, date: todayISO(), note: "Anticipo inicial" });
      }
    }
    q.pedido.fechaEstimada = document.getElementById("orderFecha").value || "";
    q.pedido.clientPhone = document.getElementById("orderClientPhone").value.trim();
    q.pedido.clientAddress = document.getElementById("orderClientAddress").value.trim();
 
    q.client = clientName;
    q.status = "pedido";
    if (!q.pedidoStatus) q.pedidoStatus = "preparacion";
    if (q.loteId === undefined) q.loteId = null;
 
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
    const cobrado = members.reduce((s, q) => s + abonosTotal(q), 0);
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
 
  function renderLoteTimeline(l) {
    const wrap = document.getElementById("loteTimeline");
    const label = document.getElementById("loteTimelineLabel");
    const history = l && Array.isArray(l.statusHistory) ? l.statusHistory : [];
    if (history.length === 0) {
      label.hidden = true;
      wrap.innerHTML = "";
      return;
    }
    label.hidden = false;
    wrap.innerHTML = [...history]
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .map((h, idx, arr) => `
        <div class="timeline-row">
          <div class="timeline-dot-col">
            <div class="timeline-dot"></div>
            ${idx < arr.length - 1 ? `<div class="timeline-line"></div>` : ""}
          </div>
          <div class="timeline-body">
            <strong>${stageLabel(h.status)}</strong>
            <small>${formatDateTime(h.at)}</small>
          </div>
        </div>
      `).join("");
  }
 
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
    renderLoteTimeline(l);
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
    document.getElementById("cfgRmbToUsd").value = settings.rmbToUsd;
    document.getElementById("cfgDolarChina").value = settings.dolarChina;
    document.getElementById("cfgComisionPct").value = settings.comisionPct;
    document.getElementById("cfgEnvioInternoUsd").value = settings.envioInternoUsd;
    document.getElementById("cfgUsdPorKilo").value = settings.usdPorKilo;
    document.getElementById("cfgDeltaDolarEnvio").value = settings.deltaDolarEnvio;
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
    settings.rmbToUsd = parseFloat(document.getElementById("cfgRmbToUsd").value) || defaultSettings.rmbToUsd;
    settings.dolarChina = parseFloat(document.getElementById("cfgDolarChina").value) || defaultSettings.dolarChina;
    settings.comisionPct = parseFloat(document.getElementById("cfgComisionPct").value) || 0;
    settings.envioInternoUsd = parseFloat(document.getElementById("cfgEnvioInternoUsd").value) || 0;
    settings.usdPorKilo = parseFloat(document.getElementById("cfgUsdPorKilo").value) || defaultSettings.usdPorKilo;
    settings.deltaDolarEnvio = parseFloat(document.getElementById("cfgDeltaDolarEnvio").value) || 0;
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
 
  /* ---------------- Autenticación y sincronización ---------------- */
  const loginGateEl = document.getElementById("loginGate");
  const appShellEl = document.getElementById("appShell");
  const loginFormEl = document.getElementById("loginForm");
  const loginErrorEl = document.getElementById("loginError");
  const loginSubmitBtn = document.getElementById("loginSubmitBtn");
 
  let unsubSettings = null, unsubQuotes = null, unsubLotes = null;
 
  // La primera vez que alguien entra y la nube está vacía, se sube lo que
  // ya hubiera guardado ESTE dispositivo en localStorage (de antes de tener
  // sincronización), para no perder cotizaciones de prueba anteriores.
  async function migrateLegacyDataIfNeeded(uid) {
    try {
      const [qSnap, lSnap, sSnap] = await Promise.all([
        getDoc(quotesDocRef(uid)),
        getDoc(lotesDocRef(uid)),
        getDoc(settingsDocRef(uid)),
      ]);
      if (qSnap.exists() || lSnap.exists() || sSnap.exists()) return; // ya hay datos en la nube
 
      const legacyQuotes = loadLegacyQuotes();
      const legacyLotes = loadLegacyLotes();
      const legacySettings = loadLegacySettings();
 
      await setDoc(settingsDocRef(uid), legacySettings);
      if (legacyQuotes.length > 0) await setDoc(quotesDocRef(uid), { list: legacyQuotes });
      if (legacyLotes.length > 0) await setDoc(lotesDocRef(uid), { list: legacyLotes });
 
      if (legacyQuotes.length > 0 || legacyLotes.length > 0) {
        toast("Se migraron tus datos de este dispositivo a la nube ✓");
      }
    } catch (e) {
      console.error("Migración fallida:", e);
    }
  }
 
  function attachRemoteListeners(uid) {
    unsubSettings = onSnapshot(settingsDocRef(uid), (snap) => {
      settings = snap.exists() ? { ...defaultSettings, ...snap.data() } : { ...defaultSettings };
      document.getElementById("brandName").textContent = settings.name;
      renderTicket();
    });
    unsubQuotes = onSnapshot(quotesDocRef(uid), (snap) => {
      quotes = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
      renderLists();
      if (viewerQuoteId && !quotes.find((x) => x.id === viewerQuoteId)) viewerModal.hidden = true;
    });
    unsubLotes = onSnapshot(lotesDocRef(uid), (snap) => {
      lotes = snap.exists() && Array.isArray(snap.data().list) ? snap.data().list : [];
      renderLists();
    });
  }
 
  function detachRemoteListeners() {
    if (unsubSettings) unsubSettings();
    if (unsubQuotes) unsubQuotes();
    if (unsubLotes) unsubLotes();
    unsubSettings = unsubQuotes = unsubLotes = null;
  }
 
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUid = user.uid;
      loginErrorEl.hidden = true;
      loginFormEl.reset();
      await migrateLegacyDataIfNeeded(currentUid);
      attachRemoteListeners(currentUid);
      loginGateEl.hidden = true;
      appShellEl.hidden = false;
    } else {
      detachRemoteListeners();
      currentUid = null;
      settings = { ...defaultSettings };
      quotes = [];
      lotes = [];
      renderLists();
      renderTicket();
      appShellEl.hidden = true;
      loginGateEl.hidden = false;
    }
  });
 
  loginFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginErrorEl.hidden = true;
    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = "Entrando…";
    try {
      await signInWithEmailAndPassword(
        auth,
        document.getElementById("loginEmail").value.trim(),
        document.getElementById("loginPassword").value
      );
    } catch (err) {
      loginErrorEl.textContent = "Correo o contraseña incorrectos.";
      loginErrorEl.hidden = false;
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = "Entrar";
    }
  });
 
  document.getElementById("logoutBtn").addEventListener("click", () => {
    if (!confirm("¿Cerrar sesión en este dispositivo?")) return;
    settingsModal.hidden = true;
    signOut(auth);
  });
})();
 
