import pytest
from rest_framework.test import APIClient

from comum.autenticacao import UsuarioRemoto
from tarefas.models import Projeto, Tarefa

pytestmark = pytest.mark.django_db


def cliente_autenticado(usuario_id):
    client = APIClient()
    client.force_authenticate(user=UsuarioRemoto(id=usuario_id))
    return client


def test_criar_e_listar_projeto():
    client = cliente_autenticado("usuario-a")

    resposta = client.post("/api/dominio/projetos", {"nome": "Casa nova"})
    assert resposta.status_code == 201
    assert resposta.data["usuario_id"] == "usuario-a"

    resposta = client.get("/api/dominio/projetos")
    assert resposta.status_code == 200
    assert len(resposta.data) == 1
    assert resposta.data[0]["nome"] == "Casa nova"


def test_usuario_so_ve_os_proprios_projetos():
    Projeto.objects.create(nome="Projeto A", usuario_id="usuario-a")
    Projeto.objects.create(nome="Projeto B", usuario_id="usuario-b")

    client = cliente_autenticado("usuario-a")
    resposta = client.get("/api/dominio/projetos")

    assert resposta.status_code == 200
    assert len(resposta.data) == 1
    assert resposta.data[0]["nome"] == "Projeto A"


def test_criar_tarefa_vinculada_a_projeto_proprio():
    projeto = Projeto.objects.create(nome="Projeto A", usuario_id="usuario-a")
    client = cliente_autenticado("usuario-a")

    resposta = client.post(
        "/api/dominio/tarefas",
        {"titulo": "Comprar tinta", "projeto": projeto.id},
    )

    assert resposta.status_code == 201
    assert resposta.data["usuario_id"] == "usuario-a"
    assert resposta.data["status"] == "pendente"


def test_rejeita_criar_tarefa_em_projeto_de_outro_usuario():
    projeto_de_b = Projeto.objects.create(nome="Projeto B", usuario_id="usuario-b")
    client = cliente_autenticado("usuario-a")

    resposta = client.post(
        "/api/dominio/tarefas",
        {"titulo": "Tarefa intrusa", "projeto": projeto_de_b.id},
    )

    assert resposta.status_code == 400
    assert not Tarefa.objects.filter(titulo="Tarefa intrusa").exists()


def test_atualizar_status_da_tarefa():
    projeto = Projeto.objects.create(nome="Projeto A", usuario_id="usuario-a")
    tarefa = Tarefa.objects.create(
        titulo="Pintar parede", projeto=projeto, usuario_id="usuario-a"
    )
    client = cliente_autenticado("usuario-a")

    resposta = client.patch(
        f"/api/dominio/tarefas/{tarefa.id}", {"status": "concluida"}
    )

    assert resposta.status_code == 200
    tarefa.refresh_from_db()
    assert tarefa.status == "concluida"


def test_usuario_nao_acessa_tarefa_de_outro():
    projeto = Projeto.objects.create(nome="Projeto B", usuario_id="usuario-b")
    tarefa = Tarefa.objects.create(
        titulo="Tarefa de B", projeto=projeto, usuario_id="usuario-b"
    )
    client = cliente_autenticado("usuario-a")

    resposta = client.get(f"/api/dominio/tarefas/{tarefa.id}")
    assert resposta.status_code == 404


def test_deletar_tarefa_e_projeto():
    projeto = Projeto.objects.create(nome="Projeto A", usuario_id="usuario-a")
    tarefa = Tarefa.objects.create(
        titulo="Tarefa", projeto=projeto, usuario_id="usuario-a"
    )
    client = cliente_autenticado("usuario-a")

    resposta = client.delete(f"/api/dominio/tarefas/{tarefa.id}")
    assert resposta.status_code == 204
    assert not Tarefa.objects.filter(id=tarefa.id).exists()

    resposta = client.delete(f"/api/dominio/projetos/{projeto.id}")
    assert resposta.status_code == 204
    assert not Projeto.objects.filter(id=projeto.id).exists()
