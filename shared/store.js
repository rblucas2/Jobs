/* =====================================================================
   store.js — estado local-first (copiado do Vida OS)
   - Namespaces: "jobs" (dados da app) e "sys" (tema, sincronização, Google)
   - Persiste em localStorage (mesma origem => apps veem-se umas às outras)
   - Pub/Sub para reagir a mudanças
   - Liga-se ao sync.js (opcional, gratuito) quando configurado
   ===================================================================== */
(function (global) {
  const PREFIX = "jobs:";
  const listeners = {};       // ns -> Set(fn)
  const cache = {};           // ns -> objeto

  function key(ns) { return PREFIX + ns; }

  function load(ns) {
    if (cache[ns]) return cache[ns];
    let data = {};
    try {
      const raw = localStorage.getItem(key(ns));
      if (raw) data = JSON.parse(raw);
    } catch (e) { console.warn("store load falhou", ns, e); }
    cache[ns] = data;
    return data;
  }

  function save(ns, { silent = false, fromSync = false } = {}) {
    const data = cache[ns] || {};
    data._updatedAt = data._updatedAt || Date.now();
    try { localStorage.setItem(key(ns), JSON.stringify(data)); }
    catch (e) { console.error("store save falhou (cheio?)", e); UI && UI.toast("Erro ao guardar (armazenamento cheio?)"); }
    if (!silent) emit(ns);
    if (!fromSync && global.Sync) global.Sync.push(ns, data);
  }

  function emit(ns) {
    (listeners[ns] || []).forEach((fn) => { try { fn(cache[ns]); } catch (e) { console.error(e); } });
    (listeners["*"] || []).forEach((fn) => { try { fn(ns, cache[ns]); } catch (e) { console.error(e); } });
  }

  // ---- Tombstones (evita que a sincronização "ressuscite" itens apagados) ----
  // Para cada array de nível 1 cujos itens tenham "id" (habits, transactions, foods, …),
  // regista em data._tomb[key][id] quando um id desaparece do array. O sync.js usa isto
  // para não voltar a inserir esse item ao fazer merge com um dispositivo desatualizado.
  function snapshotIds(data) {
    const out = {};
    for (const k in data) {
      const v = data[k];
      if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && "id" in x)) {
        out[k] = new Set(v.map((x) => String(x.id)));
      }
    }
    return out;
  }

  function trackTombstones(data, before) {
    for (const k in before) {
      const v = data[k];
      const afterIds = new Set(Array.isArray(v) ? v.map((x) => x && String(x.id)) : []);
      const removed = [...before[k]].filter((id) => !afterIds.has(id));
      if (removed.length) {
        data._tomb = data._tomb || {};
        data._tomb[k] = data._tomb[k] || {};
        removed.forEach((id) => { data._tomb[k][id] = Date.now(); });
      }
      if (data._tomb && data._tomb[k]) {
        // item reapareceu (ex: undo) -> deixa de estar apagado
        afterIds.forEach((id) => { if (data._tomb[k][id]) delete data._tomb[k][id]; });
      }
    }
  }

  const Store = {
    /** Lê o objeto de estado de um namespace (referência viva). */
    get(ns) { return load(ns); },

    /** Lê um namespace das apps Vida OS (mesma origem no GitHub Pages), só para leitura. */
    peekVidaOS(ns) {
      try { return JSON.parse(localStorage.getItem("vidaos:" + ns) || "{}"); } catch (e) { return {}; }
    },

    /** Atualiza via função mutadora: Store.update('fin', s => { s.x = 1 }) */
    update(ns, mutator, opts) {
      const data = load(ns);
      const before = snapshotIds(data);
      mutator(data);
      trackTombstones(data, before);
      data._updatedAt = Date.now();
      save(ns, opts);
      return data;
    },

    /** Substitui o estado inteiro (usado pelo sync ao receber da cloud). */
    replace(ns, data, opts = {}) {
      cache[ns] = data || {};
      save(ns, { ...opts });
    },

    /** Garante valores por defeito sem apagar o existente. */
    ensure(ns, defaults) {
      const data = load(ns);
      let changed = false;
      for (const k in defaults) if (!(k in data)) { data[k] = defaults[k]; changed = true; }
      if (changed) save(ns, { silent: true });
      return data;
    },

    subscribe(ns, fn) {
      (listeners[ns] = listeners[ns] || new Set()).add(fn);
      return () => listeners[ns].delete(fn);
    },

    emit,

    /** Exportar tudo (backup manual). */
    exportAll() {
      const out = {};
      ["jobs"].forEach((ns) => { out[ns] = load(ns); });
      out._exportedAt = new Date().toISOString();
      return out;
    },

    importAll(obj) {
      ["jobs"].forEach((ns) => { if (obj[ns]) { cache[ns] = obj[ns]; save(ns); } });
    },
  };

  global.Store = Store;
})(window);
