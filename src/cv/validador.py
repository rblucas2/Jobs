"""Validador automático do CV adaptado (M4) — corre antes de qualquer resultado ser mostrado.

Um ponto é bloqueado ("não verificado") se:
  1. não tiver source_ids, ou citar um ID que não existe no perfil-base;
  2. citar itens de outra secção (ex.: um ponto da experiência A que cita a experiência B,
     ou uma competência — o que acrescentaria o facto "usei X neste cargo");
  3. contiver um número, data ou percentagem que não exista nos itens de origem
     (inclui números por extenso e multiplicadores como "mil", "milhões", "k");
  4. mencionar uma ferramenta, certificação, competência ou língua que não exista nos itens de origem;
  5. usar termos quantitativos ou de distinção ("duplicou", "melhor", "prémio"...) ausentes da origem;
  6. mencionar um nome próprio/sigla (ex.: empresa, cliente, norma) ausente da origem.

Regra de exceção documentada: no resumo, "N anos de experiência" é aceite se N não
exceder os anos calculados a partir das datas do perfil e o ponto citar uma experiência.

O validador é deliberadamente conservador: prefere bloquear um ponto legítimo (que o
utilizador corrige) a deixar passar um facto que não está no perfil.
"""
from __future__ import annotations

import math
import re
from decimal import Decimal, InvalidOperation

from ..compatibilidade.regras import LINGUAS
from ..perfil.modelo import ItemIndexado, Perfil, anos_experiencia, indexar
from ..texto import normalizar, regex_termo, sem_acentos, sinonimos
from .schemas import NAO_VERIFICADO, VERIFICADO, Carta, CVAdaptado, Ponto

# ---------------------------------------------------------------- números

_SEP = r"[.,   ]"
NUMERO = re.compile(rf"(?<!\d)\d+(?:{_SEP}\d{{3}}(?!\d))*(?:[.,]\d+)?")
PERCENT = re.compile(rf"(\d+(?:{_SEP}\d{{3}}(?!\d))*(?:[.,]\d+)?)\s*(%|por\s*cento|percent|pct\b|p\.?\s?p\.?)", re.I)

PALAVRAS_NUMERO = {
    # pt
    "dois": 2, "duas": 2, "tres": 3, "quatro": 4, "cinco": 5, "seis": 6, "sete": 7, "oito": 8, "nove": 9,
    "dez": 10, "onze": 11, "doze": 12, "treze": 13, "catorze": 14, "quatorze": 14, "quinze": 15,
    "dezasseis": 16, "dezesseis": 16, "dezassete": 17, "dezessete": 17, "dezoito": 18, "dezanove": 19,
    "dezenove": 19, "vinte": 20, "trinta": 30, "quarenta": 40, "cinquenta": 50, "sessenta": 60,
    "setenta": 70, "oitenta": 80, "noventa": 90, "cem": 100, "cento": 100, "duzentos": 200,
    "trezentos": 300, "quinhentos": 500,
    # en
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90, "hundred": 100,
}
# Multiplicadores e quantidades coletivas: têm de aparecer literalmente na origem.
MULTIPLICADORES = {
    "mil", "milhao", "milhoes", "milhar", "milhares", "bilhao", "bilhoes", "dezenas", "centenas", "duzia",
    "duzias", "thousand", "thousands", "million", "millions", "billion", "billions", "dozen", "dozens",
    "hundreds", "k", "m", "mm", "bn", "mn",
}
# Termos quantitativos ou de distinção: têm de existir na origem.
QUANT_PREFIXOS = ["duplic", "dobr", "tripl", "quadrupl", "doubl", "halv", "premi", "award", "galardo"]
QUANT_PALAVRAS = {
    "metade", "half", "melhor", "melhores", "best", "top", "record", "records", "recorde", "recordes",
    "maior", "maiores", "largest", "biggest", "primeiro", "primeira", "first", "unico", "unica", "only",
    "todos", "todas", "all", "sempre", "always",
}


def _valores(token: str) -> set[Decimal]:
    """Interpretações possíveis de um número escrito (ex.: '1.500' = 1500 ou 1,5)."""
    t = token.replace(" ", " ").replace(" ", " ")
    out: set[Decimal] = set()
    try:
        if re.fullmatch(r"\d+", t):
            out.add(Decimal(t))
        if re.fullmatch(r"\d{1,3}(?:[., ]\d{3})+", t):
            out.add(Decimal(re.sub(r"[., ]", "", t)))
        m = re.fullmatch(r"(\d+(?:[., ]\d{3})*)[.,](\d+)", t)
        if m:
            out.add(Decimal(re.sub(r"[., ]", "", m.group(1)) + "." + m.group(2)))
    except InvalidOperation:
        pass
    return {v.normalize() for v in out}


def numeros(texto: str) -> set[Decimal]:
    vals: set[Decimal] = set()
    for m in NUMERO.finditer(texto or ""):
        vals |= _valores(m.group(0))
    return vals


def percentagens(texto: str) -> set[Decimal]:
    vals: set[Decimal] = set()
    for m in PERCENT.finditer(texto or ""):
        vals |= _valores(m.group(1))
    return vals


