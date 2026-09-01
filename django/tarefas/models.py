from django.db import models


class Projeto(models.Model):
    nome = models.CharField(max_length=200)
    descricao = models.TextField(blank=True, default="")
    # organizacaoId do JWT (id da Organizacao no Prisma/Next.js) — é o que
    # isola os dados entre organizações diferentes (ver get_queryset em
    # views.py); mesma string opaca sem FK real que usuario_id já era, pelo
    # mesmo motivo (Django não tem as tabelas do Next.js). Nullable só pra
    # linhas anteriores ao multi-tenant, ANTES do backfill (ver
    # scripts/backfill_organizacoes.py) rodar — depois disso, toda linha
    # tem uma; get_queryset trata None como "sem organização" (vazio), não
    # deixa vazar pra fora do escopo por engano.
    organizacao_id = models.CharField(max_length=40, db_index=True, null=True, blank=True)
    # Quem criou — não é mais o limite de isolamento (qualquer membro da
    # organização vê o projeto todo, não só quem criou), só metadado.
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
    # Redundante com projeto.organizacao_id em teoria (uma tarefa sempre
    # pertence à mesma organização do seu projeto — TarefaSerializer.
    # validate_projeto garante isso na escrita), mas mantido como coluna
    # própria pelo mesmo motivo de usuario_id sempre ter sido: filtrar
    # get_queryset direto na Tarefa sem precisar de join a cada leitura.
    organizacao_id = models.CharField(max_length=40, db_index=True, null=True, blank=True)
    usuario_id = models.CharField(max_length=40)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.titulo
