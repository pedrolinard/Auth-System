import { afterAll, describe, expect, it } from "vitest";
import { MAX_SESSOES_SIMULTANEAS } from "@/lib/sessao";
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

  it(`limita a ${MAX_SESSOES_SIMULTANEAS} sessões simultâneas, revogando a mais antiga`, async () => {
    const usuario = await criarUsuarioTeste("sessoes-limite");
    emailsCriados.push(usuario.email);

    const dispositivos = [];
    for (let i = 0; i < MAX_SESSOES_SIMULTANEAS; i++) {
      dispositivos.push(await loginTeste(usuario.email, usuario.senha));
    }

    const listaNoLimite = await (
      await fetch(`${BASE_URL}/api/auth/sessoes`, { headers: dispositivos[0].cabecalhos })
    ).json();
    expect(listaNoLimite.sessoes).toHaveLength(MAX_SESSOES_SIMULTANEAS);

    // Um login a mais estoura o limite — a sessão do dispositivo 0 (a mais
    // antiga) deve ser revogada automaticamente, e a contagem total continua
    // no limite (não MAX_SESSOES_SIMULTANEAS + 1).
    const dispositivoExtra = await loginTeste(usuario.email, usuario.senha);

    const listaDepoisDoExtra = await (
      await fetch(`${BASE_URL}/api/auth/sessoes`, { headers: dispositivoExtra.cabecalhos })
    ).json();
    expect(listaDepoisDoExtra.sessoes).toHaveLength(MAX_SESSOES_SIMULTANEAS);

    // Prova direta: o refresh token do dispositivo 0 não funciona mais.
    const atualizarDispositivo0 = await fetch(`${BASE_URL}/api/auth/atualizar`, {
      method: "POST",
      headers: dispositivos[0].cabecalhos,
    });
    expect(atualizarDispositivo0.status).toBe(401);
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
