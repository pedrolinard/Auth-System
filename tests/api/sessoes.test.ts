import { afterAll, describe, expect, it } from "vitest";
import {
  apagarUsuariosTeste,
  BASE_URL,
  criarUsuarioTeste,
  loginTeste,
} from "../helpers";

const emailsCriados: string[] = [];

describe("Gestão de sessões", () => {
  afterAll(async () => {
    await apagarUsuariosTeste(emailsCriados);
  });

  it("lista a sessão atual", async () => {
    const usuario = await criarUsuarioTeste("sessoes-listar");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/sessoes`, {
      headers: cabecalhos,
    });

    expect(resposta.status).toBe(200);
    const corpo = await resposta.json();
    expect(corpo.sessoes).toHaveLength(1);
    expect(corpo.sessoes[0].atual).toBe(true);
  });

  it("revoga uma sessão específica", async () => {
    const usuario = await criarUsuarioTeste("sessoes-revogar-uma");
    emailsCriados.push(usuario.email);
    const { cabecalhos } = await loginTeste(usuario.email, usuario.senha);

    const listaAntes = await (
      await fetch(`${BASE_URL}/api/auth/sessoes`, { headers: cabecalhos })
    ).json();
    const id = listaAntes.sessoes[0].id;

    const respostaRevogar = await fetch(`${BASE_URL}/api/auth/sessoes/${id}`, {
      method: "DELETE",
      headers: cabecalhos,
    });
    expect(respostaRevogar.status).toBe(200);

    const listaDepois = await (
      await fetch(`${BASE_URL}/api/auth/sessoes`, { headers: cabecalhos })
    ).json();
    expect(listaDepois.sessoes).toHaveLength(0);
  });

  it("'sair de todos os dispositivos' revoga todas as sessões ativas", async () => {
    const usuario = await criarUsuarioTeste("sessoes-revogar-todas");
    emailsCriados.push(usuario.email);

    // Dois "dispositivos" logados na mesma conta.
    const dispositivo1 = await loginTeste(usuario.email, usuario.senha);
    await loginTeste(usuario.email, usuario.senha);

    const respostaRevogarTodas = await fetch(`${BASE_URL}/api/auth/sessoes`, {
      method: "DELETE",
      headers: dispositivo1.cabecalhos,
    });
    expect(respostaRevogarTodas.status).toBe(200);

    // Confirma via /atualizar que o refresh token do dispositivo 1 não
    // funciona mais (prova real de revogação, não só a resposta 200).
    const respostaAtualizar = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: dispositivo1.cabecalhos,
    });
    expect(respostaAtualizar.status).toBe(401);
  });

  it("mutação sem header X-CSRF-Token (mas com cookie CSRF) é bloqueada com 403", async () => {
    const usuario = await criarUsuarioTeste("sessoes-csrf");
    emailsCriados.push(usuario.email);
    const { cookies } = await loginTeste(usuario.email, usuario.senha);

    const resposta = await fetch(`${BASE_URL}/api/auth/sessoes`, {
      method: "DELETE",
      headers: {
        Cookie: `tokenAcesso=${cookies.tokenAcesso}; csrfToken=${cookies.csrfToken}`,
        // sem X-CSRF-Token de propósito
      },
    });

    expect(resposta.status).toBe(403);
  });
});
