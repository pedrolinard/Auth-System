from django.db import models


class Projeto(models.Model):
    nome = models.CharField(max_length=200)
    descricao = models.TextField(blank=True, default="")
    # sub do JWT (id do Usuario no Prisma/Next.js, um cuid) — string opaca,
    # sem FK real: Django não tem tabela de usuários própria.
    usuario_id = models.CharField(max_length=40)
    criado_em = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.nome


class Tarefa(models.Model):
    class Status(models.TextChoices):
        PENDENTE = "pendente", "Pendente"
        EM_ANDAMENTO = "em_andamento", "Em andamento"
        CONCLUIDA = "concluida", "Concluída"

    titulo = models.CharField(max_length=200)
    descricao = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDENTE
    )
    prazo = models.DateField(null=True, blank=True)
    projeto = models.ForeignKey(
        Projeto, on_delete=models.CASCADE, related_name="tarefas"
    )
    usuario_id = models.CharField(max_length=40)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.titulo
