import jwt
from django.conf import settings
from django.db import transaction
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from comum.autenticacao import AUDIENCIA_SERVICO_DOMINIO, AutenticacaoJWT

from .models import Projeto, Tarefa

MAX_ORGANIZACOES = 100


def _payload_servico(request):
    """Valida o token de SERVIÇO do gateway (src/lib/token.ts:
    gerarTokenServicoDominio). Devolve o payload ou None.

    Mesma chave RS256 e emissor do access token, resolvida pelo mesmo JWKS —
    a diferença que importa é a audiência fixa: um access token de usuário
    (aud = id da aplicação) não passa aqui, e AutenticacaoJWT recusa este
    token nas rotas de usuário.
    """
    cabecalho = request.headers.get("Authorization", "")
    if not cabecalho.startswith("Bearer "):
        return None
    token = cabecalho[len("Bearer "):]
    try:
        chave = AutenticacaoJWT()._chave_de_verificacao(token)
        return jwt.decode(
            token,
            chave,
            algorithms=["RS256"],
            issuer=settings.JWT_ACCESS_ISSUER,
            audience=AUDIENCIA_SERVICO_DOMINIO,
            options={"require": ["exp", "iss", "aud"]},
        )
    except Exception:
        return None


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def excluir_organizacoes(request):
    """Apaga projetos e tarefas das organizações excluídas no gateway.

    Chamado pelo gateway quando uma conta é excluída (e de novo pelo job de
    limpeza, se falhou) — sem isso, os dados ficavam órfãos neste schema, que
    não tem FK com as organizações do outro serviço (LGPD). Idempotente:
    repetir o pedido só não encontra nada pra apagar.

    As organizações vêm do TOKEN, não do corpo: o corpo é ignorado, então
    ninguém amplia o escopo de um token capturado.
    """
    payload = _payload_servico(request)
    if not payload or payload.get("acao") != "excluir_organizacoes":
        return Response({"detail": "Token de serviço inválido."}, status=401)

    organizacoes = payload.get("organizacoes")
    if (
        not isinstance(organizacoes, list)
        or not organizacoes
        or len(organizacoes) > MAX_ORGANIZACOES
        or not all(isinstance(o, str) and 0 < len(o) <= 40 for o in organizacoes)
    ):
        return Response({"detail": "Lista de organizações inválida."}, status=400)

    with transaction.atomic():
        tarefas, _ = Tarefa.objects.filter(organizacao_id__in=organizacoes).delete()
        projetos, _ = Projeto.objects.filter(organizacao_id__in=organizacoes).delete()

    return Response({"projetosExcluidos": projetos, "tarefasExcluidas": tarefas})
