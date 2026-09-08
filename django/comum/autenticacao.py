import hmac
from dataclasses import dataclass
from functools import lru_cache

import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import SAFE_METHODS, BasePermission


@dataclass
class UsuarioRemoto:
    """Identidade derivada do JWT emitido pelo gateway Next.js.

    Não é um Usuario do Django (não há model/migração de usuário aqui) — só
    carrega o suficiente (`id` = claim `sub`) para satisfazer o contrato que
    `IsAuthenticated`/DRF esperam de `request.user`.
    """

    id: str
    email: str | None = None
    papel: str = "usuario"
    # Organização ATIVA da sessão (claim organizacaoId) — é o que isola os
    # dados de tarefas/projetos entre organizações diferentes (ver
    # tarefas/views.py). Multi-tenant: o Django nunca consulta a tabela de
    # organizações/membros do Next.js, só confia neste claim.
    organizacao_id: str | None = None
    papel_organizacao: str | None = None
    # Aplicação cliente dona desta identidade (claim `aplicacaoId`, também
    # carimbado como `aud`). Uma organização já pertence a exatamente uma
    # aplicação, então o isolamento de projetos/tarefas por organizacao_id
    # continua sendo suficiente — este campo existe para as checagens que
    # querem afirmar o escopo explicitamente, sem inferir pela organização.
    aplicacao_id: str | None = None
    is_authenticated: bool = True
    is_anonymous: bool = False


@lru_cache(maxsize=1)
def _cliente_jwks() -> jwt.PyJWKClient:
    """Cliente JWKS com cache, criado uma vez por processo.

    `cache_keys=True` guarda as chaves já buscadas em memória, então o custo
    de rede é pago no primeiro token de cada `kid` — não a cada requisição.
    `lifespan` limita por quanto tempo uma chave fica em cache: é o atraso
    máximo entre o gateway aposentar uma chave e este serviço parar de aceitá-la.
    """
    return jwt.PyJWKClient(settings.JWT_JWKS_URL, cache_keys=True, lifespan=300)


class AutenticacaoJWT(BaseAuthentication):
    """Valida o access token (RS256) assinado pelo gateway Next.js.

    O algoritmo é fixado explicitamente em `algorithms=["RS256"]` para evitar
    ataques de confusão de algoritmo (ex.: um token forjado com HS256 usando a
    chave pública RS256 como segredo simétrico). Resolver a chave pelo `kid`
    não afrouxa isso: o `kid` escolhe QUAL chave, nunca COMO ela é usada.
    """

    def _chave_de_verificacao(self, token: str):
        if not settings.JWT_JWKS_URL:
            return settings.JWT_ACCESS_PUBLIC_KEY
        try:
            return _cliente_jwks().get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientError:
            # JWKS fora do ar ou `kid` desconhecido. Cai na chave estática
            # quando ela existe (janela de migração e rollback); sem ela, é
            # token inválido mesmo — melhor recusar do que aceitar sem
            # verificar.
            if settings.JWT_ACCESS_PUBLIC_KEY:
                return settings.JWT_ACCESS_PUBLIC_KEY
            raise AuthenticationFailed("Não foi possível obter a chave de verificação.")

    def authenticate(self, request):
        cabecalho = request.headers.get("Authorization", "")
        if cabecalho.startswith("Bearer "):
            token = cabecalho[len("Bearer "):]
        else:
            # Desde a migração do access token do Next.js para cookie
            # httpOnly, o rewrite de /api/dominio/* em next.config.ts repassa
            # cookies transparentemente — o navegador nunca precisa montar o
            # header Authorization manualmente.
            token = request.COOKIES.get("tokenAcesso")

        if not token:
            return None

        try:
            payload = jwt.decode(
                token,
                self._chave_de_verificacao(token),
                algorithms=["RS256"],
                issuer=settings.JWT_ACCESS_ISSUER,
                # `sub` fica de fora do require de propósito — a checagem
                # explícita logo abaixo dá uma mensagem mais específica.
                # `organizacaoId` também fica de fora: access tokens de até
                # 15 min emitidos ANTES do claim existir ainda circulam por
                # uma janela curta depois do deploy do multi-tenant — melhor
                # esse token continuar autenticando (só sem acesso a rotas de
                # organização, ver tarefas/views.py) do que virar 401 geral
                # até expirar sozinho.
                #
                # `verify_aud` desligado de propósito: o `aud` do token é a
                # APLICAÇÃO cliente, e este serviço atende todas elas — não
                # existe uma audiência única para comparar. Um consumidor que
                # serve uma aplicação só (o backend de um cliente) faz o
                # oposto: passa `audience=<clientId dele>` e ganha de graça a
                # recusa de token de outra aplicação. O claim é lido logo
                # abaixo e vira `aplicacao_id` na identidade.
                options={"require": ["exp", "iss"], "verify_aud": False},
            )
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("Token expirado.")
        except jwt.InvalidTokenError:
            # Cobre assinatura, iss errado, claims obrigatórios ausentes.
            raise AuthenticationFailed("Token inválido.")

        sub = payload.get("sub")
        if not sub:
            raise AuthenticationFailed("Token sem claim 'sub'.")

        return (
            UsuarioRemoto(
                id=sub,
                email=payload.get("email"),
                papel=payload.get("papel", "usuario"),
                organizacao_id=payload.get("organizacaoId"),
                papel_organizacao=payload.get("papelOrganizacao"),
                aplicacao_id=payload.get("aplicacaoId") or payload.get("aud"),
            ),
            token,
        )

    def authenticate_header(self, request):
        # Sem isso, o DRF rebaixa credenciais ausentes/inválidas de 401 para
        # 403 (por não ter um header WWW-Authenticate para oferecer). O
        # cliente Next.js (clienteDominio.ts) só tenta renovar o token em
        # respostas 401, então esse header é o que faz o fluxo de renovação
        # automática funcionar de verdade.
        return "Bearer"


class ProtegidoContraCsrf(BasePermission):
    """Double-submit cookie: mesma regra do lado Next.js (src/lib/csrf.ts).

    Desde que o access token virou cookie httpOnly, mutações em
    /api/dominio/* passam a ser alcançáveis só com o cookie ambiente — sem
    isso, um site atacante em outra origem poderia forjar um POST/DELETE
    aqui. Métodos seguros (GET/HEAD/OPTIONS) não são checados. Se não existe
    cookie csrfToken na requisição (cliente sem navegador, ex. Bearer via
    curl/testes), não há sessão baseada em cookie e a checagem é pulada.
    """

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return True

        valor_cookie = request.COOKIES.get("csrfToken")
        if not valor_cookie:
            return True

        cabecalho = request.headers.get("X-CSRF-Token")
        if not cabecalho:
            return False

        # Comparação em tempo constante — mesma escolha do lado Next.js
        # (src/lib/csrf.ts usa timingSafeEqual). compare_digest com str exige
        # os dois lados ASCII; o header é controlado pelo cliente e pode vir
        # com não-ASCII, então o TypeError vira 403, não 500.
        try:
            return hmac.compare_digest(cabecalho, valor_cookie)
        except TypeError:
            return False
