/* Service worker — cachea el app shell para que funcione sin conexión.
   Estrategia: RED PRIMERO para los archivos propios (index.html, css, js),
   así siempre se sirve la versión más nueva cuando hay internet, y solo se
   usa la copia guardada como respaldo si no hay señal. Esto evita que se
   mezclen versiones viejas y nuevas de los archivos entre sí.
   Los datos (cotizaciones, pedidos, lotes) viven en Firestore, sincronizados
   entre dispositivos; Firestore trae su propia caché offline aparte. */
 
const CACHE_NAME = "gdl-cotizador-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/app.js",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];
 
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});
 
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});
 
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
 
  const url = new URL(req.url);
 
  // Recursos externos (CDN de html2canvas / jsPDF, Google Fonts): red primero,
  // con la caché solo como respaldo si no hay conexión.
  if (url.origin !== self.location.origin) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
 
  // App shell propio (index.html, css, js, manifest, iconos): también red
  // primero. Así nunca se queda pegado sirviendo una mezcla de versiones
  // viejas y nuevas cuando actualizamos la app.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
