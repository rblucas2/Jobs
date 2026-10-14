"""Análise de compatibilidade por palavras-chave e regras (fallback sem modelo).

Cada requisito detetado na vaga é comparado com o perfil-base, com os IDs dos itens
que o comprovam. Dimensões sem dados na vaga ficam a None e saem da ponderação, em vez
de receberem um valor neutro arbitrário.
"""
from __future__ import annotations

import re

from ..perfil.modelo import Perfil, anos_experiencia, indexar
from ..texto import contem_termo, frases, normalizar, sem_acentos, sinonimos
from .schemas import AnaliseLLM, Requisito, Subpontuacoes

LINGUAS = {
    "Português": ["portugues", "portuguese", "portugais"],
    "Inglês": ["ingles", "english", "anglais"],
    "Francês": ["frances", "french", "francais"],
    "Alemão": ["alemao", "german", "deutsch", "allemand"],
    "Luxemburguês": ["luxemburgues", "luxembourgish", "luxembourgeois", "letzebuergesch"],
    "Espanhol": ["espanhol", "spanish", "espanol", "castelhano"],
    "Italiano": ["italiano", "italian"],
    "Neerlandês": ["neerlandes", "holandes", "dutch"],
}
NIVEIS = {"a1": 1, "a2": 2, "b1": 3, "b2": 4, "c1": 5, "c2": 6}
NIVEL_PALAVRAS = [
    (r"nativ|native|materna|mother tongue|bilingu", 6),
    (r"fluen|proficien|courant|excelente|excellent|avancad|advanced", 5),
    (r"interm", 3),
    (r"basic|basico|elementar", 2),
]
OBRIGATORIO = re.compile(
    r"(obrigatori|imprescindivel|essencial|exigid|indispensavel|requisito|required|requirement|must|mandatory|"
    r"essential|necessar|minimo|minimum|at least|pelo menos|fluen|exige|obligatoire|exige)", re.I,
)
ANOS = re.compile(r"(\d{1,2})\s*\+?\s*(?:(?:-|a|to)\s*\d{1,2}\s*)?(?:anos|years|ans)\b", re.I)
REMOTO = re.compile(r"(remot|remote|teletrabalho|home ?office|full remote)", re.I)
MESTRADO = re.compile(r"(mestrado|master|msc|m\.sc|mba)", re.I)
LICENCIATURA = re.compile(r"(licenciatura|licenciad|bachelor|degree|graduacao|graduation|ensino superior)", re.I)


def _nivel(texto: str) -> int:
    t = sem_acentos(texto or "").lower()
    m = re.search(r"\b([abc][12])\b", t)
    if m:
        return NIVEIS[m.group(1)]
    for rx, n in NIVEL_PALAVRAS:
        if re.search(rx, t):
            return n
    return 0


def _evidencias(idx, termo: str, tipos: tuple[str, ...] | None = None) -> list[str]:
    return [i.id for i in idx.values() if (tipos is None or i.tipo in tipos) and contem_termo(i.texto, termo)]


def _vocabulario(cfg: dict, perfil: Perfil) -> list[list[str]]:
    termos = [sinonimos(t) for t in cfg["vocabulario"].get("ferramentas", [])]
    termos += [sinonimos(t) for t in cfg["vocabulario"].get("certificacoes", [])]
    conhecidos = {normalizar(s) for g in termos for s in g}
    for c in perfil.competencias + perfil.certificacoes:
        if normalizar(c.nome) not in conhecidos and len(c.nome) <= 40:
            termos.append([c.nome])
    return termos


def _pct(cumpridos: int, total: int) -> int | None:
    return round(100 * cumpridos / total) if total else None


