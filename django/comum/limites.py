from rest_framework.throttling import SimpleRateThrottle

# Mensagem do 429 — aplicada em comum/excecoes.py. Fica aqui, e o handler
# fica fora, porque importar rest_framework.views neste módulo cria um ciclo:
# APIView lê DEFAULT_THROTTLE_CLASSES na importação e tenta importar esta
# classe antes de ela existir.
MENSAGEM_LIMITE = "Muitas requisições. Aguarde alguns segundos e tente de novo."


class LimitePorUsuario(SimpleRateThrottle):
    """Limite de requisições por usuário autenticado (claim `sub`).

    Antes não havia limite nenhum: com um access token válido dava pra
    martelar a API de projetos/tarefas à vontade. O `UserRateThrottle` do DRF
    não serve aqui porque chaveia por `request.user.pk`, e `UsuarioRemoto` não
    é um model — tem `id`, não `pk` (daria 500 em toda requisição).

    Requisição sem usuário (só /saude, que é pública) não é limitada.

    O contador fica no cache padrão do Django, que é em memória do processo:
    na Vercel, cada instância conta separado. Não é um teto exato — N
    instâncias quentes somam N vezes o limite —, mas corta o abuso de um
    token só sem precisar de Redis nem de tabela nova no banco.
    """

    scope = "usuario"

    def get_cache_key(self, request, view):
        usuario = getattr(request, "user", None)
        if not getattr(usuario, "is_authenticated", False) or not getattr(usuario, "id", None):
            return None
        return self.cache_format % {"scope": self.scope, "ident": usuario.id}
