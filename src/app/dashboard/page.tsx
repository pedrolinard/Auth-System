"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  MailWarning,
  MailCheck,
  ShieldCheck,
  ShieldAlert,
  Fingerprint,
  MonitorSmartphone,
  FolderKanban,
  Users,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import {
  listarAuditoria,
  listarPasskeys,
  listarSessoes,
  listarUsuarios,
  reenviarVerificacaoEmail,
} from "@/lib/clienteAuth";
import { listarProjetos } from "@/lib/clienteDominio";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";
import { Skeleton } from "@/components/ui/Skeleton";
import { notificar } from "@/components/ui/Toaster";

type Contagem = number | null | "erro";

function primeiroNome(nome: string) {
  return nome.trim().split(/\s+/)[0];
}

export default function PaginaVisaoGeral() {
  const { usuario, carregando } = usePainelUsuario();

  const [passkeys, setPasskeys] = useState<Contagem>(null);
  const [sessoes, setSessoes] = useState<Contagem>(null);
  const [projetos, setProjetos] = useState<Contagem>(null);
  const [usuarios, setUsuarios] = useState<Contagem>(null);
  const [eventosAuditoria, setEventosAuditoria] = useState<Contagem>(null);

  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    let ativo = true;
    const ehAdmin = usuario.papel === "admin";

    function tamanho(resultado: PromiseSettledResult<{ length: number }>): Contagem {
      return resultado.status === "fulfilled" ? resultado.value.length : "erro";
    }

    Promise.allSettled([listarPasskeys(), listarSessoes(), listarProjetos()]).then(
      ([p, s, pr]) => {
        if (!ativo) return;
        setPasskeys(tamanho(p));
        setSessoes(tamanho(s));
        setProjetos(tamanho(pr));
      },
    );

    if (ehAdmin) {
      Promise.allSettled([listarUsuarios(), listarAuditoria()]).then(([u, a]) => {
        if (!ativo) return;
        setUsuarios(tamanho(u));
        setEventosAuditoria(tamanho(a));
      });
    }

    return () => {
      ativo = false;
    };
  }, [usuario]);

  async function aoReenviarVerificacao() {
    setReenviando(true);
    try {
      await reenviarVerificacaoEmail();
      setReenviado(true);
      notificar.sucesso("Link de verificação enviado. Confira sua caixa de entrada.");
    } catch (erroCapturado) {
      notificar.erro(
        erroCapturado instanceof Error ? erroCapturado.message : "Não deu pra reenviar agora.",
      );
    } finally {
      setReenviando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
        <div className="w-full max-w-3xl">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
        <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="card-surface animate-surgir flex w-full max-w-3xl flex-col gap-3 p-8">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Visão geral</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Olá, {usuario.nome}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {usuario.email} · na conta desde{" "}
          {new Date(usuario.criadoEm).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>

        {usuario.emailVerificado ? (
          <p className="flex items-center gap-1.5 text-sm text-[var(--accent)]">
            <MailCheck className="h-4 w-4" aria-hidden="true" />
            E-mail verificado
          </p>
        ) : (
          <div className="mt-1 flex flex-col gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[.06] p-3">
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-400">
              <MailWarning className="h-4 w-4" aria-hidden="true" />
              E-mail não verificado
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {primeiroNome(usuario.nome)}, confirme seu e-mail pra não perder o acesso caso
              precise recuperar a conta.
            </p>
            {!reenviado && (
              <button
                onClick={aoReenviarVerificacao}
                disabled={reenviando}
                className="btn-secondary-sm self-start"
              >
                {reenviando ? "Enviando..." : "Reenviar link de verificação"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CartaoIndicador
          href="/dashboard/conta"
          icone={usuario.emailVerificado ? MailCheck : MailWarning}
          rotulo="E-mail"
          valor={usuario.emailVerificado ? "Verificado" : "Pendente"}
          detalhe={usuario.emailVerificado ? "Tudo certo por aqui" : "Falta confirmar o link"}
          alerta={!usuario.emailVerificado}
        />
        <CartaoIndicador
          href="/dashboard/seguranca"
          icone={usuario.mfaAtivado ? ShieldCheck : ShieldAlert}
          rotulo="Duas etapas"
          valor={usuario.mfaAtivado ? "Ativa" : "Inativa"}
          detalhe={usuario.mfaAtivado ? "Código exigido no login" : "Vale a pena ativar"}
          alerta={!usuario.mfaAtivado}
        />
        <CartaoIndicador
          href="/dashboard/seguranca"
          icone={Fingerprint}
          rotulo="Passkeys"
          valor={passkeys}
          detalhe="Entrar sem senha"
        />
        <CartaoIndicador
          href="/dashboard/seguranca"
          icone={MonitorSmartphone}
          rotulo="Sessões ativas"
          valor={sessoes}
          detalhe="Dispositivos conectados"
        />
        <CartaoIndicador
          href="/dashboard/projetos"
          icone={FolderKanban}
          rotulo="Projetos"
          valor={projetos}
          detalhe="Seus projetos e tarefas"
        />
        {usuario.papel === "admin" && (
          <>
            <CartaoIndicador
              href="/dashboard/usuarios"
              icone={Users}
              rotulo="Usuários"
              valor={usuarios}
              detalhe="Gerenciar contas"
            />
            <CartaoIndicador
              href="/dashboard/auditoria"
              icone={ScrollText}
              rotulo="Auditoria"
              valor={eventosAuditoria}
              detalhe="Eventos recentes"
            />
          </>
        )}
      </div>
    </div>
  );
}

function CartaoIndicador({
  href,
  icone: Icone,
  rotulo,
  valor,
  detalhe,
  alerta = false,
}: {
  href: string;
  icone: LucideIcon;
  rotulo: string;
  valor: Contagem | string;
  detalhe: string;
  alerta?: boolean;
}) {
  const carregando = valor === null;
  const texto = valor === "erro" ? "—" : String(valor);

  return (
    <Link
      href={href}
      className="card-surface group flex flex-col gap-2 p-5 transition-transform duration-150 hover:-translate-y-0.5"
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">{rotulo}</span>
        <Icone
          className={`h-4 w-4 ${alerta ? "text-amber-500" : "text-zinc-400 dark:text-zinc-500"}`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </div>
      {carregando ? (
        <Skeleton className="h-6 w-14" />
      ) : (
        <span
          className={
            alerta
              ? "text-xl font-semibold tracking-tight text-amber-600 dark:text-amber-400"
              : "text-xl font-semibold tracking-tight text-foreground"
          }
        >
          {texto}
        </span>
      )}
      <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
        {detalhe}
        <ArrowRight className="h-3 w-3 transition-transform duration-150 group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}