def _tokens(texto: str) -> list[str]:
    return re.findall(r"[a-z0-9&]+", sem_acentos(texto or "").lower())


def _tokens_com_numeros_colados(texto: str) -> list[str]:
    """Separa sufixos colados a números: '50k' -> ['50', 'k'], '2M€' -> ['2', 'm']."""
    t = re.sub(r"(\d)([a-zA-Z]+)", r"\1 \2", sem_acentos(texto or ""))
    return re.findall(r"[a-z0-9&]+", t.lower())


# ---------------------------------------------------------------- nomes próprios / siglas

_PALAVRA_MAIUSC = re.compile(r"[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][\wÀ-ÿ&+./-]*")
_INICIO_FRASE = re.compile(r"(^|[.!?:;(\[\"“«•\-–—]\s*)$")
# Palavras que é normal surgirem com maiúscula a meio da frase.
MAIUSC_PERMITIDAS = {"i"}


def nomes_proprios(texto: str) -> list[str]:
    encontrados = []
    for m in _PALAVRA_MAIUSC.finditer(texto or ""):
        antes = texto[: m.start()]
        if _INICIO_FRASE.search(antes):
            continue
        palavra = m.group(0).rstrip("./-")
        if len(palavra) < 2 or normalizar(palavra) in MAIUSC_PERMITIDAS:
            continue
        encontrados.append(palavra)
    return encontrados


# ---------------------------------------------------------------- vocabulário controlado

def grupos_vocabulario(cfg: dict | None, perfil: Perfil) -> list[tuple[str, list[str]]]:
    """(rótulo, sinónimos) de ferramentas, certificações, competências e línguas."""
    grupos: list[tuple[str, list[str]]] = []
    voc = (cfg or {}).get("vocabulario", {}) if cfg else {}
    for categoria in ("ferramentas", "certificacoes"):
        for t in voc.get(categoria, []) or []:
            s = sinonimos(t)
            if s:
                grupos.append((s[0], s))
    for c in perfil.competencias:
        grupos.append((c.nome, [c.nome]))
    for c in perfil.certificacoes:
        grupos.append((c.nome, [c.nome]))
    for nome, sins in LINGUAS.items():
        grupos.append((nome, [nome] + sins))
    return grupos


def _menciona(texto: str, termo: str) -> bool:
    return bool(regex_termo(termo).search(sem_acentos(texto)))


# ---------------------------------------------------------------- validação de um ponto

