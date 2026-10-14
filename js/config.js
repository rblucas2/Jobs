/* Configuração (equivalente ao config.yaml da especificação), guardada no estado da app
   e sincronizada entre dispositivos. Os valores por defeito são fundidos com os gravados. */

export const FONTES = ["LinkedIn", "Indeed", "Net-Empregos", "Jobs.lu", "Big4", "Outras"];

export const DIMENSOES = [
  "requisitos_obrigatorios", "experiencia", "competencias_tecnicas",
  "linguas", "localizacao_condicoes", "alinhamento_areas",
];

export const NOMES_DIMENSOES = {
  requisitos_obrigatorios: "Requisitos obrigatórios",
  experiencia: "Experiência (anos e tipo)",
  competencias_tecnicas: "Competências técnicas",
  linguas: "Línguas",
  localizacao_condicoes: "Localização e condições",
  alinhamento_areas: "Alinhamento com as áreas-alvo",
};

export const DEFAULTS = {
  // Exemplos da especificação — CONFIRMAR.
  areas_alvo: ["Transaction Services", "Valuation|Avaliação|Avaliação de empresas", "M&A|Fusões e Aquisições|Mergers and Acquisitions"],
  localizacoes_alvo: ["Lisboa|Lisbon", "Porto|Oporto", "Luxemburgo|Luxembourg"],
  aceita_remoto: true,
  perfil_validado: null,
  gmail: {
    etiqueta_raiz: "Vagas",
    etiqueta_processado: "Vagas/Processado",
    // Vazios de propósito: confirmar a partir dos primeiros alertas (botão "Descobrir remetentes").
    remetentes: Object.fromEntries(FONTES.map((f) => [f, []])),
    max_emails_por_recolha: 100,
  },
  parsers: { padroes_link_extra: Object.fromEntries(FONTES.map((f) => [f, []])) },
  compatibilidade: {
    pesos: {
      requisitos_obrigatorios: 35, experiencia: 20, competencias_tecnicas: 20,
      linguas: 10, localizacao_condicoes: 10, alinhamento_areas: 5,
    },
    limite_eliminatoria: 49,
    preliminar_com_llm: false,
  },
  ollama: { ativo: false, host: "http://localhost:11434", modelo: "qwen3:8b", temperatura: 0 },
  cv: { idioma: "pt", max_pontos_por_experiencia: 5, modelo_aprovado: false },
  carta: { abertura: "Exmos. Senhores,", fecho: "Com os melhores cumprimentos," },
  tracker: { dias_followup: 10 },
  exportacao: { separador_csv: ";" },
  vocabulario: {
    ferramentas: [
      "Excel", "VBA", "Power BI", "Power Query", "Power Pivot", "Tableau", "Qlik", "Looker", "SQL", "Python",
      "R", "Stata", "SPSS", "MATLAB", "Alteryx", "SAP", "Primavera", "PHC", "Oracle", "Navision|Dynamics NAV",
      "Bloomberg", "Capital IQ", "Refinitiv|Eikon", "FactSet", "Orbis", "Mergermarket", "PitchBook", "PowerPoint",
      "Microsoft Access|MS Access", "Google Sheets", "IFRS", "SNC", "US GAAP", "DCF", "LBO",
      "Modelação financeira|Financial modelling|Financial modeling", "Due diligence", "Consolidação|Consolidation", "FP&A",
    ],
    certificacoes: [
      "CFA", "ACCA", "CPA", "CMA", "FRM", "CAIA", "CIA", "CISA", "ROC|Revisor Oficial de Contas",
      "OCC|Contabilista Certificado", "PMP", "PRINCE2", "Six Sigma",
    ],
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function fundir(base, extra) {
  const out = clone(base);
  for (const k in extra || {}) {
    const v = extra[k];
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = fundir(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function configCompleta(gravada) {
  return fundir(DEFAULTS, gravada || {});
}

export function pesosNormalizados(cfg) {
  const pesos = Object.fromEntries(DIMENSOES.map((d) => [d, Number(cfg.compatibilidade.pesos[d] || 0)]));
  const total = Object.values(pesos).reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("A soma dos pesos da grelha tem de ser positiva.");
  return Object.fromEntries(DIMENSOES.map((d) => [d, pesos[d] / total]));
}
