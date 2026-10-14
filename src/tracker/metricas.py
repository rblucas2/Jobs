"""Métricas da procura e exportação CSV (para o Power BI)."""
from __future__ import annotations

import csv
import io
from collections import Counter, defaultdict
from datetime import date

from .. import db
from ..texto import contem_termo, sinonimos
from .estados import CANDIDATADO, ENTREVISTA, ESTADOS, OFERTA, REJEITADO, followups_em_atraso


def tipo_vaga(cargo: str, cfg: dict) -> str:
    for area in cfg.get("areas_alvo", []):
        s = sinonimos(area)
        if any(contem_termo(cargo, t) for t in s):
            return s[0]
    return "Outra"


def metricas(conn, cfg: dict, hoje: date | None = None) -> dict:
    cands = db.listar_candidaturas(conn)
    por_estado = Counter(c["estado"] for c in cands)
    candidatadas = [c for c in cands if c["data_candidatura"]]
    respondidas = [c for c in candidatadas
                   if c["estado"] in (ENTREVISTA, REJEITADO, OFERTA) or c["data_entrevista"]]
    entrevistas_fonte: dict[str, int] = defaultdict(int)
    entrevistas_tipo: dict[str, int] = defaultdict(int)
    candidaturas_fonte: dict[str, int] = defaultdict(int)
    for c in candidatadas:
        candidaturas_fonte[c["fonte"]] += 1
    for c in cands:
        if c["data_entrevista"]:
            entrevistas_fonte[c["fonte"]] += 1
            entrevistas_tipo[tipo_vaga(c["cargo"], cfg)] += 1
    return {
        "por_estado": {e: por_estado.get(e, 0) for e in ESTADOS},
        "total_vagas": len(cands),
        "candidaturas": len(candidatadas),
        "respondidas": len(respondidas),
        "taxa_resposta": (len(respondidas) / len(candidatadas)) if candidatadas else None,
        "entrevistas": sum(1 for c in cands if c["data_entrevista"]),
        "entrevistas_por_fonte": dict(entrevistas_fonte),
        "entrevistas_por_tipo": dict(entrevistas_tipo),
        "candidaturas_por_fonte": dict(candidaturas_fonte),
        "followups_em_atraso": len(followups_em_atraso(conn, hoje)),
        "aguardam_resposta": por_estado.get(CANDIDATADO, 0),
    }


COLUNAS = [
    "vaga_id", "cargo", "empresa", "localizacao", "fonte", "tipo_vaga", "link_canonico", "data_publicacao",
    "data_recolha", "pontuacao_global", "preliminar", "estado", "cv_id", "data_candidatura", "data_entrevista",
    "data_followup", "contacto", "notas",
]


def exportar_csv(conn, cfg: dict) -> bytes:
    """CSV em UTF-8 com BOM (abre corretamente no Excel e no Power BI)."""
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=COLUNAS, delimiter=cfg["exportacao"].get("separador_csv", ";"),
                       extrasaction="ignore")
    w.writeheader()
    for c in db.listar_candidaturas(conn):
        linha = dict(c)
        linha["tipo_vaga"] = tipo_vaga(c["cargo"], cfg)
        linha["preliminar"] = "" if c["preliminar"] is None else ("sim" if c["preliminar"] else "não")
        w.writerow(linha)
    return buf.getvalue().encode("utf-8-sig")