def validar_ponto(
    ponto: Ponto,
    idx: dict[str, ItemIndexado],
    tipos_permitidos: set[str] | None,
    pai_obrigatorio: str | None,
    grupos: list[tuple[str, list[str]]],
    anos_perfil: float,
    termos_permitidos: list[str] | None = None,
) -> Ponto:
    motivos: list[str] = []
    texto = (ponto.texto or "").strip()
    ids = [i.strip() for i in ponto.source_ids if i and i.strip()]

    if not texto:
        motivos.append("ponto vazio")
    if not ids:
        motivos.append("sem source_ids: não há item do perfil-base de origem")
    inexistentes = [i for i in ids if i not in idx]
    if inexistentes:
        motivos.append("source_ids inexistentes no perfil-base: " + ", ".join(inexistentes))
    validos = [idx[i] for i in ids if i in idx]

    if tipos_permitidos is not None:
        for it in validos:
            if it.tipo not in tipos_permitidos:
                motivos.append(f"o item {it.id} ({it.tipo}) não pode ser origem de um ponto nesta secção")
    if pai_obrigatorio:
        for it in validos:
            if it.id != pai_obrigatorio and it.pai != pai_obrigatorio:
                motivos.append(f"o item {it.id} pertence a outra secção/experiência que não {pai_obrigatorio}")

    contexto = "\n".join(it.contexto for it in validos)
    permitidos_txt = "\n".join(termos_permitidos or [])
    contexto_total = contexto + "\n" + permitidos_txt

    # 3. números, datas e percentagens
    nums_origem = numeros(contexto_total)
    excecao_anos: set[Decimal] = set()
    if any(it.tipo == "experiencia" or it.pai and idx.get(it.pai) and idx[it.pai].tipo == "experiencia" for it in validos):
        for m in re.finditer(r"(\d+)\s*\+?\s*(?:anos|years)\b", sem_acentos(texto), re.I):
            n = int(m.group(1))
            if tipos_permitidos is None and n <= math.floor(anos_perfil):
                excecao_anos.add(Decimal(n))
    em_falta = []
    for m in NUMERO.finditer(texto):
        vals = _valores(m.group(0))
        if vals and not (vals & nums_origem) and not (vals & excecao_anos):
            em_falta.append(m.group(0))
    if em_falta:
        motivos.append("números/datas sem correspondência na origem: " + ", ".join(dict.fromkeys(em_falta)))
    pct_origem = percentagens(contexto_total)
    pct_falta = [m.group(0) for m in PERCENT.finditer(texto) if not (_valores(m.group(1)) & pct_origem)]
    if pct_falta:
        motivos.append("percentagens sem correspondência na origem: " + ", ".join(pct_falta))

    tokens_ponto = _tokens_com_numeros_colados(texto)
    tokens_origem = set(_tokens_com_numeros_colados(contexto_total))
    for tok in tokens_ponto:
        if tok in PALAVRAS_NUMERO and tok not in tokens_origem and Decimal(PALAVRAS_NUMERO[tok]) not in nums_origem:
            motivos.append(f"número por extenso sem correspondência na origem: '{tok}'")
        if tok in MULTIPLICADORES and tok not in tokens_origem:
            motivos.append(f"multiplicador/quantidade ausente da origem: '{tok}'")

    # 5. termos quantitativos/de distinção
    tk_ponto, tk_origem = _tokens(texto), set(_tokens(contexto_total))
    for tok in dict.fromkeys(tk_ponto):
        if tok in QUANT_PALAVRAS and tok not in tk_origem:
            motivos.append(f"termo quantitativo/de distinção ausente da origem: '{tok}'")
        for q in QUANT_PREFIXOS:
            if tok.startswith(q) and not any(o.startswith(q) for o in tk_origem):
                motivos.append(f"termo quantitativo/de distinção ausente da origem: '{tok}'")

    # 4. ferramentas, certificações, competências e línguas
    for rotulo, sins in grupos:
        if any(_menciona(texto, s) for s in sins) and not any(_menciona(contexto_total, s) for s in sins):
            motivos.append(f"'{rotulo}' não existe nos itens de origem")

    # 6. nomes próprios e siglas
    norm_ctx = normalizar(contexto_total)
    for nome in nomes_proprios(texto):
        n = normalizar(nome)
        if n and not re.search(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", norm_ctx):
            motivos.append(f"nome próprio/sigla ausente da origem: '{nome}'")

    motivos = list(dict.fromkeys(motivos))
    return ponto.model_copy(update={
        "texto": texto, "source_ids": ids,
        "estado": NAO_VERIFICADO if motivos else VERIFICADO, "motivos": motivos,
    })


# ---------------------------------------------------------------- CV e carta

def validar_cv(cv: CVAdaptado, perfil: Perfil, cfg: dict | None = None) -> CVAdaptado:
    idx = indexar(perfil)
    grupos = grupos_vocabulario(cfg, perfil)
    anos = anos_experiencia(perfil)
    erros: list[str] = []

    resumo = [validar_ponto(p, idx, None, None, grupos, anos) for p in cv.resumo]

    blocos = []
    vistos = set()
    for b in cv.experiencia:
        item = idx.get(b.experiencia_id)
        if item is None or item.tipo != "experiencia":
            erros.append(f"experiência inexistente no perfil-base: {b.experiencia_id}")
        if b.experiencia_id in vistos:
            erros.append(f"experiência repetida: {b.experiencia_id}")
        vistos.add(b.experiencia_id)
        pontos = [validar_ponto(p, idx, {"experiencia", "item_experiencia"}, b.experiencia_id, grupos, anos)
                  for p in b.pontos]
        blocos.append(b.model_copy(update={"pontos": pontos}))

    def ids_tipo(lista: list[str], tipo: str, nome: str) -> list[str]:
        for i in lista:
            if i not in idx or idx[i].tipo != tipo:
                erros.append(f"{nome}: ID inexistente ou de outro tipo: {i}")
        return [i for i in dict.fromkeys(lista)]

    return cv.model_copy(update={
        "resumo": resumo,
        "experiencia": blocos,
        "formacao_ids": ids_tipo(cv.formacao_ids, "formacao", "formação"),
        "competencias_ids": ids_tipo(cv.competencias_ids, "competencia", "competências"),
        "linguas_ids": ids_tipo(cv.linguas_ids, "lingua", "línguas"),
        "certificacoes_ids": ids_tipo(cv.certificacoes_ids, "certificacao", "certificações"),
        "erros": erros,
    })


def validar_carta(carta: Carta, perfil: Perfil, cfg: dict | None, vaga: dict) -> Carta:
    """Os parágrafos seguem as mesmas regras; só se acrescentam como termos permitidos
    o cargo e a empresa da vaga (a quem a carta se dirige)."""
    idx = indexar(perfil)
    grupos = grupos_vocabulario(cfg, perfil)
    permitidos = [vaga.get("cargo", ""), vaga.get("empresa", "")]
    pars = [validar_ponto(p, idx, None, None, grupos, anos_experiencia(perfil), permitidos) for p in carta.paragrafos]
    return carta.model_copy(update={"paragrafos": pars, "erros": []})


def problemas(doc: CVAdaptado | Carta) -> list[str]:
    """Lista de impedimentos à aprovação (vazia = pode ser aprovado)."""
    out = list(doc.erros)
    for p in doc.pontos():
        if p.estado != VERIFICADO:
            out.append(f"ponto não verificado: «{p.texto[:80]}» — " + "; ".join(p.motivos))
    if not doc.pontos():
        out.append("o documento não tem pontos")
    return out


def pode_aprovar(doc: CVAdaptado | Carta) -> bool:
    return not problemas(doc)
