from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


def migrations_pendentes() -> list[str]:
    """Migrations do código que ainda não foram aplicadas no banco.

    Mesmo cálculo do `manage.py migrate --check`: o plano do executor até os
    nós-folha do grafo. Vazio = banco no schema que este código espera.
    """
    conexao = connections[DEFAULT_DB_ALIAS]
    executor = MigrationExecutor(conexao)
    plano = executor.migration_plan(executor.loader.graph.leaf_nodes())
    return [f"{migracao.app_label}.{migracao.name}" for migracao, _ in plano]


@api_view(["GET"])
@authentication_classes([])
@permission_classes([AllowAny])
def saude(request):
    """Saúde do serviço de domínio, pro monitor externo.

    Responde 503 com migration pendente: foi exatamente assim que a tela de
    projetos ficou quebrada em produção — o código do multi-tenant subiu, a
    migration 0002 nunca foi aplicada no banco, e todo acesso autenticado dava
    500 sem que nada apontasse o motivo. Público e sem detalhe além dos nomes
    das migrations (que estão no repositório de qualquer forma).
    """
    try:
        pendentes = migrations_pendentes()
    except Exception:
        return Response({"status": "degradado", "banco": "falha"}, status=503)

    if pendentes:
        return Response(
            {"status": "degradado", "banco": "ok", "migrationsPendentes": pendentes},
            status=503,
        )
    return Response({"status": "ok", "banco": "ok", "migrationsPendentes": []})
