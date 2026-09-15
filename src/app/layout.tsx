import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { Provider as RollbarProvider } from "@rollbar/react";
import { configCliente } from "@/lib/rollbar";
import { Toaster } from "@/components/ui/Toaster";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Autenticação",
  description: "Sistema de autenticação",
};

export const viewport: Viewport = {
  themeColor: "#0b0e0d",
};

export default async function LayoutRaiz({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Força renderização por requisição em TODA página. O CSP das páginas leva
  // um nonce gerado no proxy a cada requisição, e o Next só consegue
  // carimbá-lo nos próprios scripts durante um render com requisição — uma
  // página pré-gerada no build sairia sem nonce e com os scripts bloqueados
  // pelo navegador em produção (em dev tudo é dinâmico e o problema não
  // aparece). Ver src/lib/csp.ts.
  await connection();

  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RollbarProvider config={configCliente}>{children}</RollbarProvider>
        <Toaster />
      </body>
    </html>
  );
}
