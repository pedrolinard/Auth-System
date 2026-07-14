from rest_framework import serializers

from .models import Projeto, Tarefa


class ProjetoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Projeto
        fields = ["id", "nome", "descricao", "usuario_id", "criado_em"]
        read_only_fields = ["id", "usuario_id", "criado_em"]


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
            "usuario_id",
            "criado_em",
            "atualizado_em",
        ]
        read_only_fields = ["id", "usuario_id", "criado_em", "atualizado_em"]

    def validate_projeto(self, projeto):
        usuario_id = self.context["request"].user.id
        if projeto.usuario_id != usuario_id:
            raise serializers.ValidationError(
                "Projeto não pertence ao usuário autenticado."
            )
        return projeto
