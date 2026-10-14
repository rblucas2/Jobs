"""Base de dados SQLite: vagas, analises, cvs, candidaturas (+ registo de e-mails não reconhecidos)."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

ESQUEMA = """
CREATE TABLE IF NOT EXISTS vagas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cargo TEXT NOT NULL,
    empresa TEXT NOT NULL DEFAULT '',
    localizacao TEXT NOT NULL DEFAULT '',
    link_canonico TEXT UNIQUE,
    link_original TEXT,
    chave_normalizada TEXT NOT NULL,
    fonte TEXT NOT NULL,
    data_publicacao TEXT,
    data_recolha TEXT NOT NULL,
    descricao TEXT NOT NULL DEFAULT '',
    descricao_completa INTEGER NOT NULL DEFAULT 0,
    gmail_message_id TEXT,
    origem TEXT NOT NULL DEFAULT 'gmail'
);
CREATE INDEX IF NOT EXISTS idx_vagas_chave ON vagas(chave_normalizada);

CREATE TABLE IF NOT EXISTS analises (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vaga_id INTEGER NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
    pontuacao_global INTEGER NOT NULL,
    subpontuacoes TEXT NOT NULL,
    requisitos_cumpridos TEXT NOT NULL,
    lacunas TEXT NOT NULL,
    preliminar INTEGER NOT NULL,
    eliminatoria_falhada INTEGER NOT NULL DEFAULT 0,
    resumo TEXT NOT NULL DEFAULT '',
    metodo TEXT NOT NULL DEFAULT 'regras',
    versao_perfil INTEGER,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analises_vaga ON analises(vaga_id);

CREATE TABLE IF NOT EXISTS cvs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vaga_id INTEGER NOT NULL REFERENCES vagas(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL DEFAULT 'cv' CHECK (tipo IN ('cv', 'carta')),
    versao_perfil INTEGER NOT NULL,
    conteudo TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'rascunho' CHECK (estado IN ('rascunho', 'aprovado', 'rejeitado')),
    caminho_docx TEXT,
    caminho_pdf TEXT,
    data_criacao TEXT NOT NULL,
    data_aprovacao TEXT
);
CREATE INDEX IF NOT EXISTS idx_cvs_vaga ON cvs(vaga_id);

CREATE TABLE IF NOT EXISTS candidaturas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vaga_id INTEGER NOT NULL UNIQUE REFERENCES vagas(id) ON DELETE CASCADE,
    cv_id INTEGER REFERENCES cvs(id),
    estado TEXT NOT NULL DEFAULT 'Por candidatar',
    data_candidatura TEXT,
    data_entrevista TEXT,
    contacto TEXT NOT NULL DEFAULT '',
    notas TEXT NOT NULL DEFAULT '',
    data_followup TEXT,
    data_atualizacao TEXT
);

CREATE TABLE IF NOT EXISTS emails_nao_reconhecidos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_message_id TEXT UNIQUE,
    fonte TEXT,
    remetente TEXT,
    assunto TEXT,
    data_email TEXT,
    motivo TEXT,
    data_registo TEXT NOT NULL,
    resolvido INTEGER NOT NULL DEFAULT 0
);
"""


def agora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def ligar(caminho: str | Path) -> sqlite3.Connection:
    caminho = str(caminho)
    if caminho != ":memory:":
        Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(caminho, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(ESQUEMA)
    return conn


def _dict(row) -> dict | None:
    return dict(row) if row is not None else None


def _json(v) -> str:
    return json.dumps(v, ensure_ascii=False)


# ---------------------------------------------------------------- vagas

def encontrar_duplicado(conn, link_canonico: str | None, chave: str) -> int | None:
    if link_canonico:
        r = conn.execute("SELECT id FROM vagas WHERE link_canonico = ?", (link_canonico,)).fetchone()
        if r:
            return r["id"]
    r = conn.execute("SELECT id FROM vagas WHERE chave_normalizada = ?", (chave,)).fetchone()
    return r["id"] if r else None


def inserir_vaga(conn, v: dict) -> int:
    cur = conn.execute(
        """INSERT INTO vagas (cargo, empresa, localizacao, link_canonico, link_original,
               chave_normalizada, fonte, data_publicacao, data_recolha, descricao,
               descricao_completa, gmail_message_id, origem)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            v["cargo"], v.get("empresa", ""), v.get("localizacao", ""), v.get("link_canonico"),
            v.get("link_original"), v["chave_normalizada"], v["fonte"], v.get("data_publicacao"),
            v.get("data_recolha") or agora(), v.get("descricao", ""), int(bool(v.get("descricao_completa"))),
            v.get("gmail_message_id"), v.get("origem", "gmail"),
        ),
    )
    vaga_id = cur.lastrowid
    conn.execute(
        "INSERT INTO candidaturas (vaga_id, estado, data_atualizacao) VALUES (?, 'Por candidatar', ?)",
        (vaga_id, agora()),
    )
    conn.commit()
    return vaga_id


