"use client";

import { useCallback, useEffect, useState } from "react";
import { Webhook as IconeWebhook } from "lucide-react";

import { AvisoErro } from "@/components/ui/AvisoErro";
import { notificar } from "@/components/ui/Toaster";
import {
  atualizarWebhook,
  criarWebhook,
  excluirWebhook,
  listarWebhooks,
  rotacionarSegredoWebhook,
  testarWebhook,
  type EntregaWebhook,
  type Webhook,
} from "@/lib/clienteAplicacoes";
import { EVENTOS_WEBHOOK } from "@/lib/eventosWebhook";

function mensagem(erro: unknown, padrao: string) {
  return erro instanceof Error ? erro.message : padrao;
}

function situacaoEntrega(entrega: EntregaWebhook): { texto: string; classe: string } {
  if (entrega.entregueEm) return { texto: `entregue${entrega.ultimoStatus ? ` (${entrega.ultimoStatus})` : ""}`, classe: "text-[var(--accent)]" };
  if (entrega.desistiuEm) return { texto: "falhou", classe: "text-red-600 dark:text-red-400" };
  return { texto: `nova tentativa (${entrega.tentativas} feita${entrega.tentativas === 1 ? "" : "s"})`, classe: "text-amber-700 dark:text-amber-400" };
}

/**
 * Webhooks de uma aplicação, dentro do cartão dela no painel. O segredo de
 * assinatura aparece uma vez (criação ou rotação). Do resultado das entregas
 * só mostra status e mensagem de erro — nunca o corpo da resposta do destino.
 */
export function WebhooksDaAplicacao({ aplicacaoId }: { aplicacaoId: string }) {
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null);
  const [recebeEventos, setRecebeEventos] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [eventos, setEventos] = useState<string[]>(["usuario.criado"]);
  const [salvando, setSalvando] = useState(false);
  const [segredo, setSegredo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resultado = await listarWebhooks(aplicacaoId);
      setWebhooks(resultado.webhooks);
      setRecebeEventos(resultado.recebeEventos);
    } catch (erroCapturado) {
      setErro(mensagem(erroCapturado, "Não deu pra carregar os webhooks."));
    }
  }, [aplicacaoId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

  async function aoCriar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const { segredo: novo } = await criarWebhook(aplicacaoId, { url: url.trim(), eventos });
      setSegredo(novo);
      setUrl("");
      await carregar();
    } catch (erroCapturado) {
      setErro(mensagem(erroCapturado, "Não deu pra criar o webhook."));
    } finally {
      setSalvando(false);
    }
  }

  async function executar(acao: () => Promise<unknown>, sucesso?: string) {
    try {
      await acao();
      if (sucesso) notificar.sucesso(sucesso);
      await carregar();
    } catch (erroCapturado) {
      notificar.erro(mensagem(erroCapturado, "Não deu pra concluir."));
    }
  }

  return (
    <details className="group rounded-xl border border-black/[.08] p-3 dark:border-white/[.1]">
      <summary className="flex cursor-pointer items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <IconeWebhook className="h-3.5 w-3.5" aria-hidden="true" />
        Webhooks {webhooks ? `(${webhooks.length})` : ""}
      </summary>

      <div className="mt-3 flex flex-col gap-3">
        {!recebeEventos && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Os eventos só começam a ser enviados depois que quem opera o provedor aprovar esta aplicação.
          </p>
        )}

        {segredo && (
          <div className="flex flex-col gap-2 rounded-lg bg-black/[.04] p-3 dark:bg-white/[.05]">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Segredo de assinatura — guarde agora, ele não aparece de novo. Confira o header
              x-auth-gateway-assinatura (HMAC-SHA256 de &quot;t.corpo&quot;) com ele.
            </p>
            <code className="break-all font-mono text-xs text-foreground">{segredo}</code>
            <button type="button" onClick={() => setSegredo(null)} className="btn-secondary-sm self-start">
              Já guardei
            </button>
          </div>
        )}

        {webhooks?.map((webhook) => (
          <div key={webhook.id} className="flex flex-col gap-2 rounded-lg border border-black/[.06] p-3 dark:border-white/[.08]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all font-mono text-xs text-foreground">{webhook.url}</span>
              {!webhook.ativo && (
                <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-red-600 dark:text-red-400">
                  desligado
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{webhook.eventos.join(", ")}</p>
            {webhook.desativadoMotivo && (
              <p className="text-xs text-red-600 dark:text-red-400">{webhook.desativadoMotivo}</p>
            )}
            {webhook.entregas && webhook.entregas.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {webhook.entregas.map((entrega) => {
                  const situacao = situacaoEntrega(entrega);
                  return (
                    <li key={entrega.id} className="flex flex-wrap gap-2 text-zinc-500 dark:text-zinc-400">
                      <span className="tabular-nums">{new Date(entrega.criadoEm).toLocaleString("pt-BR")}</span>
                      <span className="font-mono">{entrega.evento}</span>
                      <span className={situacao.classe}>{situacao.texto}</span>
                      {entrega.ultimoErro && !entrega.entregueEm && <span>{entrega.ultimoErro}</span>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={() =>
                  executar(async () => {
                    const resultado = await testarWebhook(aplicacaoId, webhook.id);
                    if (resultado.entregue) notificar.sucesso(`Teste entregue (${resultado.status}).`);
                    else notificar.erro(`Teste não entregue: ${resultado.erro ?? resultado.status}.`);
                  })
                }
              >
                Enviar teste
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={() =>
                  executar(async () => {
                    const { segredo: novo } = await rotacionarSegredoWebhook(aplicacaoId, webhook.id);
                    setSegredo(novo);
                  })
                }
              >
                Novo segredo
              </button>
              <button
                type="button"
                className="btn-secondary-sm"
                onClick={() => executar(() => atualizarWebhook(aplicacaoId, webhook.id, { ativo: !webhook.ativo }))}
              >
                {webhook.ativo ? "Desligar" : "Religar"}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
                onClick={() => executar(() => excluirWebhook(aplicacaoId, webhook.id), "Webhook excluído.")}
              >
                Excluir
              </button>
            </div>
          </div>
        ))}

        <form onSubmit={aoCriar} className="flex flex-col gap-2">
          <label htmlFor={`webhook-url-${aplicacaoId}`} className="text-xs text-zinc-600 dark:text-zinc-400">
            Novo webhook (https)
          </label>
          <input
            id={`webhook-url-${aplicacaoId}`}
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.cliente.com/webhooks/auth"
            className="input-field font-mono text-xs"
          />
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
            <legend className="sr-only">Eventos</legend>
            {EVENTOS_WEBHOOK.map((nome) => (
              <label key={nome} className="flex items-center gap-1.5 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={eventos.includes(nome)}
                  onChange={(e) =>
                    setEventos((atual) => (e.target.checked ? [...atual, nome] : atual.filter((x) => x !== nome)))
                  }
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
                {nome}
              </label>
            ))}
          </fieldset>
          <AvisoErro>{erro}</AvisoErro>
          <button type="submit" disabled={salvando || eventos.length === 0} className="btn-secondary-sm self-start">
            {salvando ? "Criando..." : "Adicionar webhook"}
          </button>
        </form>
      </div>
    </details>
  );
}
