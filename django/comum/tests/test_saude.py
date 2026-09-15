import pytest
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db


def test_saude_sem_migration_pendente_responde_200_sem_autenticacao():
    # O banco de teste do pytest-django sai com todas as migrations aplicadas.
    resposta = APIClient().get("/api/dominio/saude")

    assert resposta.status_code == 200
    assert resposta.data == {"status": "ok", "banco": "ok", "migrationsPendentes": []}


def test_saude_com_migration_pendente_responde_503_com_os_nomes(monkeypatch):
    # Reproduz o incidente de produção: código com a migration 0002, banco sem.
    monkeypatch.setattr(
        "comum.saude.migrations_pendentes",
        lambda: ["tarefas.0002_projeto_organizacao_id_tarefa_organizacao_id"],
    )
    resposta = APIClient().get("/api/dominio/saude")

    assert resposta.status_code == 503
    assert resposta.data["migrationsPendentes"] == [
        "tarefas.0002_projeto_organizacao_id_tarefa_organizacao_id"
    ]