def obter_vaga(conn, vaga_id: int) -> dict | None:
    return _dict(conn.execute("SELECT * FROM vagas WHERE id = ?", (vaga_id,)).fetchone())


def listar_vagas(conn) -> list[dict]:
    rows = conn.execute(
        """SELECT v.*, c.estado, c.data_candidatura, c.data_followup, c.data_entrevista,
                  c.cv_id, c.contacto, c.notas,
                  a.pontuacao_global, a.preliminar, a.eliminatoria_falhada, a.metodo
           FROM vagas v
           LEFT JOIN candidaturas c ON c.vaga_id = v.id
           LEFT JOIN analises a ON a.id = (SELECT MAX(id) FROM analises WHERE vaga_id = v.id)
           ORDER BY COALESCE(a.pontuacao_global, -1) DESC, v.data_recolha DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


def atualizar_descricao(conn, vaga_id: int, descricao: str, completa: bool) -> None:
    conn.execute(
        "UPDATE vagas SET descricao = ?, descricao_completa = ? WHERE id = ?",
        (descricao, int(bool(completa)), vaga_id),
    )
    conn.commit()


def atualizar_vaga(conn, vaga_id: int, **campos) -> None:
    permitidos = {"cargo", "empresa", "localizacao", "fonte", "data_publicacao"}
    sets = {k: v for k, v in campos.items() if k in permitidos}
    if not sets:
        return
    conn.execute(
        f"UPDATE vagas SET {', '.join(f'{k} = ?' for k in sets)} WHERE id = ?",
        (*sets.values(), vaga_id),
    )
    conn.commit()


# ---------------------------------------------------------------- análises

def guardar_analise(conn, vaga_id: int, r: dict, versao_perfil: int | None) -> int:
    cur = conn.execute(
        """INSERT INTO analises (vaga_id, pontuacao_global, subpontuacoes, requisitos_cumpridos,
               lacunas, preliminar, eliminatoria_falhada, resumo, metodo, versao_perfil, data)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (
            vaga_id, int(r["pontuacao_global"]), _json(r["subpontuacoes"]), _json(r["requisitos_cumpridos"]),
            _json(r["lacunas"]), int(bool(r["preliminar"])), int(bool(r.get("eliminatoria_falhada"))),
            r.get("resumo", ""), r.get("metodo", "regras"), versao_perfil, agora(),
        ),
    )
    conn.commit()
    return cur.lastrowid


def ultima_analise(conn, vaga_id: int) -> dict | None:
    r = _dict(conn.execute(
        "SELECT * FROM analises WHERE vaga_id = ? ORDER BY id DESC LIMIT 1", (vaga_id,)
    ).fetchone())
    if r:
        for k in ("subpontuacoes", "requisitos_cumpridos", "lacunas"):
            r[k] = json.loads(r[k])
    return r


def vagas_sem_analise(conn) -> list[int]:
    rows = conn.execute(
        "SELECT id FROM vagas WHERE id NOT IN (SELECT DISTINCT vaga_id FROM analises)"
    ).fetchall()
    return [r["id"] for r in rows]


# ---------------------------------------------------------------- CVs

def guardar_cv(conn, vaga_id: int, tipo: str, versao_perfil: int, conteudo: dict) -> int:
    cur = conn.execute(
        "INSERT INTO cvs (vaga_id, tipo, versao_perfil, conteudo, estado, data_criacao) VALUES (?,?,?,?, 'rascunho', ?)",
        (vaga_id, tipo, versao_perfil, _json(conteudo), agora()),
    )
    conn.commit()
    return cur.lastrowid


def obter_cv(conn, cv_id: int) -> dict | None:
    r = _dict(conn.execute("SELECT * FROM cvs WHERE id = ?", (cv_id,)).fetchone())
    if r:
        r["conteudo"] = json.loads(r["conteudo"])
    return r


