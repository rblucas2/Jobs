/* =====================================================================
   sync.js — sincronização gratuita e opcional via Supabase (REST)
   Modelo simples "blob por app" (merge sem perdas):
     tabela app_state(app text, sync_code text, data jsonb,
                      updated_at timestamptz, primary key(app, sync_code))
   - Sem cartão de crédito. Free tier do Supabase chega de sobra.
   - O utilizador cola, nas Definições, o URL + chave anónima + um código.
   - O mesmo "código de sincronização" liga telemóvel e PC.
   ===================================================================== */
(function (global) {
  const CFG_NS = "sys";
  let cfg = null;           // { url, key, code }
  let status = "off";       // off | ready | syncing | error
  const pushTimers = {};
  const pendingData = {};   // ns -> dados por enviar (evita perder alterações se a app fechar antes do debounce)
  const statusCbs = new Set();

  function setStatus(s, detail) { status = s; statusCbs.forEach((f) => f(s, detail)); }

  function loadCfg() {
    const sys = Store.get(CFG_NS);
    // Sem configuração própria, usa a das apps Vida OS (mesma origem, mesmo Supabase).
    const c = (sys.sync && sys.sync.url) ? sys.sync : (Store.peekVidaOS("sys").sync || {});
    cfg = (c.url && c.key && c.code) ? { url: c.url.replace(/\/$/, ""), key: c.key, code: c.code } : null;
    setStatus(cfg ? "ready" : "off");
    return cfg;
  }

  // Só envia "Authorization: Bearer" quando a chave é um JWT (anon legacy "eyJ…").
  // Para as novas chaves publishable ("sb_…") basta o apikey.
  function authFor(key) { const h = { apikey: key }; if (key && key.indexOf("eyJ") === 0) h.Authorization = "Bearer " + key; return h; }
  function headers() {
    return Object.assign({ "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }, authFor(cfg.key));
  }

  const apps = ["jobs"];

  function push(ns, data) {
    if (!cfg || !apps.includes(ns)) return;
    pendingData[ns] = data;
    clearTimeout(pushTimers[ns]);
    pushTimers[ns] = setTimeout(() => flushPush(ns), 1200);
  }

  /** Envia imediatamente o que estiver pendente (usado pelo debounce e ao sair/minimizar a app). */
  async function flushPush(ns) {
    clearTimeout(pushTimers[ns]);
    const data = pendingData[ns];
    if (!data || !cfg) return;
    delete pendingData[ns];
    try {
      setStatus("syncing");
      const body = [{ app: ns, sync_code: cfg.code, data, updated_at: new Date(data._updatedAt || Date.now()).toISOString() }];
      // on_conflict explícito: garante que o Supabase ATUALIZA a linha existente
      // (app, sync_code) em vez de poder falhar silenciosamente num "upsert" ambíguo.
      const r = await fetch(`${cfg.url}/rest/v1/app_state?on_conflict=app,sync_code`, {
        method: "POST", headers: headers(), body: JSON.stringify(body), keepalive: true,
      });
      if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()));
      setStatus("ready");
    } catch (e) { console.warn("sync push", e); setStatus("error", e.message); }
  }
  function flushAllPending() { Object.keys(pendingData).forEach((ns) => flushPush(ns)); }

  // Quais os campos que são listas identificadas por "id", listas identificadas por "name",
  // e objetos-por-chave (data/dia) — usados para fazer merge sem perdas entre dispositivos.
  const ID_ARRAYS = { jobs: ["vagas", "analises", "cvs", "naoReconhecidos", "perfis"] };
  const NAME_ARRAYS = {};
  const KEYED_OBJ = {};

  // Une os "_tomb" (ids apagados) de dois estados, mantendo o carimbo mais recente por id.
  function mergeTomb(a, b) {
    const out = {};
    [a && a._tomb, b && b._tomb].forEach((tomb) => {
      for (const key in tomb || {}) {
        out[key] = out[key] || {};
        for (const id in tomb[key]) out[key][id] = Math.max(out[key][id] || 0, tomb[key][id]);
      }
    });
    return out;
  }

  function mergeArrayBy(out, older, key, keyOf, tomb) {
    let arr = Array.isArray(out[key]) ? out[key] : [];
    const pos = new Map(arr.map((x, i) => [x && keyOf(x), i]));
    (older[key] || []).forEach((x) => {
      const id = x && keyOf(x);
      if (id == null) return;
      if (!pos.has(id)) { arr.push(x); pos.set(id, arr.length - 1); return; }
      // O mesmo item alterado nos dois dispositivos: fica a versão alterada mais recentemente (_u).
      const i = pos.get(id);
      if ((x._u || 0) > ((arr[i] && arr[i]._u) || 0)) arr[i] = x;
    });
    const dead = tomb && tomb[key];
    if (dead) arr = arr.filter((x) => !(x && dead[String(keyOf(x))] != null));
    out[key] = arr;
  }

  // Hábitos e pilares do "los" também se fundem por NOME depois do merge por id: se os
  // dois dispositivos criarem um hábito/pilar com o mesmo nome antes de terem sincronizado
  // um com o outro, cada um tem um id diferente e o merge por id (acima) deixa os dois
  // sobreviverem — parecem duplicados na app. Junta-os aqui (mesmo mecanismo do
  // dedupeHabitsPillars em lifeos.js, que também limpa duplicados que já existam localmente).
  function dedupeLosByName(out) {
    out.habitLog = out.habitLog || {};
    const byHabitName = new Map(); const habitsOut = [];
    (out.habits || []).forEach((h) => {
      const key = (h.name || "").trim().toLowerCase();
      if (key && byHabitName.has(key)) {
        const kept = byHabitName.get(key);
        const dupLog = out.habitLog[h.id];
        if (dupLog) { out.habitLog[kept.id] = out.habitLog[kept.id] || {}; Object.assign(out.habitLog[kept.id], dupLog); delete out.habitLog[h.id]; }
      } else { if (key) byHabitName.set(key, h); habitsOut.push(h); }
    });
    out.habits = habitsOut;

    const byPillarName = new Map(); const pillarsOut = [];
    (out.pillars || []).forEach((p) => {
      const key = (p.name || "").trim().toLowerCase();
      if (key && byPillarName.has(key)) {
        const kept = byPillarName.get(key); kept.goals = kept.goals || [];
        const ids = new Set(kept.goals.map((g) => g.id));
        (p.goals || []).forEach((g) => { if (!ids.has(g.id)) kept.goals.push(g); });
      } else { if (key) byPillarName.set(key, p); pillarsOut.push(p); }
    });
    out.pillars = pillarsOut;
  }

  /** Merge sem perdas: base = estado mais recente; acrescenta itens/chaves que só existem no outro
   *  (exceto itens marcados como apagados em "_tomb", para não os "ressuscitar"). */
  function mergeStates(ns, local, remote) {
    const remoteNewer = (remote._updatedAt || 0) >= (local._updatedAt || 0);
    const newer = remoteNewer ? remote : local, older = remoteNewer ? local : remote;
    const out = JSON.parse(JSON.stringify(newer));
    const tomb = mergeTomb(newer, older);
    (ID_ARRAYS[ns] || []).forEach((key) => mergeArrayBy(out, older, key, (x) => x.id, tomb));
    (NAME_ARRAYS[ns] || []).forEach((key) => mergeArrayBy(out, older, key, (x) => x.name, tomb));
    (KEYED_OBJ[ns] || []).forEach((key) => {
      const obj = out[key] && typeof out[key] === "object" ? out[key] : {}; const old = older[key] || {};
      for (const k in old) if (!(k in obj)) obj[k] = old[k];
      out[key] = obj;
    });
    if (ns === "los") dedupeLosByName(out);
    if (Object.keys(tomb).length) out._tomb = tomb;
    out._updatedAt = Math.max(local._updatedAt || 0, remote._updatedAt || 0);
    return out;
  }
  const stripVol = (o) => { const c = { ...o }; delete c._updatedAt; return JSON.stringify(c); };

  async function pullOne(ns) {
    const url = `${cfg.url}/rest/v1/app_state?app=eq.${ns}&sync_code=eq.${encodeURIComponent(cfg.code)}&select=data,updated_at`;
    const r = await fetch(url, { headers: headers() });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const rows = await r.json();
    const local = Store.get(ns);
    if (!rows.length) { if (Object.keys(local).length) push(ns, local); return false; }
    const remote = rows[0].data || {};
    const merged = mergeStates(ns, local, remote);
    const changedLocal = JSON.stringify(merged) !== JSON.stringify(local);
    if (changedLocal) Store.replace(ns, merged, { fromSync: true });   // atualiza local + re-render
    if (stripVol(merged) !== stripVol(remote)) push(ns, merged);       // devolve à cloud as adições do outro lado
    return changedLocal;
  }

  async function pullAll() {
    if (!cfg) return;
    try {
      setStatus("syncing");
      let changed = 0;
      for (const ns of apps) { if (await pullOne(ns)) changed++; }
      setStatus("ready");
      return changed;
    } catch (e) { console.warn("sync pull", e); setStatus("error", e.message); }
  }

  async function test(c) {
    const u = c.url.replace(/\/$/, "");
    const r = await fetch(`${u}/rest/v1/app_state?select=app&limit=1`, { headers: authFor(c.key) });
    if (!r.ok) throw new Error("HTTP " + r.status + " — verifica URL/chave e se a tabela 'app_state' existe.");
    return true;
  }

  const Sync = {
    init() {
      loadCfg();
      if (cfg) { pullAll(); setInterval(pullAll, 60000); }
      // Re-sincroniza ao voltar à app; envia já o que estiver pendente ao sair/minimizar
      // (evita perder alterações feitas mesmo antes de fechar a app no telemóvel).
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) flushAllPending();
        else if (cfg) pullAll();
      });
      window.addEventListener("pagehide", flushAllPending);
      window.addEventListener("online", () => { if (cfg) pullAll(); });
    },
    push,
    flushAllPending,
    pullAll,
    test,
    reload() { loadCfg(); if (cfg) pullAll(); },
    onStatus(cb) { statusCbs.add(cb); cb(status); return () => statusCbs.delete(cb); },
    get status() { return status; },
    get enabled() { return !!cfg; },
    sqlSchema:
`-- Cola isto no SQL Editor do teu projeto Supabase (gratuito) e clica RUN:
create table if not exists app_state (
  app text not null,
  sync_code text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (app, sync_code)
);
alter table app_state enable row level security;
create policy "acesso por codigo" on app_state
  for all using (true) with check (true);`,
  };

  global.Sync = Sync;
})(window);
