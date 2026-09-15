"use client";

import { useCallback, useEffect, useState } from "react";
import { AppWindow, Copy, KeyRound, Plus } from "lucide-react";
import {
  atualizarAplicacao,
  criarAplicacao,
  listarAplicacoes,
  rotacionarSegredoAplicacao,
  type Aplicacao,
  type DadosAplicacao,
} from "@/lib/clienteAplicacoes";
import { obterUsuarioAtual } from "@/lib/clienteAuth";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { CabecalhoSecao } from "@/components/ui/CabecalhoSecao";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { SkeletonLista } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

// Uma origem por linha no formulário; o servidor valida o formato de cada uma.
function origensDoTexto(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function mensagem(erro: unknown, padrao: string) {
  return erro instanceof Error ? erro.message : padrao;
}

function FormularioAplicacao({
  inicial,
  rotuloEnviar,
  aoEnviar,
  aoCancelar,
  permitirRemetente,
}: {
  inicial?: Aplicacao;
  rotuloEnviar: string;
  aoEnviar: (dados: DadosAplicacao) => Promise<void>;
  aoCancelar?: () => void;
  // Remetente próprio só quem opera o provedor define (ver aplicacoes/route.ts).
  permitirRemetente: boolean;
}) {
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [origens, setOrigens] = useState(inicial?.origens.join("\n") ?? "");
  const [rpId, setRpId] = useState(inicial?.passkeyRpId ?? "");
  const [emailRemetente, setEmailRemetente] = useState(inicial?.emailRemetente ?? "");
  const [urlLinks, setUrlLinks] = useState(inicial?.urlLinks ?? "");
  const [logoUrl, setLogoUrl] = useState(inicial?.logoUrl ?? "");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const prefixo = inicial ? `app-${inicial.id}` : "app-nova";

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);
    try {
      await aoEnviar({
        nome,
        origens: origensDoTexto(origens),
        passkeyRpId: rpId.trim() || null,
        ...(permitirRemetente ? { emailRemetente: emailRemetente.trim() || null } : {}),
        urlLinks: urlLinks.trim() || null,
        logoUrl: logoUrl.trim() || null,
      });
    } catch (erroCapturado) {
      setErro(mensagem(erroCapturado, "Não deu pra salvar."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefixo}-nome`} className="text-sm text-zinc-600 dark:text-zinc-400">
          Nome
        </label>
        <input
          id={`${prefixo}-nome`}
          required
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="input-field"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefixo}-origens`} className="text-sm text-zinc-600 dark:text-zinc-400">
          Origens permitidas
        </label>
        <textarea
          id={`${prefixo}-origens`}
          rows={3}
          value={origens}
          onChange={(e) => setOrigens(e.target.value)}
          placeholder={"https://app.cliente.com\nhttps://www.cliente.com"}
          className="input-field font-mono text-xs"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Uma por linha, só esquema e host. Vazio aceita qualquer origem (integração só
          servidor-a-servidor).
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${prefixo}-rpid`} className="text-sm text-zinc-600 dark:text-zinc-400">
          RP ID de passkey
        </label>
        <input
          id={`${prefixo}-rpid`}
          value={rpId}
          onChange={(e) => setRpId(e.target.value)}
          placeholder="cliente.com"
          className="input-field font-mono text-xs"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Domínio a que as passkeys ficam presas. Precisa cobrir todas as origens acima.
        </p>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-xl border border-black/[.08] p-3 dark:border-white/[.1]">
        <legend className="px-1 text-sm text-zinc-600 dark:text-zinc-400">E-mails aos usuários</legend>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Os e-mails já saem com o nome da aplicação no assunto. Os campos abaixo são opcionais.
        </p>
        {permitirRemetente && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${prefixo}-remetente`} className="text-sm text-zinc-600 dark:text-zinc-400">
              Remetente
            </label>
            <input
              id={`${prefixo}-remetente`}
              type="email"
              value={emailRemetente}
              onChange={(e) => setEmailRemetente(e.target.value)}
              placeholder="seguranca@cliente.com"
              className="input-field font-mono text-xs"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Precisa ser de um domínio verificado no Resend do provedor, senão o envio falha.
            </p>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefixo}-links`} className="text-sm text-zinc-600 dark:text-zinc-400">
            Endereço dos links
          </label>
          <input
            id={`${prefixo}-links`}
            value={urlLinks}
            onChange={(e) => setUrlLinks(e.target.value)}
            placeholder="https://app.cliente.com"
            className="input-field font-mono text-xs"
          />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Base dos links de verificar e-mail, redefinir senha e aceitar convite. Vazio usa as
            páginas do provedor.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${prefixo}-logo`} className="text-sm text-zinc-600 dark:text-zinc-400">
            Logo
          </label>
          <input
            id={`${prefixo}-logo`}
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://cliente.com/logo.png"
            className="input-field font-mono text-xs"
          />
        </div>
      </fieldset>

      <AvisoErro>{erro}</AvisoErro>

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={enviando} className="btn-primary">
          {enviando ? "Salvando..." : rotuloEnviar}
        </button>
        {aoCancelar && (
          <button type="button" onClick={aoCancelar} className="btn-secondary-sm">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

// O segredo só existe em texto puro nesta resposta — o servidor guarda o
// hash. Some da tela quando a pessoa confirma que guardou.
function SegredoRevelado({
  nome,
  segredo,
  aoFechar,
}: {
  nome: string;
  segredo: string;
  aoFechar: () => void;
}) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(segredo);
      notificar.sucesso("Segredo copiado.");
    } catch {
      notificar.erro("Não deu pra copiar. Selecione o texto e copie manualmente.");
    }
  }

  return (
    <div className="card-surface flex flex-col gap-3 border-[var(--accent)] p-4">
      <p className="text-sm font-medium text-foreground">Client secret de {nome}</p>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        Guarde agora: ele não é mostrado de novo. Se perder, gere outro — o atual deixa de valer
        na hora.
      </p>
      <code className="block break-all rounded-lg bg-black/[.05] px-3 py-2 font-mono text-xs text-foreground dark:bg-white/[.06]">
        {segredo}
      </code>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copiar} className="btn-secondary-sm gap-1.5">
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          Copiar
        </button>
        <button type="button" onClick={aoFechar} className="btn-secondary-sm">
          Já guardei
        </button>
      </div>
    </div>
  );
}

