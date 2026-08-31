"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Marca } from "@/components/Marca";
import { obterUsuarioAtual, sair } from "@/lib/clienteAuth";

type ItemNav = {
  href: string;
  rotulo: string;
  // exato: só marca ativo na rota idêntica (ex.: "Visão geral" em /dashboard).
  // caso contrário, marca ativo em qualquer sub-rota (ex.: /dashboard/projetos/3).
  exato?: boolean;
  admin?: boolean;
};

const ITENS: ItemNav[] = [
  { href: "/dashboard", rotulo: "Visão geral", exato: true },
  { href: "/dashboard/projetos", rotulo: "Projetos" },
  { href: "/dashboard/conta", rotulo: "Conta" },
  { href: "/dashboard/seguranca", rotulo: "Segurança" },
  { href: "/dashboard/usuarios", rotulo: "Usuários", admin: true },
  { href: "/dashboard/auditoria", rotulo: "Auditoria", admin: true },
];

// Barra de navegação persistente do painel — montada pra todas as telas de
// /dashboard via layout.tsx. Substitui os links soltos "Voltar ao dashboard"
// que cada página tinha e dá uma hierarquia única de navegação.
export function NavPainel() {
  const pathname = usePathname();
  const router = useRouter();
  const [ehAdmin, setEhAdmin] = useState(false);

  useEffect(() => {
    let ativo = true;
    obterUsuarioAtual().then((usuario) => {
      if (ativo) setEhAdmin(usuario?.papel === "admin");
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function aoSair() {
    await sair();
    router.replace("/login");
  }

  const itensVisiveis = ITENS.filter((item) => !item.admin || ehAdmin);

  return (
    <header className="sticky top-0 z-30 border-b border-black/[.08] bg-white/85 backdrop-blur-md dark:border-white/[.1] dark:bg-black/70">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <Marca className="h-5 w-5 text-foreground" />
          <span className="eyebrow hidden text-zinc-500 sm:inline dark:text-zinc-500">
            Painel
          </span>
        </Link>

        <nav className="-mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1">
          {itensVisiveis.map((item) => {
            const ativo = item.exato
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                className={
                  ativo
                    ? "whitespace-nowrap rounded-full bg-black/[.06] px-3 py-1.5 text-sm font-medium text-foreground dark:bg-white/[.08]"
                    : "whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400"
                }
              >
                {item.rotulo}
              </Link>
            );
          })}
        </nav>

        <button onClick={aoSair} className="btn-secondary-sm shrink-0">
          Sair
        </button>
      </div>
    </header>
  );
}
