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
  let itemSeq = 1;

  /* ---------------- Utilidades ---------------- */
  function uid() {
    return "q" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    items.push({ id: "it" + itemSeq++, name: "", qty: 1, price: 0, img: null });
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

  /* ---------------- Guardar cotización ---------------- */
  document.getElementById("saveQuoteBtn").addEventListener("click", () => {
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
    renderSavedList();
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
  }

  /* ---------------- Lista de cotizaciones activas ---------------- */
  const savedListEl = document.getElementById("savedList");
  const emptyMsgEl = document.getElementById("emptyMsg");
  const tabCountEl = document.getElementById("tabCount");

  function renderSavedList() {
    savedListEl.innerHTML = "";
    tabCountEl.textContent = quotes.filter((q) => q.status === "activa").length;
    emptyMsgEl.hidden = quotes.length > 0;

    quotes.forEach((q) => {
      const { total } = computeTotals(q.items, q.discount);
      const card = document.createElement("div");
      card.className = "saved-card";
      card.innerHTML = `
        <div class="saved-main">
          <strong>${escapeHtml(q.client)}</strong>
          <span class="saved-meta">${q.folioLabel} · ${formatDate(q.date)}</span>
        </div>
        <div class="saved-amount">
          <div class="amt">${money(total)}</div>
          <span class="status-badge ${q.status}">${q.status === "pedido" ? "Pedido" : "Activa"}</span>
        </div>
      `;
      card.addEventListener("click", () => openViewer(q.id));
      savedListEl.appendChild(card);
    });
  }

  /* ---------------- Visor / modal de cotización guardada ---------------- */
  const viewerModal = document.getElementById("viewerModal");
  const viewerTicket = document.getElementById("viewerTicket");
  const viewerTitle = document.getElementById("viewerTitle");
  let viewerQuoteId = null;

  function openViewer(id) {
    const q = quotes.find((x) => x.id === id);
    if (!q) return;
    viewerQuoteId = id;
    viewerTitle.textContent = `${q.folioLabel} · ${q.client}`;
    viewerTicket.innerHTML = ticketHTML(q);
    document.getElementById("markStatusBtn").textContent =
      q.status === "pedido" ? "Regresar a activa" : "Marcar como pedido";
    viewerModal.hidden = false;
  }
  document.getElementById("closeViewer").addEventListener("click", () => (viewerModal.hidden = true));
  viewerModal.addEventListener("click", (e) => { if (e.target === viewerModal) viewerModal.hidden = true; });

  document.getElementById("deleteQuoteBtn").addEventListener("click", () => {
    if (!viewerQuoteId) return;
    if (!confirm("¿Eliminar esta cotización? Esta acción no se puede deshacer.")) return;
    quotes = quotes.filter((q) => q.id !== viewerQuoteId);
    saveQuotes(quotes);
    renderSavedList();
    viewerModal.hidden = true;
    toast("Cotización eliminada");
  });

  document.getElementById("markStatusBtn").addEventListener("click", () => {
    const q = quotes.find((x) => x.id === viewerQuoteId);
    if (!q) return;
    q.status = q.status === "pedido" ? "activa" : "pedido";
    saveQuotes(quotes);
    renderSavedList();
    openViewer(viewerQuoteId);
    toast(q.status === "pedido" ? "Marcada como pedido" : "Regresó a activa");
  });

  document.getElementById("viewerPdfBtn").addEventListener("click", () => {
    const q = quotes.find((x) => x.id === viewerQuoteId);
    if (!q) return;
    generatePDF(viewerTicket, `${q.folioLabel}_${q.client}`);
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
    renderSavedList();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("service-worker.js").catch(() => {});
      });
    }
  }
  init();
})();
