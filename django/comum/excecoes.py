from rest_framework.exceptions import Throttled
from rest_framework.views import exception_handler

from comum.limites import MENSAGEM_LIMITE


def tratar_excecao(exc, context):
    """Handler padrão do DRF, só com a mensagem do 429 em português.

    O painel mostra o `detail` da resposta direto na tela
    (src/lib/clienteDominio.ts), e o serviço roda com LANGUAGE_CODE en-us —
    mudar o idioma global traduziria todas as outras mensagens de uma vez. O
    header Retry-After continua saindo (vem de `exc.wait`).
    """
    if isinstance(exc, Throttled):
        exc.detail = MENSAGEM_LIMITE
    return exception_handler(exc, context)
