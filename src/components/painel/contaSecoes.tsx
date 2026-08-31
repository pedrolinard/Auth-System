"use client";

import { useState } from "react";
import { AtSign, Download, TriangleAlert } from "lucide-react";
import { alterarEmail, excluirMinhaConta, exportarMeusDados } from "@/lib/clienteAuth";
import { CampoSenha } from "@/components/CampoSenha";
import { CabecalhoSecao } from "@/components/ui/CabecalhoSecao";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { notificar } from "@/components/ui/Toaster";

export function SecaoAlterarEmail() {
  const [novoEmail, setNovoEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function aoEnviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      await alterarEmail(novoEmail, senha);
      notificar.sucesso(
        `Enviamos um link de confirmação para ${novoEmail}. O e-mail só muda depois que você clicar nele.`,
      );
      setNovoEmail("");
      setSenha("");
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="card-surface flex w-full max-w-lg flex-col gap-4 p-8">
      <CabecalhoSecao
        icone={AtSign}
        eyebrow="Conta"
        titulo="Alterar e-mail"
        descricao="Mandamos um link pro novo endereço e avisamos o atual. A troca só vale depois da confirmação."
      />

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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="senhaAlterarEmail" className="text-sm text-zinc-600 dark:text-zinc-400">
            Senha atual
          </label>
          <CampoSenha
            id="senhaAlterarEmail"
            value={senha}
            onChange={setSenha}
            autoComplete="current-password"
          />
        </div>

        <AvisoErro>{erro}</AvisoErro>

        <button
          type="submit"
          disabled={carregando || !novoEmail || !senha}
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
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [senha, setSenha] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState<string | null>(null);

  async function aoExportar() {
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
      notificar.sucesso("Baixamos o arquivo com seus dados.");
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra exportar agora.",
      );
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
      <CabecalhoSecao
        icone={Download}
        eyebrow="Conta"
        titulo="Meus dados"
        descricao="Baixe tudo que guardamos sobre você, ou apague a conta de vez."
      />

      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          O arquivo traz perfil, sessões, dispositivos confiáveis e histórico de segurança,
          em JSON.
        </p>
        <button onClick={aoExportar} disabled={exportando} className="btn-secondary gap-1.5 self-start">
          <Download className="h-4 w-4" aria-hidden="true" />
          {exportando ? "Exportando..." : "Exportar meus dados"}
        </button>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-red-500/20 bg-red-500/[.04] p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
          <TriangleAlert className="h-4 w-4" aria-hidden="true" />
          Excluir conta
        </h3>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Apaga sua conta e todos os dados ligados a ela. Não tem como desfazer.
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
          <form onSubmit={aoConfirmarExclusao} className="mt-1 flex flex-col gap-3">
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
            <AvisoErro>{erroExcluir}</AvisoErro>
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
