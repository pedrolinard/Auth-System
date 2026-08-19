import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Provider as RollbarProvider } from "@rollbar/react";
import { configCliente } from "@/lib/rollbar";
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

export default function LayoutRaiz({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <RollbarProvider config={configCliente}>{children}</RollbarProvider>
      </body>
    </html>
  );
}
