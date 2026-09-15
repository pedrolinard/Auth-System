"""Portão de migrations do deploy do Django. NÃO aplica nada — só verifica.

O lado Next.js tem o mesmo portão dentro do build (scripts/checar-migrations.mjs).
O Django não tinha nenhum, e o deploy é manual (`vercel deploy --prod`): o
código do multi-tenant subiu pra produção sem a migration 0002 aplicada, e a
tela de projetos passou a responder 500 em todo acesso autenticado.

Rode ANTES de todo deploy, com as variáveis do banco de destino:

    DATABASE_URL=... DATABASE_SCHEMA=dominio python scripts/checar_migrations.py && vercel deploy --prod

Sai com código 1 (e a lista) se houver migration pendente, ou se o banco não
responder. A ordem numa mudança de schema continua: migration -> backfill -> código.
"""

import os
import sys
from pathlib import Path

import django

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")


def principal() -> int:
    # setup() primeiro: é o settings.py que carrega o .env local (fora da
    # Vercel), e só depois dele o DATABASE_URL de dev existe no ambiente.
    django.setup()
    if not os.environ.get("DATABASE_URL"):
        # Sem ela o settings cai no SQLite local — checar isso diria "em dia"
        # sobre um banco que não é o de destino.
        print("[migrations] DATABASE_URL não definida — sem banco de destino não há o que checar.", file=sys.stderr)
        return 1

    from comum.saude import migrations_pendentes

    try:
        pendentes = migrations_pendentes()
    except Exception as erro:  # banco fora do ar, credencial errada, schema inexistente
        print(f"[migrations] DEPLOY INTERROMPIDO — não foi possível ler o banco: {erro}", file=sys.stderr)
        return 1

    if pendentes:
        print("[migrations] DEPLOY INTERROMPIDO — migrations não aplicadas neste banco:", file=sys.stderr)
        for nome in pendentes:
            print(f"  - {nome}", file=sys.stderr)
        print("\nAplique primeiro:  python manage.py migrate   (com o mesmo DATABASE_URL/DATABASE_SCHEMA)", file=sys.stderr)
        return 1

    print("[migrations] Banco em dia.")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