export default function PaginaAplicacoes() {
  const [aplicacoes, setAplicacoes] = useState<Aplicacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [confirmandoRotacaoId, setConfirmandoRotacaoId] = useState<string | null>(null);
  const [processandoId, setProcessandoId] = useState<string | null>(null);
  const [segredo, setSegredo] = useState<{ nome: string; valor: string } | null>(null);
  const [operador, setOperador] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [lista, usuario] = await Promise.all([listarAplicacoes(), obterUsuarioAtual()]);
      setAplicacoes(lista);
      setOperador(!!usuario?.operadorProvedor);
    } catch (erroCapturado) {
      setErro(mensagem(erroCapturado, "Erro inesperado."));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregar();
  }, [carregar]);

  function substituir(aplicacao: Aplicacao) {
    setAplicacoes((atual) => atual?.map((a) => (a.id === aplicacao.id ? aplicacao : a)) ?? null);
  }

  async function aoCriar(dados: DadosAplicacao) {
    const { aplicacao, clientSecret } = await criarAplicacao(dados);
    setAplicacoes((atual) => [...(atual ?? []), aplicacao]);
    setCriando(false);
    setSegredo({ nome: aplicacao.nome, valor: clientSecret });
    notificar.sucesso(`${aplicacao.nome} criada.`);
  }

  async function aoAlternarAtiva(aplicacao: Aplicacao) {
    setProcessandoId(aplicacao.id);
    try {
      substituir(await atualizarAplicacao(aplicacao.id, { ativa: !aplicacao.ativa }));
      notificar.info(
        aplicacao.ativa
          ? `${aplicacao.nome} desativada. As sessões dos usuários dela foram encerradas.`
          : `${aplicacao.nome} reativada.`,
      );
    } catch (erroCapturado) {
      notificar.erro(mensagem(erroCapturado, "Não deu pra alterar o status."));
    } finally {
      setProcessandoId(null);
    }
  }

  async function aoAprovar(aplicacao: Aplicacao) {
    setProcessandoId(aplicacao.id);
    try {
      substituir(await atualizarAplicacao(aplicacao.id, { aprovada: true }));
      notificar.sucesso(`${aplicacao.nome} aprovada.`);
    } catch (erroCapturado) {
      notificar.erro(mensagem(erroCapturado, "Não deu pra aprovar."));
    } finally {
      setProcessandoId(null);
    }
  }

  async function aoRotacionar(aplicacao: Aplicacao) {
    setProcessandoId(aplicacao.id);
    try {
      const novo = await rotacionarSegredoAplicacao(aplicacao.id);
      setConfirmandoRotacaoId(null);
      substituir({ ...aplicacao, temSegredo: true });
      setSegredo({ nome: aplicacao.nome, valor: novo });
    } catch (erroCapturado) {
      notificar.erro(mensagem(erroCapturado, "Não deu pra gerar um novo segredo."));
    } finally {
      setProcessandoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full min-w-0 max-w-3xl flex-col gap-4">
        <CabecalhoSecao
          icone={AppWindow}
          eyebrow={operador ? "Provedor" : "Integração"}
          titulo="Aplicações"
          descricao={
            operador
              ? "Os clientes que autenticam os próprios usuários por este provedor. Cada um tem contas, organizações e passkeys isoladas dos outros."
              : "Os sites e apps da sua organização que usam este provedor pra autenticar os próprios usuários. Cada aplicação tem contas isoladas das outras."
          }
          acao={
            !criando && (
              <button onClick={() => setCriando(true)} className="btn-secondary-sm gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Nova aplicação
              </button>
            )
          }
        />

        <AvisoErro>{erro}</AvisoErro>

        {segredo && (
          <SegredoRevelado
            nome={segredo.nome}
            segredo={segredo.valor}
            aoFechar={() => setSegredo(null)}
          />
        )}

        {criando && (
          <div className="card-surface p-4">
            <FormularioAplicacao
              permitirRemetente={operador}
              rotuloEnviar="Criar aplicação"
              aoEnviar={aoCriar}
              aoCancelar={() => setCriando(false)}
            />
          </div>
        )}

        {aplicacoes === null && !erro && <SkeletonLista linhas={3} />}

        {aplicacoes && aplicacoes.length === 0 && (
          <EstadoVazio
            icone={AppWindow}
            titulo="Nenhuma aplicação ainda"
            descricao="Crie a primeira e ela aparece aqui com o client ID pra integrar."
          />
        )}

        {aplicacoes && aplicacoes.length > 0 && (
          <ul className="flex flex-col gap-2.5">
            {aplicacoes.map((aplicacao) => (
              <li key={aplicacao.id} className="card-surface flex flex-col gap-3 p-4">
                {editandoId === aplicacao.id ? (
                  <FormularioAplicacao
                    permitirRemetente={operador}
                    inicial={aplicacao}
                    rotuloEnviar="Salvar"
                    aoEnviar={async (dados) => {
                      substituir(await atualizarAplicacao(aplicacao.id, dados));
                      setEditandoId(null);
                      notificar.sucesso("Alterações salvas.");
                    }}
                    aoCancelar={() => setEditandoId(null)}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{aplicacao.nome}</span>
                      {aplicacao.padrao && (
                        <span className="rounded-full bg-[var(--accent-wash)] px-2 py-0.5 text-[10px] font-medium uppercase text-[var(--accent)]">
                          padrão
                        </span>
                      )}
                      {!aplicacao.padrao && !aplicacao.aprovada && (
                        <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-700 dark:text-amber-400">
                          aguardando aprovação
                        </span>
                      )}
                      <span
                        className={
                          aplicacao.ativa
                            ? "inline-flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500"
                            : "rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400"
                        }
                      >
                        {aplicacao.ativa ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                            Ativa
                          </>
                        ) : (
                          "Desativada"
                        )}
                      </span>
                      <span className="ml-auto text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                        {aplicacao.totalUsuarios}{" "}
                        {aplicacao.totalUsuarios === 1 ? "usuário" : "usuários"}
                      </span>
                    </div>

                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                      <dt className="text-zinc-500 dark:text-zinc-400">Client ID</dt>
                      <dd className="break-all font-mono text-foreground">{aplicacao.clientId}</dd>
                      {/* O `aud` dos tokens desta aplicação: o que o backend do
                          cliente passa ao validar o JWT (docs/integracao.md). */}
                      <dt className="text-zinc-500 dark:text-zinc-400">Audience (aud)</dt>
                      <dd className="break-all font-mono text-foreground">{aplicacao.id}</dd>
                      <dt className="text-zinc-500 dark:text-zinc-400">Origens</dt>
                      <dd className="break-all font-mono text-foreground">
                        {aplicacao.origens.length > 0 ? aplicacao.origens.join(", ") : "qualquer"}
                      </dd>
                      <dt className="text-zinc-500 dark:text-zinc-400">RP ID</dt>
                      <dd className="font-mono text-foreground">{aplicacao.passkeyRpId ?? "—"}</dd>
                      <dt className="text-zinc-500 dark:text-zinc-400">Segredo</dt>
                      <dd className="text-foreground">
                        {aplicacao.temSegredo ? "configurado" : "nenhum"}
                      </dd>
                    </dl>

                    {!aplicacao.padrao && !aplicacao.aprovada && !operador && (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Até a aprovação, os e-mails aos seus usuários saem sem logo nem links
                        próprios e com limite de envios por hora.
                      </p>
                    )}
                    {!aplicacao.ativa && aplicacao.desativadaPeloOperador && !operador && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Desativada por quem opera o provedor. Fale com o suporte pra reativar.
                      </p>
                    )}

                    {confirmandoRotacaoId === aplicacao.id ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-xs text-red-600 dark:text-red-400">
                          O segredo atual de {aplicacao.nome} deixa de valer na hora. O cliente vai
                          precisar atualizar a configuração dele.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            onClick={() => aoRotacionar(aplicacao)}
                            disabled={processandoId === aplicacao.id}
                            className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
                          >
                            {processandoId === aplicacao.id ? "Gerando..." : "Gerar novo segredo"}
                          </button>
                          <button
                            onClick={() => setConfirmandoRotacaoId(null)}
                            className="btn-secondary-sm"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          onClick={() => setEditandoId(aplicacao.id)}
                          className="btn-secondary-sm"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => setConfirmandoRotacaoId(aplicacao.id)}
                          className="btn-secondary-sm gap-1.5"
                        >
                          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                          {aplicacao.temSegredo ? "Rotacionar segredo" : "Gerar segredo"}
                        </button>
                        {operador && !aplicacao.padrao && !aplicacao.aprovada && (
                          <button
                            onClick={() => aoAprovar(aplicacao)}
                            disabled={processandoId === aplicacao.id}
                            className="btn-primary-sm"
                          >
                            Aprovar
                          </button>
                        )}
                        {!aplicacao.padrao && (operador || aplicacao.ativa || !aplicacao.desativadaPeloOperador) && (
                          <button
                            onClick={() => aoAlternarAtiva(aplicacao)}
                            disabled={processandoId === aplicacao.id}
                            className={
                              aplicacao.ativa
                                ? "inline-flex items-center justify-center rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 disabled:opacity-50 dark:text-red-400"
                                : "btn-secondary-sm"
                            }
                          >
                            {aplicacao.ativa ? "Desativar" : "Reativar"}
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
