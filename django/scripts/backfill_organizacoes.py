"""Fase 3 do multi-tenant: preenche organizacao_id em Projeto/Tarefa que já
existiam antes da coluna existir.

Django não tem acesso direto às tabelas do Next.js (organizacoes/membros —
schema `public` em produção, database `autenticacao` separada em dev local;
ver comum/autenticacao.py sobre esse princípio) — por isso este script
conecta nos DOIS bancos com conexões separadas, em vez de um JOIN cross-schema
dentro do Django. Projeto pega a organização a partir do usuario_id (mesmo
mapeamento que o backfill do lado Next.js criou: primeira organização de que
o usuário é membro). Tarefa pega a organização do PRÓPRIO projeto (join local,
não do usuario_id de novo) — garante consistência mesmo no caso extremo de um
usuario_id de tarefa divergir do dono do projeto.

Uso:
    NEXT_DATABASE_URL="postgresql://.../autenticacao" \
    DATABASE_URL="postgresql://.../autenticacao_dominio" \
    ./.venv/Scripts/python.exe scripts/backfill_organizacoes.py

Em produção (mesma instância Supabase, schemas differentes): NEXT_DATABASE_URL
é a MESMA connection string que o projeto Next.js usa (schema public, sem o
DATABASE_SCHEMA=dominio que o Django aplica pra si mesmo).
"""

import os
import sys

import psycopg


def requerEnv(nome: str) -> str:
    valor = os.environ.get(nome)
    if not valor:
        print(f"Defina a variável de ambiente {nome} antes de rodar este script.", file=sys.stderr)
        sys.exit(1)
    return valor


def principal() -> None:
    next_url = requerEnv("NEXT_DATABASE_URL")
    django_url = requerEnv("DATABASE_URL")

    with psycopg.connect(next_url) as next_conn, next_conn.cursor() as cur:
        # DISTINCT ON + ORDER BY criadoEm: primeira organização de cada
        # usuário — mesmo critério de resolverOrganizacaoAtiva() no lado
        # Next.js (src/lib/sessao.ts), pra bater com a organização que a
        # sessão desse usuário de fato usa.
        cur.execute(
            """
            SELECT DISTINCT ON (m."usuarioId") m."usuarioId", m."organizacaoId"
            FROM membros m
            ORDER BY m."usuarioId", m."criadoEm" ASC
            """
        )
        mapa_usuario_organizacao = dict(cur.fetchall())

    print(f"{len(mapa_usuario_organizacao)} usuário(s) com organização mapeada no Next.js.")

    atualizados_projeto = 0
    sem_mapa: set[str] = set()

    with psycopg.connect(django_url) as django_conn:
        with django_conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT usuario_id FROM tarefas_projeto WHERE organizacao_id IS NULL"
            )
            usuarios_pendentes = [linha[0] for linha in cur.fetchall()]

        with django_conn.cursor() as cur:
            for usuario_id in usuarios_pendentes:
                organizacao_id = mapa_usuario_organizacao.get(usuario_id)
                if not organizacao_id:
                    sem_mapa.add(usuario_id)
                    continue
                cur.execute(
                    """UPDATE tarefas_projeto SET organizacao_id = %s
                       WHERE usuario_id = %s AND organizacao_id IS NULL""",
                    (organizacao_id, usuario_id),
                )
                atualizados_projeto += cur.rowcount

        # Tarefa herda do próprio Projeto (join), não do usuario_id de novo —
        # ver docstring do módulo.
        with django_conn.cursor() as cur:
            cur.execute(
                """UPDATE tarefas_tarefa t
                   SET organizacao_id = p.organizacao_id
                   FROM tarefas_projeto p
                   WHERE t.projeto_id = p.id
                     AND t.organizacao_id IS NULL
                     AND p.organizacao_id IS NOT NULL"""
            )
            atualizados_tarefa = cur.rowcount

        django_conn.commit()

    print(
        f"Backfill concluído: {atualizados_projeto} projeto(s) e "
        f"{atualizados_tarefa} tarefa(s) atualizados."
    )
    if sem_mapa:
        print(
            f"AVISO: {len(sem_mapa)} usuario_id sem organização mapeada (projetos ficaram sem "
            f"organizacao_id, invisíveis até isso ser corrigido): {sorted(sem_mapa)}",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    principal()
