"""Schemas pydantic da análise de compatibilidade."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Dimensao = Literal[
    "requisitos_obrigatorios", "experiencia", "competencias_tecnicas",
    "linguas", "localizacao_condicoes", "alinhamento_areas",
]


class Requisito(BaseModel):
    descricao: str
    dimensao: Dimensao
    obrigatorio: bool = False
    eliminatorio: bool = Field(False, description="Falhar este requisito exclui a candidatura (ex.: língua obrigatória)")
    cumprido: bool = False
    evidencia_ids: list[str] = Field(default_factory=list, description="IDs de itens do perfil-base que o comprovam")
    justificacao: str = ""


class Subpontuacoes(BaseModel):
    requisitos_obrigatorios: int | None = Field(None, ge=0, le=100)
    experiencia: int | None = Field(None, ge=0, le=100)
    competencias_tecnicas: int | None = Field(None, ge=0, le=100)
    linguas: int | None = Field(None, ge=0, le=100)
    localizacao_condicoes: int | None = Field(None, ge=0, le=100)
    alinhamento_areas: int | None = Field(None, ge=0, le=100)


class AnaliseLLM(BaseModel):
    """O que o modelo local devolve. A pontuação global é sempre calculada em Python."""
    subpontuacoes: Subpontuacoes
    requisitos: list[Requisito]
    resumo: str = Field(description="2 a 3 frases, factuais, sem prometer probabilidade de contratação")


class ResultadoAnalise(BaseModel):
    pontuacao_global: int
    subpontuacoes: dict[str, int | None]
    requisitos_cumpridos: list[dict]
    lacunas: list[dict]
    preliminar: bool
    eliminatoria_falhada: bool = False
    resumo: str = ""
    metodo: str = "regras"
