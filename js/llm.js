/* Modelo local (Ollama), opcional e só no PC. Saída JSON estruturada, validada antes de usar.

   Para o browser poder falar com o Ollama, este tem de aceitar a origem da app:
     OLLAMA_ORIGINS=https://<utilizador>.github.io  (ver README).
   No telemóvel, ou sem Ollama, a app usa o modo por regras. */

export class LLMIndisponivel extends Error {}

export async function estado(cfg) {
  if (!cfg.ollama.ativo) return [false, "Modelo local desativado (modo por regras)."];
  try {
    const r = await fetch(cfg.ollama.host.replace(/\/$/, "") + "/api/tags");
    if (!r.ok) return [false, `Ollama respondeu ${r.status}.`];
    const modelos = ((await r.json()).models || []).map((m) => m.model || m.name);
    const alvo = cfg.ollama.modelo;
    if (!modelos.some((m) => m === alvo || m.split(":")[0] === alvo || m === alvo + ":latest")) {
      return [false, `O modelo '${alvo}' não está instalado. No PC: ollama pull ${alvo}`];
    }
    return [true, `Ollama ativo com o modelo ${alvo}.`];
  } catch (e) {
    return [false, `Ollama não responde em ${cfg.ollama.host} (só funciona no PC, com OLLAMA_ORIGINS configurado).`];
  }
}

/** Pede ao modelo uma resposta conforme o JSON schema e valida-a com `validar` (lança se inválida). */
export async function gerarJson(cfg, sistema, utilizador, schema, validar, tentativas = 2) {
  const mensagens = [{ role: "system", content: sistema }, { role: "user", content: utilizador }];
  let ultimo = null;
  for (let i = 0; i < Math.max(1, tentativas); i++) {
    let r;
    try {
      r = await fetch(cfg.ollama.host.replace(/\/$/, "") + "/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: cfg.ollama.modelo, messages: mensagens, format: schema, stream: false, think: false,
          options: { temperature: cfg.ollama.temperatura ?? 0 } }),
      });
    } catch (e) { throw new LLMIndisponivel("Falha ao contactar o Ollama: " + e.message); }
    if (!r.ok) throw new LLMIndisponivel(`Ollama respondeu ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const conteudo = ((await r.json()).message || {}).content || "";
    try {
      return validar(JSON.parse(conteudo));
    } catch (e) {
      ultimo = e;
      mensagens.push({ role: "assistant", content: conteudo }, { role: "user", content: `O JSON não respeita o schema: ${e.message}. Responde só com JSON válido.` });
    }
  }
  throw new Error("O modelo devolveu JSON inválido: " + (ultimo && ultimo.message));
}

// ---------------------------------------------------------------- validação mínima de estruturas

export const exigir = (cond, msg) => { if (!cond) throw new Error(msg); };
export const listaDeTextos = (v, nome) => { exigir(Array.isArray(v) && v.every((x) => typeof x === "string"), `${nome} tem de ser uma lista de textos`); return v; };
