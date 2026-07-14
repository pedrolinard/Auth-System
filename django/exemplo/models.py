from django.db import models


class Item(models.Model):
    """Model de exemplo só para provar que o claim `sub` do JWT vira
    identidade utilizável do lado Django (filtragem por usuário)."""

    titulo = models.CharField(max_length=200)
    # sub do JWT (id do Usuario no Prisma/Next.js, um cuid) — string opaca,
    # sem FK real: Django não tem tabela de usuários própria.
    usuario_id = models.CharField(max_length=40)
    criado_em = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.titulo