def listar_cvs(conn, vaga_id: int | None = None, estado: str | None = None, tipo: str | None = None) -> list[dict]:
    q, args = "SELECT c.*, v.cargo, v.empresa FROM cvs c JOIN vagas v ON v.id = c.vaga_id WHERE 1=1", []
    if vaga_id is not None:
        q += " AND c.vaga_id = ?"; args.append(vaga_id)
    if estado:
        q += " AND c.estado = ?"; args.append(estado)
    if tipo:
        q += " AND c.tipo = ?"; args.append(tipo)
    rows = conn.execute(q + " ORDER BY c.id DESC", args).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["conteudo"] = json.loads(d["conteudo"])
        out.append(d)
    return out


def atualizar_conteudo_cv(conn, cv_id: int, conteudo: dict) -> None:
    cv = obter_cv(conn, cv_id)
    if cv is None:
        raise KeyError(cv_id)
    if cv["estado"] != "rascunho":
        raise PermissionError("Só rascunhos podem ser editados. Um CV aprovado ou rejeitado é imutável.")
    conn.execute("UPDATE cvs SET conteudo = ? WHERE id = ?", (_json(conteudo), cv_id))
    conn.commit()


def definir_estado_cv(conn, cv_id: int, estado: str) -> None:
    data = agora() if estado == "aprovado" else None
    conn.execute("UPDATE cvs SET estado = ?, data_aprovacao = ? WHERE id = ?", (estado, data, cv_id))
    conn.commit()


def definir_caminhos_cv(conn, cv_id: int, docx: str | None, pdf: str | None) -> None:
    conn.execute("UPDATE cvs SET caminho_docx = ?, caminho_pdf = ? WHERE id = ?", (docx, pdf, cv_id))
    conn.commit()


# ---------------------------------------------------------------- candidaturas

def obter_candidatura(conn, vaga_id: int) -> dict | None:
    return _dict(conn.execute("SELECT * FROM candidaturas WHERE vaga_id = ?", (vaga_id,)).fetchone())


def atualizar_candidatura(conn, vaga_id: int, **campos) -> None:
    permitidos = {"cv_id", "estado", "data_candidatura", "data_entrevista", "contacto", "notas", "data_followup"}
    sets = {k: v for k, v in campos.items() if k in permitidos}
    sets["data_atualizacao"] = agora()
    conn.execute(
        f"UPDATE candidaturas SET {', '.join(f'{k} = ?' for k in sets)} WHERE vaga_id = ?",
        (*sets.values(), vaga_id),
    )
    conn.commit()


def listar_candidaturas(conn) -> list[dict]:
    rows = conn.execute(
        """SELECT c.*, v.cargo, v.empresa, v.localizacao, v.fonte, v.link_canonico, v.data_publicacao,
                  v.data_recolha,
                  a.pontuacao_global, a.preliminar
           FROM candidaturas c JOIN vagas v ON v.id = c.vaga_id
           LEFT JOIN analises a ON a.id = (SELECT MAX(id) FROM analises WHERE vaga_id = v.id)
           ORDER BY c.data_atualizacao DESC"""
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- e-mails não reconhecidos

def registar_nao_reconhecido(conn, gmail_message_id: str, fonte: str, remetente: str, assunto: str,
                             data_email: str, motivo: str) -> bool:
    """Devolve True se for um registo novo."""
    cur = conn.execute(
        """INSERT OR IGNORE INTO emails_nao_reconhecidos
               (gmail_message_id, fonte, remetente, assunto, data_email, motivo, data_registo)
           VALUES (?,?,?,?,?,?,?)""",
        (gmail_message_id, fonte, remetente, assunto, data_email, motivo, agora()),
    )
    conn.commit()
    return cur.rowcount > 0


def listar_nao_reconhecidos(conn, apenas_pendentes: bool = True) -> list[dict]:
    q = "SELECT * FROM emails_nao_reconhecidos"
    if apenas_pendentes:
        q += " WHERE resolvido = 0"
    return [dict(r) for r in conn.execute(q + " ORDER BY id DESC").fetchall()]


def resolver_nao_reconhecido(conn, registo_id: int) -> None:
    conn.execute("UPDATE emails_nao_reconhecidos SET resolvido = 1 WHERE id = ?", (registo_id,))
    conn.commit()


def remover_nao_reconhecido(conn, gmail_message_id: str) -> None:
    conn.execute("DELETE FROM emails_nao_reconhecidos WHERE gmail_message_id = ?", (gmail_message_id,))
    conn.commit()
