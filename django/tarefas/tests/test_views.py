import pytest
from rest_framework.test import APIClient

from comum.autenticacao import UsuarioRemoto
from tarefas.models import Projeto, Tarefa

pytestmark = pytest.mark.django_db


# organizacao_id default ("org-a") cobre a maioria dos testes — o isolamento
# que importa hoje é entre ORGANIZAÇÕES, não entre usuários da mesma
# organização (que devem ver os mesmos projetos: é o ponto de ter uma
# organização compartilhada).
def cliente_autenticado(usuario_id, organizacao_id="org-a"):
    client = APIClient()
    client.force_authenticate(
        user=UsuarioRemoto(id=usuario_id, organizacao_id=organizacao_id)
    )
    return client


def test_requisicao_sem_credenciais_retorna_401_nao_403():
    # Regressão: sem authenticate_header() em AutenticacaoJWT, o DRF rebaixa
    # 401 para 403 em credenciais ausentes/inválidas — e o cliente Next.js
    # (clienteDominio.ts) só tenta renovar o token em respostas 401, então um
    # 403 aqui deixa a tela de projetos travada para sempre num usuário com
    # o access token vencido/ainda não carregado (aba nova, por exemplo).
    client = APIClient()
    resposta = client.get("/api/dominio/projetos")

    assert resposta.status_code == 401
    assert resposta["WWW-Authenticate"] == "Bearer"


def test_criar_e_listar_projeto():
    client = cliente_autenticado("usuario-a")

    resposta = client.post("/api/dominio/projetos", {"nome": "Casa nova"})
    assert resposta.status_code == 201
    assert resposta.data["usuario_id"] == "usuario-a"
    assert resposta.data["organizacao_id"] == "org-a"

    resposta = client.get("/api/dominio/projetos")
    assert resposta.status_code == 200
    assert len(resposta.data) == 1
    assert resposta.data[0]["nome"] == "Casa nova"


def test_organizacoes_diferentes_nao_veem_projetos_uma_da_outra():
    Projeto.objects.create(nome="Projeto A", organizacao_id="org-a", usuario_id="usuario-a")
    Projeto.objects.create(nome="Projeto B", organizacao_id="org-b", usuario_id="usuario-b")

    client = cliente_autenticado("usuario-a", organizacao_id="org-a")
    resposta = client.get("/api/dominio/projetos")

    assert resposta.status_code == 200
    assert len(resposta.data) == 1
    assert resposta.data[0]["nome"] == "Projeto A"


def test_dois_membros_da_mesma_organizacao_veem_o_mesmo_projeto():
    # Diferente do isolamento antigo (por usuario_id): dois membros da MESMA
    # organização colaboram nos mesmos dados — não é cada um só vendo o que
    # criou.
    projeto = Projeto.objects.create(
        nome="Projeto compartilhado", organizacao_id="org-a", usuario_id="usuario-a"
    )

    client_criador = cliente_autenticado("usuario-a", organizacao_id="org-a")
    client_outro_membro = cliente_autenticado("usuario-b", organizacao_id="org-a")

    for client in (client_criador, client_outro_membro):
        resposta = client.get("/api/dominio/projetos")
        assert resposta.status_code == 200
        assert len(resposta.data) == 1
        assert resposta.data[0]["id"] == projeto.id


def test_sessao_sem_organizacao_nao_ve_nem_cria_projeto():
    # Token emitido antes do claim organizacaoId existir (ver comentário em
    # comum/autenticacao.py) — autentica normalmente, mas não enxerga nem
    # consegue criar nada de organização, em vez de vazar/quebrar.
    Projeto.objects.create(nome="Projeto A", organizacao_id="org-a", usuario_id="usuario-a")
    client = cliente_autenticado("usuario-sem-org", organizacao_id=None)

    resposta = client.get("/api/dominio/projetos")
    assert resposta.status_code == 200
    assert resposta.data == []

    resposta = client.post("/api/dominio/projetos", {"nome": "Não deveria criar"})
    assert resposta.status_code == 403
    assert not Projeto.objects.filter(nome="Não deveria criar").exists()


def test_criar_tarefa_vinculada_a_projeto_da_mesma_organizacao():
    projeto = Projeto.objects.create(nome="Projeto A", organizacao_id="org-a", usuario_id="usuario-a")
    client = cliente_autenticado("usuario-a")

    resposta = client.post(
        "/api/dominio/tarefas",
        {"titulo": "Comprar tinta", "projeto": projeto.id},
    )

    assert resposta.status_code == 201
    assert resposta.data["usuario_id"] == "usuario-a"
    assert resposta.data["organizacao_id"] == "org-a"
    assert resposta.data["status"] == "pendente"


