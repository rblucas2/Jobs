"""Motor de compatibilidade: obtém a análise (modelo local ou regras), sanea-a e calcula a
pontuação global com a grelha do config.yaml e a regra de corte.

A pontuação mede a adequação ao perfil pedido na vaga. Não é uma probabilidade de contratação.
"""
from __future__ import annotations

import json

from .. import llm
from ..config import DIMENSOES, pesos_normalizados
from ..perfil.modelo import Perfil, anos_experiencia, indexar
from . import regras
from .schemas import AnaliseLLM, ResultadoAnalise

AVISO = ("A pontuação mede a adequação do perfil aos requisitos da vaga. "
         "Não é uma probabilidade de contratação.")

SISTEMA = """És um analista de recrutamento rigoroso. Avalias a adequação de um perfil a uma vaga.
Regras:
- Usa APENAS a informação do perfil fornecido. Não presumas competências que não estejam escritas.
- Para cada requisito da vaga indica se é obrigatório, se é eliminatório (ex.: língua obrigatória,
  autorização legal, certificação exigida) e se o perfil o cumpre.
- Um requisito só está cumprido se indicares em evidencia_ids os IDs exatos dos itens do perfil que o comprovam.
- As subpontuações (0-100) avaliam cada dimensão; usa null quando a vaga não dá informação sobre a dimensão.
- O resumo tem 2-3 frases factuais. Nunca fales em probabilidade de ser contratado."""


def _perfil_para_prompt(perfil: Perfil) -> str:
    linhas = [f"Anos de experiência (calculados): {anos_experiencia(perfil)}"]
    for i in indexar(perfil).values():
        linhas.append(f"[{i.id}] ({i.tipo}) {i.texto}")
    return "\n".join(linhas)


def analise_llm(cfg: dict, perfil: Perfil, vaga: dict) -> AnaliseLLM:
    utilizador = (
        f"PERFIL (cada linha tem o ID do item):\n{_perfil_para_prompt(perfil)}\n\n"
        f"ÁREAS-ALVO: {', '.join(cfg.get('areas_alvo', []))}\n"
        f"LOCALIZAÇÕES-ALVO: {', '.join(cfg.get('localizacoes_alvo', []))} "
        f"(aceita remoto: {cfg.get('aceita_remoto', True)})\n\n"
        f"VAGA:\nCargo: {vaga.get('cargo')}\nEmpresa: {vaga.get('empresa')}\n"
        f"Localização: {vaga.get('localizacao')}\nDescrição:\n{vaga.get('descricao', '')}"
    )
    return llm.gerar_json(cfg, SISTEMA, utilizador, AnaliseLLM)


def sanear(analise: AnaliseLLM, perfil: Perfil) -> AnaliseLLM:
    """Remove evidências com IDs inexistentes; requisito sem evidência válida não está cumprido.

    A subpontuação de requisitos obrigatórios é recalculada a partir dos requisitos,
    para ser coerente com as evidências.
    """
    ids = set(indexar(perfil))
    for r in analise.requisitos:
        validos = [i for i in r.evidencia_ids if i in ids]
        if r.cumprido and not validos:
            r.cumprido = False
            r.justificacao = (r.justificacao + " [sem evidência válida no perfil]").strip()
        r.evidencia_ids = validos if r.cumprido else []
    obrig = [r for r in analise.requisitos if r.obrigatorio]
    if obrig:
        analise.subpontuacoes.requisitos_obrigatorios = round(100 * sum(r.cumprido for r in obrig) / len(obrig))
    return analise


def pontuar(cfg: dict, analise: AnaliseLLM, preliminar: bool, metodo: str) -> ResultadoAnalise:
    pesos = pesos_normalizados(cfg)
    sub = analise.subpontuacoes.model_dump()
    usados = {d: pesos[d] for d in DIMENSOES if sub.get(d) is not None and pesos[d] > 0}
    if usados:
        total = sum(usados.values())
        glob = round(sum(sub[d] * p for d, p in usados.items()) / total)
    else:
        glob = 0
    eliminatoria = any(r.eliminatorio and not r.cumprido for r in analise.requisitos)
    limite = int(cfg["compatibilidade"].get("limite_eliminatoria", 49))
    if eliminatoria:
        glob = min(glob, limite)
    glob = max(0, min(100, glob))
    return ResultadoAnalise(
        pontuacao_global=glob,
        subpontuacoes=sub,
        requisitos_cumpridos=[r.model_dump() for r in analise.requisitos if r.cumprido],
        lacunas=[r.model_dump() for r in analise.requisitos if not r.cumprido],
        preliminar=preliminar,
        eliminatoria_falhada=eliminatoria,
        resumo=analise.resumo.strip(),
        metodo=metodo,
    )


def analisar_vaga(cfg: dict, perfil: Perfil, vaga: dict, usar_llm: bool | None = None) -> ResultadoAnalise:
    preliminar = not bool(vaga.get("descricao_completa"))
    if usar_llm is None:
        usar_llm = (not preliminar or cfg["compatibilidade"].get("preliminar_com_llm")) and llm.disponivel(cfg)
    analise, metodo = None, "regras"
    if usar_llm:
        try:
            analise, metodo = analise_llm(cfg, perfil, vaga), "llm"
        except (llm.LLMIndisponivel, ValueError):
            analise = None
    if analise is None:
        analise = regras.analisar(cfg, perfil, vaga)
    return pontuar(cfg, sanear(analise, perfil), preliminar, metodo)


def analisar_e_guardar(conn, cfg: dict, perfil: Perfil, vaga_id: int, usar_llm: bool | None = None) -> ResultadoAnalise:
    from .. import db
    vaga = db.obter_vaga(conn, vaga_id)
    r = analisar_vaga(cfg, perfil, vaga, usar_llm)
    db.guardar_analise(conn, vaga_id, json.loads(r.model_dump_json()), perfil.versao)
    return r
