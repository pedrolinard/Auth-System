from rest_framework import serializers

from .models import Projeto, Tarefa


class ProjetoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Projeto
        fields = ["id", "nome", "descricao", "organizacao_id", "usuario_id", "criado_em"]
        read_only_fields = ["id", "organizacao_id", "usuario_id", "criado_em"]


class TarefaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tarefa
        fields = [
            "id",
            "titulo",
            "descricao",
            "status",
            "prazo",
            "projeto",
            "organizacao_id",
            "usuario_id",
            "criado_em",
            "atualizado_em",
        ]
        read_only_fields = ["id", "organizacao_id", "usuario_id", "criado_em", "atualizado_em"]

    def validate_projeto(self, projeto):
        # Isolamento por ORGANIZAÇÃO, não mais por usuário individual —
        # qualquer membro pode criar tarefa num projeto da própria
        # organização, não só quem criou o projeto.
        organizacao_id = self.context["request"].user.organizacao_id
        if projeto.organizacao_id != organizacao_id:
            raise serializers.ValidationError(
                "Projeto não pertence à organização atual."
            )
        return projeto
