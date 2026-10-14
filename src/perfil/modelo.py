"""Modelo do perfil-base (fonte única de verdade), validado com pydantic."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator

DATA = re.compile(r"^(\d{4})(-(0[1-9]|1[0-2]))?$")


def _validar_data(v: str | None, permite_atual: bool) -> str | None:
    if v in (None, ""):
        return None
    v = str(v).strip()
    if permite_atual and v.lower() in ("atual", "presente", "present", "current"):
        return "atual"
    if not DATA.match(v):
        raise ValueError(f"data inválida '{v}': use AAAA ou AAAA-MM" + (" ou 'atual'" if permite_atual else ""))
    return v


class ItemTexto(BaseModel):
    id: str = ""
    texto: str
    tipo: str = Field("responsabilidade", description="responsabilidade | resultado | detalhe | resumo")


class DadosPessoais(BaseModel):
    nome: str = ""
    email: str = ""
    telefone: str = ""
    localizacao: str = ""
    linkedin: str = ""
    outros: list[str] = []


class Experiencia(BaseModel):
    id: str = ""
    cargo: str
    empresa: str
    local: str = ""
    data_inicio: str | None = None
    data_fim: str | None = None
    itens: list[ItemTexto] = []

    @field_validator("data_inicio")
    @classmethod
    def _di(cls, v):
        return _validar_data(v, False)

    @field_validator("data_fim")
    @classmethod
    def _df(cls, v):
        return _validar_data(v, True)


class Formacao(BaseModel):
    id: str = ""
    grau: str
    instituicao: str = ""
    data_inicio: str | None = None
    data_fim: str | None = None
    itens: list[ItemTexto] = []

    @field_validator("data_inicio")
    @classmethod
    def _di(cls, v):
        return _validar_data(v, False)

    @field_validator("data_fim")
    @classmethod
    def _df(cls, v):
        return _validar_data(v, True)


class Competencia(BaseModel):
    id: str = ""
    nome: str
    categoria: str = "tecnica"  # tecnica | ferramenta | comportamental
    nivel: str = ""


class Lingua(BaseModel):
    id: str = ""
    nome: str
    nivel: str = ""  # A1..C2, nativo


class Certificacao(BaseModel):
    id: str = ""
    nome: str
    entidade: str = ""
    data: str | None = None

    @field_validator("data")
    @classmethod
    def _d(cls, v):
        return _validar_data(v, False)


class Perfil(BaseModel):
    versao: int = 1
    notas_versao: str = ""
    dados_pessoais: DadosPessoais = DadosPessoais()
    resumo: list[ItemTexto] = []
    experiencia: list[Experiencia] = []
    formacao: list[Formacao] = []
    competencias: list[Competencia] = []
    linguas: list[Lingua] = []
    certificacoes: list[Certificacao] = []

    @model_validator(mode="after")
    def _ids_unicos(self):
        vistos: dict[str, int] = {}
        for i in todos_ids(self):
            if i:  # IDs em falta são atribuídos ao gravar (versoes.atribuir_ids)
                vistos[i] = vistos.get(i, 0) + 1
        dup = sorted(i for i, n in vistos.items() if n > 1)
        if dup:
            raise ValueError("IDs repetidos no perfil: " + ", ".join(dup))
        vazios = [i for i in vistos if not re.match(r"^[a-z0-9_]+$", i)]
        if vazios:
            raise ValueError("IDs inválidos (use só minúsculas, dígitos e _): " + ", ".join(vazios))
        return self


def todos_ids(p: Perfil) -> list[str]:
    ids = [i.id for i in p.resumo]
    for e in p.experiencia:
        ids.append(e.id)
        ids += [i.id for i in e.itens]
    for f in p.formacao:
        ids.append(f.id)
        ids += [i.id for i in f.itens]
    ids += [c.id for c in p.competencias] + [l.id for l in p.linguas] + [c.id for c in p.certificacoes]
    return ids


@dataclass
class ItemIndexado:
    id: str
    tipo: str  # resumo | experiencia | item_experiencia | formacao | item_formacao | competencia | lingua | certificacao
    texto: str  # texto do próprio item
    contexto: str  # texto do item + cabeçalho do item-pai (datas, empresa...)
    pai: str | None = None


def _datas(a: str | None, b: str | None) -> str:
    return " ".join(x for x in (a, b) if x)


def indexar(p: Perfil) -> dict[str, ItemIndexado]:
    """Índice id -> item, usado pelo validador do CV e pela análise de compatibilidade."""
    idx: dict[str, ItemIndexado] = {}
    for r in p.resumo:
        idx[r.id] = ItemIndexado(r.id, "resumo", r.texto, r.texto)
    for e in p.experiencia:
        cab = f"{e.cargo} {e.empresa} {e.local} {_datas(e.data_inicio, e.data_fim)}"
        idx[e.id] = ItemIndexado(e.id, "experiencia", cab, cab)
        for i in e.itens:
            idx[i.id] = ItemIndexado(i.id, "item_experiencia", i.texto, f"{i.texto}\n{cab}", e.id)
    for f in p.formacao:
        cab = f"{f.grau} {f.instituicao} {_datas(f.data_inicio, f.data_fim)}"
        idx[f.id] = ItemIndexado(f.id, "formacao", cab, cab)
        for i in f.itens:
            idx[i.id] = ItemIndexado(i.id, "item_formacao", i.texto, f"{i.texto}\n{cab}", f.id)
    for c in p.competencias:
        t = f"{c.nome} {c.nivel}".strip()
        idx[c.id] = ItemIndexado(c.id, "competencia", t, t)
    for l in p.linguas:
        t = f"{l.nome} {l.nivel}".strip()
        idx[l.id] = ItemIndexado(l.id, "lingua", t, t)
    for c in p.certificacoes:
        t = " ".join(x for x in (c.nome, c.entidade, c.data or "") if x)
        idx[c.id] = ItemIndexado(c.id, "certificacao", t, t)
    return idx


def texto_completo(p: Perfil) -> str:
    return "\n".join(i.contexto for i in indexar(p).values())


def _mes(v: str | None, fim: bool) -> tuple[int, int] | None:
    if not v:
        return None
    if v == "atual":
        h = date.today()
        return h.year, h.month
    a = int(v[:4])
    m = int(v[5:7]) if len(v) >= 7 else (12 if fim else 1)
    return a, m


def anos_experiencia(p: Perfil) -> float:
    """Anos de experiência profissional, sem contar sobreposições."""
    intervalos = []
    for e in p.experiencia:
        i, f = _mes(e.data_inicio, False), _mes(e.data_fim, True)
        if not i:
            continue
        f = f or i
        intervalos.append((i[0] * 12 + i[1] - 1, f[0] * 12 + f[1]))
    intervalos.sort()
    total, atual = 0, None
    for a, b in intervalos:
        if atual is None or a > atual[1]:
            if atual:
                total += atual[1] - atual[0]
            atual = [a, b]
        else:
            atual[1] = max(atual[1], b)
    if atual:
        total += atual[1] - atual[0]
    return round(total / 12, 1)