def test_rejeita_criar_tarefa_em_projeto_de_outra_organizacao():
    projeto_de_outra_org = Projeto.objects.create(
        nome="Projeto B", organizacao_id="org-b", usuario_id="usuario-b"
    )
    client = cliente_autenticado("usuario-a", organizacao_id="org-a")

    resposta = client.post(
        "/api/dominio/tarefas",
        {"titulo": "Tarefa intrusa", "projeto": projeto_de_outra_org.id},
    )

    assert resposta.status_code == 400
    assert not Tarefa.objects.filter(titulo="Tarefa intrusa").exists()


def test_atualizar_status_da_tarefa():
    projeto = Projeto.objects.create(nome="Projeto A", organizacao_id="org-a", usuario_id="usuario-a")
    tarefa = Tarefa.objects.create(
        titulo="Pintar parede", projeto=projeto, organizacao_id="org-a", usuario_id="usuario-a"
    )
    client = cliente_autenticado("usuario-a")

    resposta = client.patch(
        f"/api/dominio/tarefas/{tarefa.id}", {"status": "concluida"}
    )

    assert resposta.status_code == 200
    tarefa.refresh_from_db()
    assert tarefa.status == "concluida"


def test_usuario_de_outra_organizacao_nao_acessa_tarefa():
    projeto = Projeto.objects.create(nome="Projeto B", organizacao_id="org-b", usuario_id="usuario-b")
    tarefa = Tarefa.objects.create(
        titulo="Tarefa de outra org", projeto=projeto, organizacao_id="org-b", usuario_id="usuario-b"
    )
    client = cliente_autenticado("usuario-a", organizacao_id="org-a")

    resposta = client.get(f"/api/dominio/tarefas/{tarefa.id}")
    assert resposta.status_code == 404


def test_deletar_tarefa_e_projeto():
    projeto = Projeto.objects.create(nome="Projeto A", organizacao_id="org-a", usuario_id="usuario-a")
    tarefa = Tarefa.objects.create(
        titulo="Tarefa", projeto=projeto, organizacao_id="org-a", usuario_id="usuario-a"
    )
    client = cliente_autenticado("usuario-a")

    resposta = client.delete(f"/api/dominio/tarefas/{tarefa.id}")
    assert resposta.status_code == 204
    assert not Tarefa.objects.filter(id=tarefa.id).exists()

    resposta = client.delete(f"/api/dominio/projetos/{projeto.id}")
    assert resposta.status_code == 204
    assert not Projeto.objects.filter(id=projeto.id).exists()


# CSRF (double-submit cookie, comum/autenticacao.py::ProtegidoContraCsrf) —
# relevante desde que o access token virou cookie httpOnly: sem essa
# proteção, um site atacante conseguiria forjar mutações aqui só com o
# cookie ambiente do navegador.


def test_post_sem_cookie_csrf_e_permitido():
    # Sem cookie csrfToken não há sessão baseada em cookie em jogo (ex.:
    # cliente via Bearer/curl) — a checagem é pulada.
    client = cliente_autenticado("usuario-a")
    resposta = client.post("/api/dominio/projetos", {"nome": "Sem CSRF"})
    assert resposta.status_code == 201


def test_post_com_cookie_csrf_sem_header_e_bloqueado():
    client = cliente_autenticado("usuario-a")
    client.cookies["csrfToken"] = "valor-secreto"

    resposta = client.post("/api/dominio/projetos", {"nome": "Bloqueado"})

    assert resposta.status_code == 403
    assert not Projeto.objects.filter(nome="Bloqueado").exists()


def test_post_com_cookie_csrf_e_header_divergente_e_bloqueado():
    client = cliente_autenticado("usuario-a")
    client.cookies["csrfToken"] = "valor-secreto"

    resposta = client.post(
        "/api/dominio/projetos",
        {"nome": "Bloqueado"},
        HTTP_X_CSRF_TOKEN="valor-errado",
    )

    assert resposta.status_code == 403


def test_post_com_cookie_csrf_e_header_correto_e_permitido():
    client = cliente_autenticado("usuario-a")
    client.cookies["csrfToken"] = "valor-secreto"

    resposta = client.post(
        "/api/dominio/projetos",
        {"nome": "Permitido"},
        HTTP_X_CSRF_TOKEN="valor-secreto",
    )

    assert resposta.status_code == 201


def test_get_nunca_e_bloqueado_por_csrf():
    client = cliente_autenticado("usuario-a")
    client.cookies["csrfToken"] = "valor-secreto"

    resposta = client.get("/api/dominio/projetos")
    assert resposta.status_code == 200
