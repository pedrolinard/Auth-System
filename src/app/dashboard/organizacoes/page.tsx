"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Mail, Plus, X } from "lucide-react";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";
import {
  criarConvite,
  criarOrganizacao,
  entrarNaOrganizacao,
  listarConvites,
  listarOrganizacoes,
  revogarConvite,
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

  const ehAdminOrganizacao =
    usuario?.papelOrganizacao === "dono" || usuario?.papelOrganizacao === "admin";

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
      // não só os dados desta rota.
      window.location.assign("/dashboard/organizacoes");
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
      window.location.assign("/dashboard/organizacoes");
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra trocar de organização.",
      );
      setTrocandoId(null);
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
                  {ativa ? (
                    <span className="rounded-full bg-[var(--accent-wash)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
                      Ativa
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
                </li>
              );
            })}
          </ul>
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
