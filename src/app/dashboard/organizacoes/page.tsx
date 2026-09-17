"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, LogOut, Mail, Pencil, Plus, Trash2, X } from "lucide-react";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";
import {
  criarConvite,
  criarOrganizacao,
  entrarNaOrganizacao,
  excluirOrganizacao,
  listarConvites,
  listarOrganizacoes,
  renomearOrganizacao,
  revogarConvite,
  sairDaOrganizacao,
  type ConviteOrganizacao,
  type Organizacao,
} from "@/lib/clienteOrganizacao";
import { AvisoErro } from "@/components/ui/AvisoErro";
import { EstadoVazio } from "@/components/ui/EstadoVazio";
import { SkeletonLista } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

const PAPEIS_CONVITE = [
  { valor: "membro", rotulo: "Membro" },
  { valor: "admin", rotulo: "Admin" },
] as const;

export default function PaginaOrganizacoes() {
  const { usuario } = usePainelUsuario();
  const [organizacoes, setOrganizacoes] = useState<Organizacao[] | null>(null);
  const [convites, setConvites] = useState<ConviteOrganizacao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [nomeNova, setNomeNova] = useState("");
  const [criandoOrg, setCriandoOrg] = useState(false);
  const [trocandoId, setTrocandoId] = useState<string | null>(null);

  const [emailConvite, setEmailConvite] = useState("");
  const [papelConvite, setPapelConvite] = useState<"admin" | "membro">("membro");
  const [convidando, setConvidando] = useState(false);
  const [revogandoId, setRevogandoId] = useState<string | null>(null);

  const [nomeEditado, setNomeEditado] = useState<string | null>(null);
  const [renomeando, setRenomeando] = useState(false);
  const [confirmandoSaidaId, setConfirmandoSaidaId] = useState<string | null>(null);
  const [saindoId, setSaindoId] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [senhaExclusao, setSenhaExclusao] = useState("");
  const [excluindo, setExcluindo] = useState(false);
  // Erro de renomear/excluir fica dentro do cartão da organização ativa, junto
  // do campo que falhou — não no topo da página, fora da vista.
  const [erroGestao, setErroGestao] = useState<string | null>(null);

  const ehAdminOrganizacao =
    usuario?.papelOrganizacao === "dono" || usuario?.papelOrganizacao === "admin";
  const organizacaoAtiva = organizacoes?.find((org) => org.id === usuario?.organizacaoId);
  // Mesma regra do servidor (temOutraOrganizacaoAcessivel): sem outra
  // organização em que dê pra entrar, sair e excluir sempre seriam recusados.
  const temOutraAcessivel =
    organizacoes?.some((org) => org.id !== usuario?.organizacaoId && !org.suspenso) ?? false;

  const carregarOrganizacoes = useCallback(async () => {
    try {
      setOrganizacoes(await listarOrganizacoes());
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    }
  }, []);

  const carregarConvites = useCallback(async () => {
    try {
      setConvites(await listarConvites());
    } catch {
      // Não é fatal pra tela inteira — quem não é admin já nem chama isto.
      setConvites([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carregarOrganizacoes();
  }, [carregarOrganizacoes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (ehAdminOrganizacao) carregarConvites();
  }, [ehAdminOrganizacao, carregarConvites]);

  async function aoCriarOrganizacao(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setCriandoOrg(true);
    try {
      await criarOrganizacao(nomeNova);
      setNomeNova("");
      notificar.sucesso("Organização criada — você já está nela.");
      // Recarrega a página inteira de propósito (não router.push/refresh):
      // o cookie da sessão mudou de organização, e todo estado em memória
      // desta e de outras telas (NavPainel incluso) precisa refletir isso,
      // não só os dados desta rota. É esta mesma página, então reload basta.
      window.location.reload();
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
      setCriandoOrg(false);
    }
  }

  async function aoTrocar(org: Organizacao) {
    if (!usuario || org.id === usuario.organizacaoId) return;
    setTrocandoId(org.id);
    try {
      await entrarNaOrganizacao(org.id);
      // Mesmo motivo do criar organização acima — precisa recarregar tudo.
      window.location.reload();
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra trocar de organização.",
      );
      setTrocandoId(null);
    }
  }

  async function aoRenomear(evento: React.FormEvent) {
    evento.preventDefault();
    if (!organizacaoAtiva || nomeEditado === null) return;
    setErroGestao(null);
    setRenomeando(true);
    try {
      const { nome } = await renomearOrganizacao(organizacaoAtiva.id, nomeEditado);
      setOrganizacoes((atual) =>
        atual?.map((org) => (org.id === organizacaoAtiva.id ? { ...org, nome } : org)) ?? null,
      );
      setNomeEditado(null);
      notificar.sucesso("Nome da organização atualizado.");
    } catch (erroCapturado) {
      setErroGestao(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setRenomeando(false);
    }
  }

  async function aoSair(org: Organizacao) {
    setSaindoId(org.id);
    try {
      await sairDaOrganizacao(org.id);
      notificar.info(`Você saiu de ${org.nome}.`);
      if (org.id === usuario?.organizacaoId) {
        // A sessão foi reemitida em outra organização — mesmo motivo do
        // criar/trocar: tudo em memória ainda aponta pra antiga.
        window.location.reload();
        return;
      }
      setOrganizacoes((atual) => atual?.filter((o) => o.id !== org.id) ?? null);
      setConfirmandoSaidaId(null);
      setSaindoId(null);
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra sair da organização.",
      );
      setSaindoId(null);
    }
  }

  async function aoExcluir(evento: React.FormEvent) {
    evento.preventDefault();
    if (!organizacaoAtiva) return;
    setErroGestao(null);
    setExcluindo(true);
    try {
      await excluirOrganizacao(organizacaoAtiva.id, senhaExclusao);
      notificar.info(`${organizacaoAtiva.nome} foi excluída.`);
      window.location.reload();
    } catch (erroCapturado) {
      setErroGestao(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
      setExcluindo(false);
    }
  }

  async function aoConvidar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);
    setConvidando(true);
    try {
      await criarConvite({ email: emailConvite, papel: papelConvite });
      setEmailConvite("");
      await carregarConvites();
      notificar.sucesso(`Convite enviado para ${emailConvite}.`);
    } catch (erroCapturado) {
      setErro(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setConvidando(false);
    }
  }

  async function aoRevogar(convite: ConviteOrganizacao) {
    setRevogandoId(convite.id);
    const anteriores = convites;
    setConvites((atual) => atual?.filter((c) => c.id !== convite.id) ?? null);
    try {
      await revogarConvite(convite.id);
      notificar.info(`Convite para ${convite.email} cancelado.`);
    } catch (erroCapturado) {
      setConvites(anteriores ?? null);
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra cancelar o convite.",
      );
    } finally {
      setRevogandoId(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="flex w-full min-w-0 max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-zinc-500 dark:text-zinc-500">Conta</span>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Organizações</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Suas organizações, e — se você for dono ou admin da ativa — quem mais tem acesso a
            ela.
          </p>
        </div>

        <AvisoErro>{erro}</AvisoErro>

        {organizacoes === null && <SkeletonLista linhas={2} />}

        {organizacoes && (
          <ul className="flex flex-col gap-2.5">
            {organizacoes.map((org) => {
              const ativa = org.id === usuario?.organizacaoId;
              return (
                <li
                  key={org.id}
                  className="card-surface flex items-center gap-3 p-4"
                >
                  <span className="chip-secao">
                    <Building2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">{org.nome}</span>
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {org.papel}
                    </span>
                  </span>
                  {!ativa && confirmandoSaidaId === org.id ? (
                    <span className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={() => aoSair(org)}
                        disabled={saindoId === org.id}
                        className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
                      >
                        {saindoId === org.id ? "Saindo..." : "Sim, sair"}
                      </button>
                      <button onClick={() => setConfirmandoSaidaId(null)} className="btn-secondary-sm">
                        Cancelar
                      </button>
                    </span>
                  ) : ativa ? (
                    <span className="rounded-full bg-[var(--accent-wash)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                      Ativa
                    </span>
                  ) : org.suspenso ? (
                    <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      Acesso suspenso
                    </span>
                  ) : (
                    <button
                      onClick={() => aoTrocar(org)}
                      disabled={trocandoId === org.id}
                      className="btn-secondary-sm shrink-0"
                    >
                      {trocandoId === org.id ? "Entrando..." : "Entrar"}
                    </button>
                  )}
                  {!ativa && confirmandoSaidaId !== org.id && (
                    <button
                      onClick={() => setConfirmandoSaidaId(org.id)}
                      className="btn-ghost shrink-0 p-1.5"
                      aria-label={`Sair de ${org.nome}`}
                      title="Sair da organização"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {organizacaoAtiva && (
          <section className="card-surface flex flex-col gap-4 p-6">
            <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Building2 className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              Organização ativa
            </h2>

            <AvisoErro>{erroGestao}</AvisoErro>

            {ehAdminOrganizacao && (
              <form onSubmit={aoRenomear} className="flex flex-col gap-2">
                <label htmlFor="nome-organizacao" className="text-xs text-zinc-500 dark:text-zinc-400">
                  Nome
                </label>
                <div className="flex gap-2">
                  <input
                    id="nome-organizacao"
                    required
                    value={nomeEditado ?? organizacaoAtiva.nome}
                    onChange={(e) => setNomeEditado(e.target.value)}
                    className="input-field min-w-0 flex-1"
                  />
                  <button
                    type="submit"
                    disabled={
                      renomeando ||
                      nomeEditado === null ||
                      nomeEditado.trim() === organizacaoAtiva.nome
                    }
                    className="btn-secondary-sm shrink-0 gap-1.5"
                  >
                    <Pencil className="h-3 w-3" aria-hidden="true" />
                    {renomeando ? "Salvando..." : "Renomear"}
                  </button>
                </div>
              </form>
            )}

            {!temOutraAcessivel ? (
              <p className="border-t border-black/[.06] pt-4 text-xs text-zinc-500 dark:border-white/[.08] dark:text-zinc-400">
                Esta é sua única organização. Para sair dela ou excluí-la, crie ou entre em outra
                antes.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 border-t border-black/[.06] pt-4 dark:border-white/[.08]">
                {confirmandoSaidaId === organizacaoAtiva.id ? (
                  <>
                    <span className="text-xs text-red-600 dark:text-red-400">
                      Sair de {organizacaoAtiva.nome}?
                    </span>
                    <button
                      onClick={() => aoSair(organizacaoAtiva)}
                      disabled={saindoId === organizacaoAtiva.id}
                      className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
                    >
                      {saindoId === organizacaoAtiva.id ? "Saindo..." : "Sim, sair"}
                    </button>
                    <button onClick={() => setConfirmandoSaidaId(null)} className="btn-secondary-sm">
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setConfirmandoSaidaId(organizacaoAtiva.id)}
                    className="btn-secondary-sm gap-1.5"
                  >
                    <LogOut className="h-3 w-3" aria-hidden="true" />
                    Sair da organização
                  </button>
                )}
                {usuario?.papelOrganizacao === "dono" && !confirmandoExclusao && (
                  <button
                    onClick={() => setConfirmandoExclusao(true)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-red-600/30 px-4 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-600/10 dark:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                    Excluir organização
                  </button>
                )}
              </div>
            )}

            {confirmandoExclusao && (
              <form onSubmit={aoExcluir} className="flex flex-col gap-2">
                <p className="text-xs text-red-600 dark:text-red-400">
                  Excluir {organizacaoAtiva.nome} remove todos os membros e convites, e não dá pra
                  desfazer. Confirme com sua senha.
                </p>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={senhaExclusao}
                  onChange={(e) => setSenhaExclusao(e.target.value)}
                  placeholder="Sua senha"
                  aria-label="Sua senha"
                  className="input-field"
                />
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="submit"
                    disabled={excluindo || !senhaExclusao}
                    className="inline-flex items-center justify-center rounded-full bg-red-600 px-4 py-1.5 text-xs font-medium text-white transition-all duration-150 hover:-translate-y-px hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {excluindo ? "Excluindo..." : "Excluir definitivamente"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmandoExclusao(false);
                      setSenhaExclusao("");
                      setErroGestao(null);
                    }}
                    className="btn-secondary-sm"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </section>
        )}

        <form onSubmit={aoCriarOrganizacao} className="card-surface flex flex-col gap-3 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Plus className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Nova organização
          </h2>
          <input
            required
            value={nomeNova}
            onChange={(e) => setNomeNova(e.target.value)}
            placeholder="Nome da organização"
            className="input-field"
          />
          <button
            type="submit"
            disabled={criandoOrg || !nomeNova}
            className="btn-primary self-start"
          >
            {criandoOrg ? "Criando..." : "Criar organização"}
          </button>
        </form>

        {ehAdminOrganizacao && (
          <>
            <form onSubmit={aoConvidar} className="card-surface flex flex-col gap-3 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Mail className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                Convidar para a organização ativa
              </h2>
              <input
                required
                type="email"
                value={emailConvite}
                onChange={(e) => setEmailConvite(e.target.value)}
                placeholder="E-mail da pessoa"
                className="input-field"
              />
              <div className="flex flex-wrap gap-1.5">
                {PAPEIS_CONVITE.map(({ valor, rotulo }) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setPapelConvite(valor)}
                    className={
                      papelConvite === valor
                        ? "rounded-full bg-[var(--accent-wash)] px-3 py-1.5 text-xs font-medium text-[var(--accent)]"
                        : "rounded-full px-3 py-1.5 text-xs text-zinc-500 hover:text-foreground dark:text-zinc-400"
                    }
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
              <button
                type="submit"
                disabled={convidando || !emailConvite}
                className="btn-primary self-start"
              >
                {convidando ? "Enviando..." : "Enviar convite"}
              </button>
            </form>

            {convites === null ? (
              <SkeletonLista linhas={2} />
            ) : convites.length === 0 ? (
              <EstadoVazio
                icone={Mail}
                titulo="Nenhum convite pendente"
                descricao="Convites enviados e ainda não aceitos aparecem aqui."
              />
            ) : (
              <ul className="flex flex-col gap-2.5">
                {convites.map((convite) => (
                  <li
                    key={convite.id}
                    className="card-surface flex items-center gap-3 p-4"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {convite.email}
                      </span>
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {convite.papel}
                      </span>
                    </span>
                    <button
                      onClick={() => aoRevogar(convite)}
                      disabled={revogandoId === convite.id}
                      className="btn-secondary-sm shrink-0 gap-1.5"
                      aria-label={`Cancelar convite de ${convite.email}`}
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                      {revogandoId === convite.id ? "Cancelando..." : "Cancelar"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
