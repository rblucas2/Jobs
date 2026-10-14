/* Service worker — app shell offline (mesma estratégia das apps Vida OS: network-first). */
const VERSION = "jobs-v2";
const CORE = [
  "./", "./index.html", "./manifest.webmanifest", "./icons/jobs.svg", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./shared/ui.js", "./shared/store.js", "./shared/sync.js", "./css/app.css",
  "./js/app.js", "./js/config.js", "./js/texto.js", "./js/perfil.js", "./js/parsers.js", "./js/dados.js", "./js/recolha.js",
  "./js/gmail.js", "./js/llm.js", "./js/compat.js", "./js/validador.js", "./js/cv.js", "./js/tracker.js",
  "./js/ecras/comum.js", "./js/ecras/inicio.js", "./js/ecras/vagas.js", "./js/ecras/vaga.js", "./js/ecras/cv.js", "./js/ecras/pipeline.js",
  "./js/ecras/perfil.js", "./js/ecras/definicoes.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Gmail, Supabase, CDNs: sem interferência
  e.respondWith(
    fetch(req, { cache: "no-store" }).then((r) => {
      if (r && r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req, cp)); }
      return r;
    }).catch(() => caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
