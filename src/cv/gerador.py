"""Geração do CV adaptado e da carta de apresentação.

Com modelo local: o modelo seleciona, ordena e reformula, citando source_ids.
Sem modelo (fallback): seleção e ordenação determinísticas por relevância para a vaga,
com o texto do perfil-base copiado tal como está (a reformulação fica manual).
Em ambos os casos o resultado passa pelo validador antes de ser mostrado.
"""
from __future__ import annotations

import json

from .. import llm
from ..perfil.modelo import Perfil, indexar
from ..texto import normalizar
from .schemas import BlocoExperiencia, Carta, CartaLLM, CVAdaptado, CVLLM, Ponto
from .validador import validar_carta, validar_cv

STOP = set("""a o os as de da do das dos e em no na nos nas um uma para por com sem que se ao aos the of and
to in for with on at an be is are our you your we will as or from this that who sua seu suas seus""".split())

IDIOMAS = {"pt": "português europeu", "en": "inglês", "fr": "francês"}


def _termos(vaga: dict) -> set[str]:
    return {w for w in normalizar(f"{vaga.get('cargo', '')} {vaga.get('descricao', '')}").split()
            if len(w) > 3 and w not in STOP}


def _relevancia(texto: str, termos: set[str]) -> int:
    return len(set(normalizar(texto).split()) & termos)


def _ordem_data(e) -> str:
    return "9999" if e.data_fim == "atual" else (e.data_fim or e.data_inicio or "0000")


def gerar_por_regras(perfil: Perfil, vaga: dict, cfg: dict) -> CVAdaptado:
    termos = _termos(vaga)
    maximo = int(cfg["cv"].get("max_pontos_por_experiencia", 5))
    resumo = sorted(perfil.resumo, key=lambda r: -_relevancia(r.texto, termos))
    blocos = []
    for e in sorted(perfil.experiencia, key=_ordem_data, reverse=True):
        itens = sorted(e.itens, key=lambda i: -_relevancia(i.texto, termos))[:maximo]
        blocos.append(BlocoExperiencia(
            experiencia_id=e.id, pontos=[Ponto(texto=i.texto, source_ids=[i.id]) for i in itens]
        ))
    comps = sorted(perfil.competencias, key=lambda c: -_relevancia(c.nome, termos))
    certs = sorted(perfil.certificacoes, key=lambda c: -_relevancia(c.nome, termos))
    return CVAdaptado(
        idioma=cfg["cv"].get("idioma", "pt"),
        resumo=[Ponto(texto=r.texto, source_ids=[r.id]) for r in resumo],
        experiencia=blocos,
        formacao_ids=[f.id for f in perfil.formacao],
        competencias_ids=[c.id for c in comps],
        linguas_ids=[l.id for l in perfil.linguas],
        certificacoes_ids=[c.id for c in certs],
        metodo="regras",
    )


SISTEMA_CV = """Adaptas um CV a uma vaga usando APENAS factos do perfil-base fornecido.
Regras invioláveis:
1. Cada ponto tem source_ids com os IDs exatos dos itens do perfil de onde vem.
2. Podes reordenar, selecionar, omitir e reformular com o vocabulário da vaga, sem mudar o significado.
3. Nunca acrescentes factos: nenhum número, data, percentagem, ferramenta, certificação, língua,
   empresa, cliente ou resultado que não esteja escrito nos itens citados.
4. Os pontos de uma experiência só podem citar a própria experiência ou os seus itens.
   Não juntes ferramentas da lista de competências aos pontos de uma experiência.
5. Mantém os números exatamente como estão na origem.
6. O resumo (2-3 pontos) pode citar quaisquer itens, incluindo competências e línguas.
7. Em formacao_ids, competencias_ids, linguas_ids e certificacoes_ids indica os IDs a incluir, por ordem de relevância.
Os pontos que violem estas regras são bloqueados automaticamente."""


def _perfil_json(perfil: Perfil) -> str:
    return json.dumps(perfil.model_dump(exclude={"notas_versao"}), ensure_ascii=False, indent=1)


def gerar_por_llm(perfil: Perfil, vaga: dict, cfg: dict, idioma: str) -> CVAdaptado:
    utilizador = (
        f"Escreve em {IDIOMAS.get(idioma, idioma)}. Máximo de {cfg['cv'].get('max_pontos_por_experiencia', 5)} "
        f"pontos por experiência.\n\nPERFIL-BASE (JSON, cada item com 'id'):\n{_perfil_json(perfil)}\n\n"
        f"VAGA:\nCargo: {vaga.get('cargo')}\nEmpresa: {vaga.get('empresa')}\n"
        f"Descrição:\n{vaga.get('descricao', '')}"
    )
    r = llm.gerar_json(cfg, SISTEMA_CV, utilizador, CVLLM)
    return CVAdaptado.model_validate({**r.model_dump(), "idioma": idioma, "metodo": "llm"})


def gerar_cv(perfil: Perfil, vaga: dict, cfg: dict, usar_llm: bool | None = None, idioma: str | None = None) -> CVAdaptado:
    idioma = idioma or cfg["cv"].get("idioma", "pt")
    if usar_llm is None:
        usar_llm = llm.disponivel(cfg)
    cv = None
    if usar_llm:
        try:
            cv = gerar_por_llm(perfil, vaga, cfg, idioma)
        except (llm.LLMIndisponivel, ValueError):
            cv = None
    if cv is None:
        cv = gerar_por_regras(perfil, vaga, cfg)
        cv.idioma = idioma
    return validar_cv(cv, perfil, cfg)


# ---------------------------------------------------------------- carta de apresentação

SISTEMA_CARTA = """Escreves o corpo de uma carta de apresentação (3 a 4 parágrafos curtos) usando APENAS
factos do perfil-base. Cada parágrafo tem source_ids com os IDs dos itens de onde vêm os factos.
Podes mencionar o cargo e a empresa da vaga. Não acrescentes números, ferramentas, certificações,
línguas, empresas ou resultados que não estejam nos itens citados. Não escrevas saudação nem despedida."""


def gerar_carta(perfil: Perfil, vaga: dict, cfg: dict, usar_llm: bool | None = None, idioma: str | None = None) -> Carta:
    idioma = idioma or cfg["cv"].get("idioma", "pt")
    if usar_llm is None:
        usar_llm = llm.disponivel(cfg)
    carta = None
    if usar_llm:
        try:
            r = llm.gerar_json(
                cfg, SISTEMA_CARTA,
                f"Escreve em {IDIOMAS.get(idioma, idioma)}.\n\nPERFIL-BASE:\n{_perfil_json(perfil)}\n\n"
                f"VAGA:\nCargo: {vaga.get('cargo')}\nEmpresa: {vaga.get('empresa')}\nDescrição:\n{vaga.get('descricao', '')}",
                CartaLLM,
            )
            carta = Carta.model_validate({**r.model_dump(), "idioma": idioma, "metodo": "llm"})
        except (llm.LLMIndisponivel, ValueError):
            carta = None
    if carta is None:
        # Sem modelo: parágrafos-base com os itens mais relevantes, copiados do perfil, para editar à mão.
        termos = _termos(vaga)
        idx = indexar(perfil)
        itens = sorted((i for i in idx.values() if i.tipo in ("resumo", "item_experiencia")),
                       key=lambda i: -_relevancia(i.texto, termos))[:3]
        carta = Carta(idioma=idioma, metodo="regras",
                      paragrafos=[Ponto(texto=i.texto, source_ids=[i.id]) for i in itens])
    return validar_carta(carta, perfil, cfg, vaga)
