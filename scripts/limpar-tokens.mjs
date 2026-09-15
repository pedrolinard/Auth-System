// Dispara a limpeza de tokens expirados/revogados chamando a rota protegida
// da própria aplicação. Requer o servidor rodando (dev ou produção).
//
// Uso:
//   BASE_URL=https://seu-dominio.com CRON_SECRET=... node scripts/limpar-tokens.mjs
//   npm run limpeza:tokens   (usa BASE_URL/CRON_SECRET do .env local)

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error("Defina a variável de ambiente CRON_SECRET antes de rodar este script.");
  process.exit(1);
}

const resposta = await fetch(`${baseUrl}/api/cron/limpar-tokens`, {
  method: "POST",
  headers: { Authorization: `Bearer ${cronSecret}` },
});

// Um 500 sem corpo (ou uma página de erro HTML de proxy) não pode derrubar o
// script com um erro de JSON que esconde o status real.
const corpo = await resposta.json().catch(() => null);

if (!resposta.ok || !corpo) {
  console.error(`Falha na limpeza (status ${resposta.status}):`, corpo ?? "(resposta sem JSON)");
  process.exit(1);
}

const d = corpo.detalhe ?? {};
console.log(
  `Limpeza concluída: ${corpo.removidos} registro(s) removido(s)` +
    (corpo.detalhe
      ? ` (tokens: ${d.tokens}, auditoria: ${d.auditoria}, desafios MFA: ${d.desafiosMfa}, rate limit: ${d.limitesTaxa}).`
      : "."),
);
