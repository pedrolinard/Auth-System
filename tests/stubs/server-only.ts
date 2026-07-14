// Stub pro pacote "server-only" fora do bundler do Next.js — o pacote real
// lança um erro proposital quando importado fora de um Server Component;
// o Next.js troca por um no-op ao empacotar pro servidor, e aqui fazemos o
// mesmo pra poder importar src/lib/db.ts direto nos testes (Vitest não
// passa pelo bundler do Next).
export {};
