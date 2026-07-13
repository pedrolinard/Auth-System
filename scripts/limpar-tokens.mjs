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

const corpo = await resposta.json();

if (!resposta.ok) {
  console.error(`Falha na limpeza (status ${resposta.status}):`, corpo);
  process.exit(1);
}

console.log(`Limpeza concluída: ${corpo.removidos} token(s) removido(s).`);
