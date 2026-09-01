"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutGrid,
  FolderKanban,
  UserRound,
  ShieldCheck,
  Users,
  ScrollText,
  Building2,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { Marca } from "@/components/Marca";
import { obterUsuarioAtual, sair, type UsuarioAtual } from "@/lib/clienteAuth";
import { entrarNaOrganizacao, listarOrganizacoes, type Organizacao } from "@/lib/clienteOrganizacao";
import { notificar } from "@/components/ui/Toaster";

type ItemNav = {
  href: string;
  rotulo: string;
  icone: LucideIcon;
  // exato: só marca ativo na rota idêntica (ex.: "Visão geral" em /dashboard).
  // caso contrário, marca ativo em qualquer sub-rota (ex.: /dashboard/projetos/3).
  exato?: boolean;
  // "organizacao": só dono/admin da organização ATIVA (papelOrganizacao).
  // "sistema": só quem tem o papel de sistema (Usuario.papel) — instalação
  // inteira, não uma organização específica. Eixos diferentes, ver
  // src/lib/rbacOrganizacao.ts.
  restrito?: "organizacao" | "sistema";
};

const ITENS: ItemNav[] = [
  { href: "/dashboard", rotulo: "Visão geral", icone: LayoutGrid, exato: true },
  { href: "/dashboard/projetos", rotulo: "Projetos", icone: FolderKanban },
  { href: "/dashboard/organizacoes", rotulo: "Organizações", icone: Building2 },
  { href: "/dashboard/conta", rotulo: "Conta", icone: UserRound },
  { href: "/dashboard/seguranca", rotulo: "Segurança", icone: ShieldCheck },
  { href: "/dashboard/usuarios", rotulo: "Usuários", icone: Users, restrito: "organizacao" },
  { href: "/dashboard/auditoria", rotulo: "Auditoria", icone: ScrollText, restrito: "sistema" },
];

// Barra de navegação persistente do painel — montada pra todas as telas de
// /dashboard via layout.tsx. Substitui os links soltos "Voltar ao dashboard"
// que cada página tinha e dá uma hierarquia única de navegação.
export function NavPainel() {
  const pathname = usePathname();
  const router = useRouter();
  const [usuario, setUsuario] = useState<UsuarioAtual | null>(null);
  const [organizacoes, setOrganizacoes] = useState<Organizacao[] | null>(null);
  const [trocando, setTrocando] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    let ativo = true;
    obterUsuarioAtual().then((atual) => {
      if (!ativo) return;
      setUsuario(atual);
      if (atual) listarOrganizacoes().then((orgs) => ativo && setOrganizacoes(orgs));
    });
    return () => {
      ativo = false;
    };
  }, []);

  async function aoTrocarOrganizacao(id: string) {
    if (!usuario || id === usuario.organizacaoId) return;
    setTrocando(true);
    try {
      await entrarNaOrganizacao(id);
      // O cookie da sessão já mudou — recarrega a página inteira pra todo
      // estado em memória (dados de projetos, membros, etc.) refletir a
      // organização nova, não só o valor deste componente.
      window.location.assign(pathname);
    } catch {
      notificar.erro("Não deu pra trocar de organização agora.");
      setTrocando(false);
    }
  }

  async function aoSair() {
    setSaindo(true);
    try {
      await sair();
      router.replace("/login");
    } catch {
      setSaindo(false);
      notificar.erro("Não deu pra sair agora. Tente de novo.");
    }
  }

  const ehAdminOrganizacao =
    usuario?.papelOrganizacao === "dono" || usuario?.papelOrganizacao === "admin";
  const ehAdminSistema = usuario?.papel === "admin";

  const itensVisiveis = ITENS.filter((item) => {
    if (item.restrito === "organizacao") return ehAdminOrganizacao;
    if (item.restrito === "sistema") return ehAdminSistema;
    return true;
  });

  return (
    <header className="sticky top-0 z-30 border-b border-black/[.08] bg-white/85 backdrop-blur-md dark:border-white/[.1] dark:bg-black/70">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <Marca className="h-5 w-5 text-foreground" />
          <span className="eyebrow hidden text-zinc-500 sm:inline dark:text-zinc-500">
            Painel
          </span>
        </Link>

        {organizacoes && organizacoes.length > 1 && usuario && (
          <select
            value={usuario.organizacaoId}
            onChange={(e) => aoTrocarOrganizacao(e.target.value)}
            disabled={trocando}
            aria-label="Organização ativa"
            className="max-w-[10rem] shrink-0 truncate rounded-full border border-black/[.08] bg-transparent px-3 py-1.5 text-sm text-foreground disabled:opacity-50 dark:border-white/[.1]"
          >
            {organizacoes.map((org) => (
              <option key={org.id} value={org.id}>
                {org.nome}
              </option>
            ))}
          </select>
        )}

        <nav className="-mx-1 flex flex-1 items-center gap-0.5 overflow-x-auto px-1">
          {itensVisiveis.map((item) => {
            const ativo = item.exato
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icone = item.icone;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={ativo ? "page" : undefined}
                className={
                  ativo
                    ? "flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--accent-wash)] px-3 py-1.5 text-sm font-medium text-[var(--accent)]"
                    : "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-zinc-500 transition-colors hover:text-foreground dark:text-zinc-400"
                }
              >
                <Icone className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                {item.rotulo}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={aoSair}
          disabled={saindo}
          className="btn-secondary-sm shrink-0 gap-1.5"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          {saindo ? "Saindo..." : "Sair"}
        </button>
      </div>
    </header>
  );
}
