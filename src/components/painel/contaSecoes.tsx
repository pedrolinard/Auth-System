"use client";

import { useState } from "react";
import { alterarEmail, excluirMinhaConta, exportarMeusDados } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";

export function SecaoAlterarEmail() {
  const [novoEmail, setNovoEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [carregando, setCarregando] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSucesso(false);
    setCarregando(true);
    try {
      await alterarEmail(novoEmail);
      setSucesso(true);
      setNovoEmail("");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Conta</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Alterar e-mail</h2>

      <form onSubmit={aoEnviar} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="novoEmail" className="text-sm text-zinc-600 dark:text-zinc-400">
            Novo e-mail
          </label>
          <input
            id="novoEmail"
            name="novoEmail"
            type="email"
            required
            value={novoEmail}
            onChange={(e) => setNovoEmail(e.target.value)}
            className="input-field"
          />
        </div>

        {sucesso && (
          <p className="text-sm text-green-600 dark:text-green-400">
            Enviamos um link de confirmação pro novo endereço. O e-mail da conta só muda
            depois que ele for confirmado.
          </p>
        )}
        {erro && <p className="text-sm text-red-600 dark:text-red-400">{erro}</p>}

        <button
          type="submit"
          disabled={carregando || !novoEmail}
          className="btn-primary-sm self-start"
        >
          {carregando ? "Enviando..." : "Pedir troca de e-mail"}
        </button>
      </form>
    </div>
  );
}

export function SecaoDadosDaConta({ aoExcluirConta }: { aoExcluirConta: () => void }) {
  const [exportando, setExportando] = useState(false);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [senha, setSenha] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);

  async function aoExportar() {
    setErroExportar(null);
    setExportando(true);
    try {
      const dados = await exportarMeusDados();
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "meus-dados.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (erroCapturado) {
      setErroExportar(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setExportando(false);
    }
  }

  async function aoConfirmarExclusao(evento: React.FormEvent) {
    evento.preventDefault();
    setErroExcluir(null);
    setExcluindo(true);
    try {
      await excluirMinhaConta(senha);
      aoExcluirConta();
    } catch (erroCapturado) {
      setErroExcluir(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">Conta</span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">Meus dados</h2>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Baixe uma cópia de tudo que guardamos sobre a sua conta (perfil, sessões, dispositivos
          confiáveis e histórico de segurança).
        </p>
        {erroExportar && <p className="text-sm text-red-600 dark:text-red-400">{erroExportar}</p>}
        <button onClick={aoExportar} disabled={exportando} className="btn-secondary self-start">
          {exportando ? "Exportando..." : "Exportar meus dados"}
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-black/[.08] pt-4 dark:border-white/[.1]">
        <h3 className="text-sm font-medium text-red-600 dark:text-red-400">Excluir conta</h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Remove permanentemente sua conta e todos os dados associados. Essa ação não pode ser
          desfeita.
        </p>

        {!confirmandoExclusao && (
          <button
            onClick={() => setConfirmandoExclusao(true)}
            className="self-start rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
          >
            Excluir minha conta
          </button>
        )}

        {confirmandoExclusao && (
          <form onSubmit={aoConfirmarExclusao} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="senhaExcluirConta" className="text-sm text-zinc-600 dark:text-zinc-400">
                Digite sua senha atual para confirmar
              </label>
              <CampoSenha
                id="senhaExcluirConta"
                value={senha}
                onChange={setSenha}
                autoComplete="current-password"
              />
            </div>
            {erroExcluir && <p className="text-sm text-red-600 dark:text-red-400">{erroExcluir}</p>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={excluindo || !senha}
                className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 active:translate-y-0 active:scale-[.97] disabled:pointer-events-none disabled:opacity-50"
              >
                {excluindo ? "Excluindo..." : "Confirmar exclusão permanente"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmandoExclusao(false);
                  setSenha("");
                  setErroExcluir(null);
                }}
                className="btn-secondary-sm"
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
