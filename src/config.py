"""Leitura e gravação do config.yaml, com valores por defeito."""
from __future__ import annotations

import copy
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.yaml"

FONTES = ["LinkedIn", "Indeed", "Net-Empregos", "Jobs.lu", "Big4", "Outras"]

DIMENSOES = [
    "requisitos_obrigatorios",
    "experiencia",
    "competencias_tecnicas",
    "linguas",
    "localizacao_condicoes",
    "alinhamento_areas",
]

NOMES_DIMENSOES = {
    "requisitos_obrigatorios": "Requisitos obrigatórios",
    "experiencia": "Experiência (anos e tipo)",
    "competencias_tecnicas": "Competências técnicas",
    "linguas": "Línguas",
    "localizacao_condicoes": "Localização e condições",
    "alinhamento_areas": "Alinhamento com as áreas-alvo",
}

DEFAULTS: dict = {
    "areas_alvo": [],
    "localizacoes_alvo": [],
    "aceita_remoto": True,
    "perfil": {"pasta": "data/perfil", "versao_validada": None},
    "gmail": {
        "credenciais": "credentials.json",
        "token": "token.json",
        "etiqueta_raiz": "Vagas",
        "etiqueta_processado": "Vagas/Processado",
        "remetentes": {f: [] for f in FONTES},
        "max_emails_por_recolha": 200,
    },
    "parsers": {"padroes_link_extra": {f: [] for f in FONTES}},
    "compatibilidade": {
        "pesos": {
            "requisitos_obrigatorios": 35,
            "experiencia": 20,
            "competencias_tecnicas": 20,
            "linguas": 10,
            "localizacao_condicoes": 10,
            "alinhamento_areas": 5,
        },
        "limite_eliminatoria": 49,
        "preliminar_com_llm": False,
    },
    "ollama": {
        "ativo": True,
        "host": "http://localhost:11434",
        "modelo": "qwen3:8b",
        "temperatura": 0,
        "timeout_s": 300,
    },
    "cv": {
        "modelo_docx": "templates/cv_modelo.docx",
        "modelo_aprovado": False,
        "pasta_saida": "data/cvs",
        "idioma": "pt",
        "max_pontos_por_experiencia": 5,
        "soffice": None,
    },
    "carta": {"abertura": "Exmos. Senhores,", "fecho": "Com os melhores cumprimentos,"},
    "tracker": {"dias_followup": 10},
    "exportacao": {"pasta": "data/exports", "separador_csv": ";"},
    "base_dados": "data/procura_emprego.db",
    "logs": {"nao_reconhecidos": "logs/emails_nao_reconhecidos.log"},
    "vocabulario": {"ferramentas": [], "certificacoes": []},
}

CABECALHO = (
    "# Configuração da Ferramenta de Procura de Emprego.\n"
    "# Gravado pela página Definições. Pode também ser editado à mão.\n"
    "# Sinónimos separados por \"|\" (ex.: \"Lisboa|Lisbon\").\n\n"
)


def _fundir(base: dict, extra: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (extra or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _fundir(out[k], v)
        else:
            out[k] = v
    return out


def carregar_config(caminho: Path | str | None = None) -> dict:
    caminho = Path(caminho) if caminho else CONFIG_PATH
    dados = {}
    if caminho.exists():
        dados = yaml.safe_load(caminho.read_text(encoding="utf-8")) or {}
    cfg = _fundir(DEFAULTS, dados)
    cfg["_caminho"] = str(caminho)
    cfg.setdefault("_root", str(caminho.parent))
    return cfg


def guardar_config(cfg: dict, caminho: Path | str | None = None) -> None:
    caminho = Path(caminho or cfg.get("_caminho") or CONFIG_PATH)
    limpo = {k: v for k, v in cfg.items() if not k.startswith("_")}
    texto = yaml.safe_dump(limpo, allow_unicode=True, sort_keys=False, default_flow_style=False)
    caminho.write_text(CABECALHO + texto, encoding="utf-8")


def resolver(cfg: dict, relativo: str | Path) -> Path:
    """Resolve um caminho do config relativamente à pasta do projeto."""
    p = Path(relativo)
    if p.is_absolute():
        return p
    return Path(cfg.get("_root") or ROOT) / p


def pesos_normalizados(cfg: dict) -> dict[str, float]:
    pesos = {d: float(cfg["compatibilidade"]["pesos"].get(d, 0) or 0) for d in DIMENSOES}
    total = sum(pesos.values())
    if total <= 0:
        raise ValueError("A soma dos pesos da grelha tem de ser positiva.")
    return {d: p / total for d, p in pesos.items()}