def analisar(cfg: dict, perfil: Perfil, vaga: dict) -> AnaliseLLM:
    idx = indexar(perfil)
    cargo = vaga.get("cargo", "")
    texto = f"{cargo}\n{vaga.get('descricao', '')}"
    sentencas = frases(sem_acentos(texto))
    # Para a obrigatoriedade, a frase inteira conta ("Requisitos obrigatórios: A; B; C.").
    obrig_sent = [s for s in re.split(r"(?<=[.!?])\s+|\n+", sem_acentos(texto)) if OBRIGATORIO.search(s)]

    def obrigatorio(termo: str) -> bool:
        return any(contem_termo(s, termo) for s in obrig_sent)

    reqs: list[Requisito] = []

    # Línguas
    linguas_perfil = {}
    for l in perfil.linguas:
        for nome, sins in LINGUAS.items():
            if any(contem_termo(l.nome, s) for s in sins):
                linguas_perfil[nome] = (l.id, _nivel(l.nivel))
    for nome, sins in LINGUAS.items():
        sent = [s for s in sentencas if any(contem_termo(s, x) for x in sins)]
        if not sent:
            continue
        exigido = max((_nivel(s) for s in sent), default=0) or 3
        obrig = any(OBRIGATORIO.search(s) for s in sent)
        lid, nivel = linguas_perfil.get(nome, (None, 0))
        ok = lid is not None and nivel >= exigido
        reqs.append(Requisito(
            descricao=f"{nome} (nível pedido ≈ {['-', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'][exigido]})",
            dimensao="linguas", obrigatorio=obrig, eliminatorio=obrig, cumprido=ok,
            evidencia_ids=[lid] if lid and ok else [],
            justificacao=("no perfil" if ok else ("nível inferior ao pedido" if lid else "não consta do perfil")),
        ))

    # Anos de experiência
    anos_perfil = anos_experiencia(perfil)
    m = ANOS.search(sem_acentos(texto))
    if m:
        pedidos = int(m.group(1))
        ok = anos_perfil >= pedidos
        reqs.append(Requisito(
            descricao=f"{pedidos}+ anos de experiência", dimensao="experiencia",
            obrigatorio=True, cumprido=ok,  # um mínimo de anos explícito é tratado como requisito
            evidencia_ids=[e.id for e in perfil.experiencia] if ok else [],
            justificacao=f"perfil: {anos_perfil} anos",
        ))

    # Formação
    for rx, nome in ((MESTRADO, "Mestrado"), (LICENCIATURA, "Licenciatura")):
        sent = [s for s in sentencas if rx.search(s)]
        if not sent:
            continue
        ev = [f.id for f in perfil.formacao if rx.search(sem_acentos(f.grau)) or (nome == "Licenciatura" and MESTRADO.search(sem_acentos(f.grau)))]
        reqs.append(Requisito(
            descricao=nome, dimensao="requisitos_obrigatorios",
            obrigatorio=any(OBRIGATORIO.search(s) for s in sent), cumprido=bool(ev), evidencia_ids=ev,
            justificacao="no perfil" if ev else "não consta do perfil",
        ))
        break

    # Competências técnicas / ferramentas / certificações
    for grupo in _vocabulario(cfg, perfil):
        encontrado = next((t for t in grupo if contem_termo(texto, t)), None)
        if not encontrado:
            continue
        ev = sorted({i for t in grupo for i in _evidencias(idx, t)})
        reqs.append(Requisito(
            descricao=grupo[0], dimensao="competencias_tecnicas", obrigatorio=obrigatorio(encontrado),
            cumprido=bool(ev), evidencia_ids=ev, justificacao="no perfil" if ev else "não consta do perfil",
        ))

    # Experiência: tipo (sobreposição do título da vaga com cargos/itens do perfil)
    palavras = [w for w in normalizar(cargo).split() if len(w) > 3]
    texto_exp = normalizar(" ".join(i.contexto for i in idx.values() if i.tipo in ("experiencia", "item_experiencia")))
    tipo = round(100 * sum(w in texto_exp for w in palavras) / len(palavras)) if palavras else None

    # Localização
    loc_vaga = f"{vaga.get('localizacao', '')} {vaga.get('descricao', '')[:400]}"
    alvo = [sinonimos(l) for l in cfg.get("localizacoes_alvo", [])]
    if REMOTO.search(sem_acentos(loc_vaga)) and cfg.get("aceita_remoto", True):
        loc = 100
    elif vaga.get("localizacao") or any(contem_termo(loc_vaga, s) for g in alvo for s in g):
        loc = 100 if any(contem_termo(loc_vaga, s) for g in alvo for s in g) else 0
    else:
        loc = None

    # Áreas-alvo
    areas = [sinonimos(a) for a in cfg.get("areas_alvo", [])]
    if any(contem_termo(cargo, s) for g in areas for s in g):
        area = 100
    elif any(contem_termo(vaga.get("descricao", ""), s) for g in areas for s in g):
        area = 60
    else:
        area = 0 if areas else None

    def pct(dim: str, so_obrig: bool = False) -> int | None:
        rs = [r for r in reqs if r.dimensao == dim and (r.obrigatorio or not so_obrig)]
        return _pct(sum(r.cumprido for r in rs), len(rs))

    obrig = [r for r in reqs if r.obrigatorio]
    exp_anos = pct("experiencia")
    if exp_anos is not None and tipo is not None:
        exp = round(0.7 * exp_anos + 0.3 * tipo)
    else:
        exp = exp_anos if exp_anos is not None else tipo

    sub = Subpontuacoes(
        requisitos_obrigatorios=_pct(sum(r.cumprido for r in obrig), len(obrig)),
        experiencia=exp,
        competencias_tecnicas=pct("competencias_tecnicas"),
        linguas=pct("linguas"),
        localizacao_condicoes=loc,
        alinhamento_areas=area,
    )
    cumpridos = [r for r in reqs if r.cumprido]
    falta = [r for r in reqs if not r.cumprido]
    resumo = f"Cumpre {len(cumpridos)} de {len(reqs)} requisitos detetados na vaga."
    if falta:
        resumo += " Lacunas: " + ", ".join(r.descricao for r in falta[:4]) + "."
    if not reqs:
        resumo = "Não foram detetados requisitos concretos no texto da vaga."
    return AnaliseLLM(subpontuacoes=sub, requisitos=reqs, resumo=resumo)
