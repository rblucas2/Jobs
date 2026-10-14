"""Ciclo de vida de um CV/carta: rascunho -> (edição) -> aprovado | rejeitado -> exportação.

Regras garantidas aqui (e não só na interface):
  * só o perfil-base validado pode ser usado;
  * qualquer edição é revalidada;
  * só se aprova com todos os pontos verificados e com confirmação explícita;
  * só se exporta (e liga ao tracker) depois de aprovado e com o modelo Word aprovado.
"""
from __future__ import annotations

from datetime import datetime

from .. import db
from ..config import resolver
from ..perfil import versoes
from ..perfil.modelo import Perfil
from . import exportacao, gerador, render
from .schemas import Carta, CVAdaptado
from .validador import problemas, validar_carta, validar_cv


class AprovacaoRecusada(RuntimeError):
    pass


def _modelo_doc(registo: dict) -> CVAdaptado | Carta:
    return (Carta if registo["tipo"] == "carta" else CVAdaptado).model_validate(registo["conteudo"])


def _perfil_do_registo(cfg: dict, registo: dict) -> Perfil:
    return versoes.carregar(cfg, registo["versao_perfil"])


def criar_rascunho(conn, cfg: dict, vaga_id: int, tipo: str = "cv", usar_llm: bool | None = None,
                   idioma: str | None = None) -> int:
    perfil = versoes.perfil_validado(cfg)  # levanta PerfilNaoValidado
    vaga = db.obter_vaga(conn, vaga_id)
    if tipo == "carta":
        doc = gerador.gerar_carta(perfil, vaga, cfg, usar_llm, idioma)
    else:
        doc = gerador.gerar_cv(perfil, vaga, cfg, usar_llm, idioma)
    return db.guardar_cv(conn, vaga_id, tipo, perfil.versao, doc.model_dump())


def revalidar(conn, cfg: dict, registo: dict) -> CVAdaptado | Carta:
    perfil = _perfil_do_registo(cfg, registo)
    doc = _modelo_doc(registo)
    if isinstance(doc, Carta):
        return validar_carta(doc, perfil, cfg, db.obter_vaga(conn, registo["vaga_id"]))
    return validar_cv(doc, perfil, cfg)


def editar(conn, cfg: dict, cv_id: int, conteudo: dict) -> CVAdaptado | Carta:
    registo = db.obter_cv(conn, cv_id)
    registo = {**registo, "conteudo": conteudo}
    doc = revalidar(conn, cfg, registo)
    db.atualizar_conteudo_cv(conn, cv_id, doc.model_dump())
    return doc


def aprovar(conn, cfg: dict, cv_id: int, confirmado: bool) -> None:
    if not confirmado:
        raise AprovacaoRecusada("A aprovação tem de ser confirmada explicitamente.")
    registo = db.obter_cv(conn, cv_id)
    if registo["estado"] != "rascunho":
        raise AprovacaoRecusada(f"Só rascunhos podem ser aprovados (estado atual: {registo['estado']}).")
    doc = revalidar(conn, cfg, registo)
    falhas = problemas(doc)
    if falhas:
        raise AprovacaoRecusada("Há pontos por resolver:\n- " + "\n- ".join(falhas))
    db.atualizar_conteudo_cv(conn, cv_id, doc.model_dump())
    db.definir_estado_cv(conn, cv_id, "aprovado")


def rejeitar(conn, cv_id: int) -> None:
    registo = db.obter_cv(conn, cv_id)
    if registo["estado"] != "rascunho":
        raise AprovacaoRecusada("Só rascunhos podem ser rejeitados.")
    db.definir_estado_cv(conn, cv_id, "rejeitado")


def blocos(conn, cfg: dict, registo: dict) -> list[tuple[str, str]]:
    perfil = _perfil_do_registo(cfg, registo)
    doc = _modelo_doc(registo)
    if isinstance(doc, Carta):
        return render.blocos_carta(doc, perfil, db.obter_vaga(conn, registo["vaga_id"]), cfg)
    return render.blocos_cv(doc, perfil)


def exportar(conn, cfg: dict, cv_id: int) -> tuple[str, str | None]:
    """Exporta Word e PDF de um documento aprovado. Devolve (docx, pdf ou None)."""
    registo = db.obter_cv(conn, cv_id)
    if registo["estado"] != "aprovado":
        raise AprovacaoRecusada("Só documentos aprovados podem ser exportados.")
    if not cfg["cv"].get("modelo_aprovado"):
        raise AprovacaoRecusada("O modelo Word ainda não foi aprovado (página Definições).")
    doc = revalidar(conn, cfg, registo)
    if problemas(doc):  # defesa adicional: o perfil de origem não pode ter mudado
        raise AprovacaoRecusada("O documento já não passa no validador; gere um novo rascunho.")
    pasta = resolver(cfg, cfg["cv"]["pasta_saida"]) / f"vaga_{registo['vaga_id']}"
    nome = f"{registo['tipo']}_{cv_id}_perfil_v{registo['versao_perfil']}_{datetime.now():%Y%m%d}"
    docx = exportacao.gerar_docx(blocos(conn, cfg, registo), exportacao.caminho_modelo(cfg), pasta / f"{nome}.docx")
    pdf = None
    try:
        pdf = exportacao.converter_pdf(docx, cfg)
    except Exception:  # o Word fica sempre disponível; o PDF é opcional
        pdf = None
    db.definir_caminhos_cv(conn, cv_id, str(docx), str(pdf) if pdf else None)
    if registo["tipo"] == "cv":
        db.atualizar_candidatura(conn, registo["vaga_id"], cv_id=cv_id)
    return str(docx), (str(pdf) if pdf else None)
