# Cotizador — DELIVERY GDL

App web (PWA) para generar cotizaciones profesionales en PDF a partir de fotos
de productos. Corre 100% en el navegador: no necesita servidor, base de datos
ni backend. Las cotizaciones se guardan en el propio celular (localStorage).

## Qué hace

- Formulario para armar una cotización: cliente, fecha, productos con foto,
  cantidad y precio unitario.
- Descuento opcional (porcentaje o monto fijo). Si no lo activas, no aparece
  nada de eso en el PDF.
- Vista previa en vivo estilo "ticket" con tus datos de negocio, miniaturas de
  cada prenda y el total.
- Botón para descargar la cotización como PDF, lista para mandar por WhatsApp.
- Pestaña "Activas" con todas las cotizaciones guardadas, para reabrirlas,
  volver a descargar el PDF, marcarlas como pedido o eliminarlas.
- Instalable en el celular como si fuera una app (ícono en la pantalla de
  inicio), gracias a que es una PWA (Progressive Web App).

## Publicarla en GitHub Pages (gratis)

1. Crea un repositorio nuevo en GitHub, por ejemplo `cotizador-gdl`.
2. Sube **todo el contenido de esta carpeta** (no la carpeta en sí, sino los
   archivos y subcarpetas que están dentro: `index.html`, `css/`, `js/`,
   `icons/`, `manifest.json`, `service-worker.js`).
   - Más fácil desde el navegador: en el repo, botón **Add file → Upload
     files**, arrastra todo y da **Commit changes**.
3. Ve a **Settings → Pages**.
4. En **Source**, elige **Deploy from a branch**, rama `main`, carpeta `/root`.
   Guarda.
5. En 1–2 minutos GitHub te da una URL parecida a:
   `https://tu-usuario.github.io/cotizador-gdl/`
6. Abre esa URL — la app ya está en línea.

> Importante: la app **debe** servirse por `https://` (GitHub Pages lo hace
> automáticamente) para que el ícono, la instalación y el modo sin conexión
> funcionen. Abrir el `index.html` directamente desde tu computadora (doble
> clic) no activa esas funciones.

## Agregarla como app al celular

**Android (Chrome):**
1. Abre la URL de GitHub Pages.
2. Toca el menú ⋮ → **Instalar app** (o **Agregar a pantalla de inicio**).
3. Aparece el ícono "DG" en tu pantalla de inicio, como cualquier app.

**iPhone (Safari):**
1. Abre la URL de GitHub Pages en Safari (tiene que ser Safari, no Chrome).
2. Toca el botón de compartir (el cuadrito con la flecha hacia arriba).
3. Elige **Agregar a pantalla de inicio**.
4. Aparece el ícono "DG" en tu pantalla de inicio.

## Dónde viven los datos

Las cotizaciones y la configuración del negocio (nombre, teléfono, folio,
etc.) se guardan **en el navegador de ese celular** (localStorage), no en un
servidor. Ventaja: es privado y gratis. Cosas a tener en cuenta:

- Si borras datos/caché del navegador o desinstalas la app, se pierden las
  cotizaciones guardadas.
- No se sincroniza entre dispositivos: lo que guardas en tu celular no
  aparece automáticamente en tu computadora.
- Para cambiar tus datos de negocio (nombre, teléfono, zona, mensaje de
  cierre, folio inicial), usa el ícono ⚙ de la barra superior.

Si más adelante quieres que las cotizaciones se sincronicen entre varios
dispositivos o se conviertan en pedidos con seguimiento, eso implica agregar
una base de datos — lo vemos en el siguiente paso.

## Estructura de archivos

```
index.html          página principal
css/styles.css       estilos (tema "ticket de papel")
js/app.js             lógica: formulario, cálculo de totales, guardado, PDF
manifest.json         configuración de instalación como app
service-worker.js     caché para que abra rápido / funcione sin conexión
icons/                íconos de la app (192, 512, apple-touch, favicon)
```

## Notas técnicas

- El PDF se genera en el propio navegador con `html2canvas` + `jsPDF`
  (cargados desde CDN), tomando exactamente lo que ves en la vista previa
  tipo ticket — no hay una plantilla separada que se pueda desalinear.
- Las fotos se comprimen automáticamente al subirlas (máx. ~480px, JPEG) para
  que las cotizaciones no pesen demasiado en el almacenamiento del celular.
- No requiere ninguna llave, cuenta ni servicio externo de pago.
