from dataclasses import dataclass

import jwt
from django.conf import settings
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed


@dataclass
class UsuarioRemoto:
    """Identidade derivada do JWT emitido pelo gateway Next.js.

    Não é um Usuario do Django (não há model/migração de usuário aqui) — só
    carrega o suficiente (`id` = claim `sub`) para satisfazer o contrato que
    `IsAuthenticated`/DRF esperam de `request.user`.
    """

    id: str
    email: str | None = None
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
        if not cabecalho.startswith("Bearer "):
            return None

        token = cabecalho[len("Bearer "):]
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

        return (UsuarioRemoto(id=sub, email=payload.get("email")), token)
