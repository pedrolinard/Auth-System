"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  listarAuditoria,
  listarPasskeys,
  listarSessoes,
  listarUsuarios,
  reenviarVerificacaoEmail,
} from "@/lib/clienteAuth";
import { listarProjetos } from "@/lib/clienteDominio";
import { usePainelUsuario } from "@/components/painel/usePainelUsuario";

type Contagem = number | null | "erro";

function texto(valor: Contagem): string {
  if (valor === null) return "…";
  if (valor === "erro") return "—";
  return String(valor);
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
  const [erroReenvio, setErroReenvio] = useState<string | null>(null);

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
    setErroReenvio(null);
    setReenviando(true);
    try {
      await reenviarVerificacaoEmail();
      setReenviado(true);
    } catch (erroCapturado) {
      setErroReenvio(erroCapturado instanceof Error ? erroCapturado.message : "Erro inesperado.");
    } finally {
      setReenviando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-zinc-600 dark:text-zinc-400">Carregando...</p>
      </div>
    );
  }

  if (!usuario) return null;

  return (
    <div className="flex flex-1 flex-col items-center gap-6 px-6 py-10">
      <div className="card-surface flex w-full max-w-3xl flex-col gap-3 p-8">
        <span className="eyebrow text-zinc-500 dark:text-zinc-500">Visão geral</span>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Olá, {usuario.nome}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{usuario.email}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Conta criada em {new Date(usuario.criadoEm).toLocaleString("pt-BR")}
        </p>
        <p
          className={
            usuario.emailVerificado
              ? "text-sm text-green-600 dark:text-green-400"
              : "text-sm text-amber-600 dark:text-amber-400"
          }
        >
          {usuario.emailVerificado ? "E-mail verificado" : "E-mail não verificado"}
        </p>

        {!usuario.emailVerificado && (
          <div className="flex flex-col gap-1">
            {reenviado ? (
              <p className="text-sm text-green-600 dark:text-green-400">
                Link de verificação enviado. Confira sua caixa de entrada.
              </p>
            ) : (
              <button
                onClick={aoReenviarVerificacao}
                disabled={reenviando}
                className="link-underline self-start text-sm text-zinc-600 disabled:opacity-50 dark:text-zinc-400"
              >
                {reenviando ? "Enviando..." : "Reenviar e-mail de verificação"}
              </button>
            )}
            {erroReenvio && (
              <p className="text-sm text-red-600 dark:text-red-400">{erroReenvio}</p>
            )}
          </div>
        )}
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CartaoIndicador
          href="/dashboard/conta"
          rotulo="E-mail"
          valor={usuario.emailVerificado ? "Verificado" : "Não verificado"}
          detalhe={usuario.emailVerificado ? "Tudo certo" : "Confirme para proteger a conta"}
          alerta={!usuario.emailVerificado}
        />
        <CartaoIndicador
          href="/dashboard/seguranca"
          rotulo="Duas etapas"
          valor={usuario.mfaAtivado ? "Ativa" : "Inativa"}
          detalhe={usuario.mfaAtivado ? "Código exigido no login" : "Recomendado ativar"}
          alerta={!usuario.mfaAtivado}
        />
        <CartaoIndicador
          href="/dashboard/seguranca"
          rotulo="Passkeys"
          valor={texto(passkeys)}
          detalhe="Login sem senha"
        />
        <CartaoIndicador
          href="/dashboard/seguranca"
          rotulo="Sessões ativas"
          valor={texto(sessoes)}
          detalhe="Dispositivos conectados"
        />
        <CartaoIndicador
          href="/dashboard/projetos"
          rotulo="Projetos"
          valor={texto(projetos)}
          detalhe="Seus projetos e tarefas"
        />
        {usuario.papel === "admin" && (
          <>
            <CartaoIndicador
              href="/dashboard/usuarios"
              rotulo="Usuários"
              valor={texto(usuarios)}
              detalhe="Gerenciar contas"
            />
            <CartaoIndicador
              href="/dashboard/auditoria"
              rotulo="Auditoria"
              valor={texto(eventosAuditoria)}
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
  rotulo,
  valor,
  detalhe,
  alerta = false,
}: {
  href: string;
  rotulo: string;
  valor: string;
  detalhe: string;
  alerta?: boolean;
}) {
  return (
    <Link
      href={href}
      className="card-surface group flex flex-col gap-1 p-5 transition-transform duration-150 hover:-translate-y-0.5"
    >
      <span className="eyebrow text-zinc-500 dark:text-zinc-500">{rotulo}</span>
      <span
        className={
          alerta
            ? "text-xl font-semibold tracking-tight text-amber-600 dark:text-amber-400"
            : "text-xl font-semibold tracking-tight text-foreground"
        }
      >
        {valor}
      </span>
      <span className="mt-1 flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
        {detalhe}
        <span className="transition-transform duration-150 group-hover:translate-x-0.5">→</span>
      </span>
    </Link>
  );
}
