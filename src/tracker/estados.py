"""M5 — Estados das candidaturas, transições e follow-ups."""
from __future__ import annotations

from datetime import date, timedelta

from .. import db

POR_CANDIDATAR = "Por candidatar"
CANDIDATADO = "Candidatado"
ENTREVISTA = "Entrevista"
REJEITADO = "Rejeitado"
OFERTA = "Oferta"
DESCARTADA = "Descartada"

ESTADOS = [POR_CANDIDATAR, CANDIDATADO, ENTREVISTA, REJEITADO, OFERTA, DESCARTADA]

TRANSICOES = {
    POR_CANDIDATAR: {CANDIDATADO, DESCARTADA},
    CANDIDATADO: {ENTREVISTA, REJEITADO, OFERTA, DESCARTADA},
    ENTREVISTA: {REJEITADO, OFERTA, DESCARTADA},
    REJEITADO: set(),
    OFERTA: set(),
    DESCARTADA: {POR_CANDIDATAR},
}


class TransicaoInvalida(ValueError):
    pass


def transicoes_possiveis(estado: str) -> list[str]:
    return [e for e in ESTADOS if e in TRANSICOES.get(estado, set())]


def mudar_estado(conn, cfg: dict, vaga_id: int, novo: str, data: date | None = None,
                 cv_id: int | None = None, forcar: bool = False) -> None:
    """Muda o estado. 'forcar' permite corrigir enganos (ex.: voltar atrás)."""
    if novo not in ESTADOS:
        raise TransicaoInvalida(f"Estado desconhecido: {novo}")
    cand = db.obter_candidatura(conn, vaga_id)
    atual = cand["estado"]
    if novo == atual:
        return
    if not forcar and novo not in TRANSICOES[atual]:
        raise TransicaoInvalida(f"Transição não permitida: {atual} → {novo}")
    data = data or date.today()
    campos: dict = {"estado": novo}
    if cv_id is not None:
        _verificar_cv(conn, vaga_id, cv_id)
        campos["cv_id"] = cv_id
    if novo == CANDIDATADO:
        campos["data_candidatura"] = data.isoformat()
        dias = int(cfg["tracker"].get("dias_followup", 10))
        campos["data_followup"] = (data + timedelta(days=dias)).isoformat()
    if novo == ENTREVISTA and not cand.get("data_entrevista"):
        campos["data_entrevista"] = data.isoformat()
    if novo in (REJEITADO, OFERTA, DESCARTADA):
        campos["data_followup"] = None
    db.atualizar_candidatura(conn, vaga_id, **campos)


def _verificar_cv(conn, vaga_id: int, cv_id: int) -> None:
    cv = db.obter_cv(conn, cv_id)
    if not cv or cv["estado"] != "aprovado" or cv["vaga_id"] != vaga_id or cv["tipo"] != "cv":
        raise TransicaoInvalida("Só um CV aprovado desta vaga pode ser marcado como usado.")


def definir_cv(conn, vaga_id: int, cv_id: int) -> None:
    _verificar_cv(conn, vaga_id, cv_id)
    db.atualizar_candidatura(conn, vaga_id, cv_id=cv_id)


def atualizar_detalhes(conn, vaga_id: int, contacto: str | None = None, notas: str | None = None,
                       data_followup: date | None | str = "manter") -> None:
    campos = {}
    if contacto is not None:
        campos["contacto"] = contacto
    if notas is not None:
        campos["notas"] = notas
    if data_followup != "manter":
        campos["data_followup"] = data_followup.isoformat() if isinstance(data_followup, date) else data_followup
    db.atualizar_candidatura(conn, vaga_id, **campos)


def followups_em_atraso(conn, hoje: date | None = None) -> list[dict]:
    hoje = (hoje or date.today()).isoformat()
    return [c for c in db.listar_candidaturas(conn)
            if c["estado"] in (CANDIDATADO, ENTREVISTA) and c["data_followup"] and c["data_followup"] < hoje]
