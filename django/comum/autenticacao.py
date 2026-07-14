from dataclasses import dataclass

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
    is_authenticated: bool = True
    is_anonymous: bool = False


class AutenticacaoJWT(BaseAuthentication):
    """Valida o access token (RS256) assinado pelo gateway Next.js.

    O algoritmo é fixado explicitamente em `algorithms=["RS256"]` para evitar
    ataques de confusão de algoritmo (ex.: um token forjado com HS256 usando a
    chave pública RS256 como segredo simétrico).
    """

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
                settings.JWT_ACCESS_PUBLIC_KEY,
                algorithms=["RS256"],
            )
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed("Token expirado.")
        except jwt.InvalidTokenError:
            raise AuthenticationFailed("Token inválido.")

        sub = payload.get("sub")
        if not sub:
            raise AuthenticationFailed("Token sem claim 'sub'.")

        return (
            UsuarioRemoto(
                id=sub,
                email=payload.get("email"),
                papel=payload.get("papel", "usuario"),
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
        return cabecalho == valor_cookie
