// Cliente do provedor de autenticação para as aplicações que integram com ele.
//
// Funciona no navegador e no Node (usa só `fetch`). Diferente do painel deste
// projeto, que roda na mesma origem do provedor e usa cookies httpOnly, uma
// aplicação cliente vive em OUTRO domínio: cookies do provedor não chegam lá.
// Por isso o SDK trabalha com os tokens no corpo das respostas e manda o
// access token no header Authorization.

export type Tokens = {
  tokenAcesso: string;
  tokenAtualizacao: string;
};

// Onde os tokens ficam guardados. O padrão é só memória (some ao recarregar a
// página) — a opção mais segura contra XSS. Guardar em localStorage é decisão
// da aplicação, que assume o risco: um script injetado lê o que estiver lá.
export interface ArmazenamentoTokens {
  ler(): Tokens | null | Promise<Tokens | null>;
  gravar(tokens: Tokens | null): void | Promise<void>;
}

export function armazenamentoEmMemoria(): ArmazenamentoTokens {
  let atual: Tokens | null = null;
  return {
    ler: () => atual,
    gravar: (tokens) => {
      atual = tokens;
    },
  };
}

export type OpcoesCliente = {
  /** URL do provedor, ex.: "https://auth.suaempresa.com.br". */
  urlBase: string;
  /** Client ID público da aplicação (painel → Aplicações). */
  clientId: string;
  /**
   * Client secret — SÓ em código de servidor. No navegador ele fica visível
   * pra qualquer um; ali quem autentica a aplicação é a origem cadastrada.
   */
  clientSecret?: string;
  /**
   * IP do usuário final, SÓ em código de servidor e junto do clientSecret.
   * Sem ele, todos os usuários chegam ao provedor com o IP do seu backend e
   * dividem o mesmo limite de tentativas e o mesmo limiar de captcha. Crie um
   * cliente por requisição do usuário para informar o IP dele.
   */
  ipUsuarioFinal?: string;
  armazenamento?: ArmazenamentoTokens;
  fetch?: typeof fetch;
};

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  emailVerificado: boolean;
  mfaAtivado: boolean;
  organizacaoId: string;
  papelOrganizacao: "dono" | "admin" | "membro";
};

export type ResultadoLogin =
  | { mfaObrigatorio: false; usuario: { id: string; nome: string; email: string } }
  | { mfaObrigatorio: true; mfaToken: string };

export class ErroAuthGateway extends Error {
  constructor(
    mensagem: string,
    readonly status: number,
    readonly captchaNecessario = false,
    /** Sitekey pública pra renderizar o widget do Turnstile quando `captchaNecessario`. */
    readonly turnstileSiteKey: string | null = null,
    /**
     * A renovação foi recusada porque a aplicação é um cliente confidencial e
     * a chamada veio sem o client secret (típico: SDK no navegador sem marcar
     * "Cliente público" no painel).
     */
    readonly clienteConfidencial = false,
  ) {
    super(mensagem);
    this.name = "ErroAuthGateway";
  }
}

type CorpoErro = {
  erro?: string;
  captchaNecessario?: boolean;
  clienteConfidencial?: boolean;
  turnstileSiteKey?: string | null;
  detalhes?: { fieldErrors?: Record<string, string[]> };
};

export class ClienteAuthGateway {
  private readonly urlBase: string;
  private readonly armazenamento: ArmazenamentoTokens;
  private readonly fetch: typeof fetch;
  private renovacaoEmAndamento: Promise<boolean> | null = null;
  private avisouClienteConfidencial = false;

  constructor(private readonly opcoes: OpcoesCliente) {
    this.urlBase = opcoes.urlBase.replace(/\/+$/, "");
    this.armazenamento = opcoes.armazenamento ?? armazenamentoEmMemoria();
    this.fetch = opcoes.fetch ?? globalThis.fetch.bind(globalThis);
    if (opcoes.clientSecret && typeof window !== "undefined") {
      // Não impede (pode ser um teste), mas avisa alto: é o erro de integração
      // mais caro de descobrir depois.
      console.warn("[auth-gateway] clientSecret no navegador fica exposto — use-o só no servidor.");
    }
  }

  private cabecalhos(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-aplicacao-id": this.opcoes.clientId,
      ...(this.opcoes.clientSecret ? { "x-aplicacao-segredo": this.opcoes.clientSecret } : {}),
      ...(this.opcoes.clientSecret && this.opcoes.ipUsuarioFinal
        ? { "x-usuario-ip": this.opcoes.ipUsuarioFinal }
        : {}),
      ...extra,
    };
  }

  private async postar(caminho: string, corpo: unknown, extra: Record<string, string> = {}) {
    const resposta = await this.fetch(`${this.urlBase}${caminho}`, {
      method: "POST",
      headers: this.cabecalhos(extra),
      body: JSON.stringify(corpo ?? {}),
    });
    const dados = (await resposta.json().catch(() => ({}))) as Record<string, unknown> & CorpoErro;
    if (!resposta.ok) {
      const primeiroCampo = Object.values(dados.detalhes?.fieldErrors ?? {}).find((m) => m.length > 0);
      throw new ErroAuthGateway(
        primeiroCampo?.[0] ?? dados.erro ?? `Falha na requisição (${resposta.status}).`,
        resposta.status,
        dados.captchaNecessario === true,
        dados.turnstileSiteKey ?? null,
        dados.clienteConfidencial === true,
      );
    }
    return dados;
  }

  private async guardarSessao(dados: Record<string, unknown>) {
    await this.armazenamento.gravar({
      tokenAcesso: dados.tokenAcesso as string,
      tokenAtualizacao: dados.tokenAtualizacao as string,
    });
  }

  /** Cria a conta. A resposta é a mesma exista ou não o e-mail (anti-enumeração). */
  async cadastrar(dados: { nome: string; email: string; senha: string; turnstileToken?: string }) {
    await this.postar("/api/auth/cadastro", dados);
  }

  async entrar(dados: { email: string; senha: string; turnstileToken?: string }): Promise<ResultadoLogin> {
    const corpo = await this.postar("/api/auth/login", dados);
    if (corpo.mfaObrigatorio) {
      return { mfaObrigatorio: true, mfaToken: corpo.mfaToken as string };
    }
    await this.guardarSessao(corpo);
    return { mfaObrigatorio: false, usuario: corpo.usuario as { id: string; nome: string; email: string } };
  }

  /** Segundo passo do login com o código de 6 dígitos do autenticador. */
  async concluirMfa(dados: { mfaToken: string; codigo: string }) {
    await this.guardarSessao(await this.postar("/api/auth/mfa/verificar", dados));
  }

  /** Segundo passo com um código de backup, pra quem perdeu o autenticador. */
  async concluirMfaComCodigoBackup(dados: { mfaToken: string; codigo: string }) {
    const corpo = await this.postar("/api/auth/mfa/backup", dados);
    await this.guardarSessao(corpo);
    return { codigosBackupRestantes: corpo.codigosBackupRestantes as number };
  }

  /** Pede o e-mail de redefinição de senha. Sempre responde igual. */
  async esqueciSenha(email: string) {
    await this.postar("/api/auth/esqueci-senha", { email });
  }

  // As quatro ações abaixo concluem os links enviados por e-mail. Só são
  // necessárias quando a aplicação configurou "Endereço dos links" no painel
  // e hospeda essas páginas no próprio site; o token vem na query string
  // (`?token=`) e já identifica a conta.

  /** Página /verificar-email. */
  async verificarEmail(token: string) {
    await this.postar("/api/auth/verificar-email", { token });
  }

  /** Página /redefinir-senha. Encerra todas as sessões da conta. */
  async redefinirSenha(token: string, novaSenha: string) {
    await this.postar("/api/auth/redefinir-senha", { token, novaSenha });
  }

  /** Página /confirmar-alteracao-email. Encerra todas as sessões da conta. */
  async confirmarAlteracaoEmail(token: string): Promise<{ novoEmail: string }> {
    const corpo = await this.postar("/api/auth/confirmar-alteracao-email", { token });
    return { novoEmail: corpo.novoEmail as string };
  }

  /**
   * Página /aceitar-convite. Exige sessão: a pessoa precisa estar logada com
   * a conta do e-mail convidado. Entra direto na organização do convite.
   */
  async aceitarConvite(token: string) {
    const resposta = await this.requisicao("/api/auth/organizacoes/aceitar-convite", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as Record<string, unknown> & CorpoErro;
    if (!resposta.ok) {
      throw new ErroAuthGateway(corpo.erro ?? `Falha na requisição (${resposta.status}).`, resposta.status);
    }
    await this.guardarSessao(corpo);
  }

  /**
   * Troca o refresh token por um par novo. O provedor aceita cada refresh
   * token uma única vez, então as renovações são serializadas: chamadas
   * simultâneas na mesma instância compartilham uma só, e instâncias que
   * dividem o mesmo armazenamento (várias abas com localStorage) fazem fila
   * pela Web Locks API quando ela existe.
   *
   * `tokenAtualizacaoVisto` é o token com que o chamador falhou; se outra aba
   * já trocou o par nesse meio-tempo, não renova de novo — só usa o novo.
   */
  async renovar(tokenAtualizacaoVisto?: string): Promise<boolean> {
    if (!this.renovacaoEmAndamento) {
      this.renovacaoEmAndamento = (async () => {
        const visto = tokenAtualizacaoVisto ?? (await this.armazenamento.ler())?.tokenAtualizacao;
        if (!visto) return false;
        return this.comTravaDeRenovacao(async () => {
          const atuais = await this.armazenamento.ler();
          if (!atuais) return false;
          if (atuais.tokenAtualizacao !== visto) return true;
          try {
            await this.guardarSessao(
              await this.postar("/api/auth/atualizar", { tokenAtualizacao: atuais.tokenAtualizacao }),
            );
            return true;
          } catch (erro) {
            if (erro instanceof ErroAuthGateway && erro.status === 401 && erro.clienteConfidencial) {
              // Erro de integração, não de sessão: o token continua válido.
              // Não apaga nada; avisa uma vez com o que fazer.
              if (!this.avisouClienteConfidencial) {
                this.avisouClienteConfidencial = true;
                console.warn(`[auth-gateway] ${erro.message}`);
              }
              return false;
            }
            if (erro instanceof ErroAuthGateway && erro.status === 401) {
              // Só esquece a sessão se ninguém gravou um par novo enquanto
              // esta renovação estava no ar — senão apagaria o par que outra
              // aba acabou de receber e deslogaria as duas.
              const agora = await this.armazenamento.ler();
              if (agora && agora.tokenAtualizacao !== atuais.tokenAtualizacao) return true;
              await this.armazenamento.gravar(null);
              return false;
            }
            throw erro;
          }
        });
      })().finally(() => {
        this.renovacaoEmAndamento = null;
      });
    }
    return this.renovacaoEmAndamento;
  }

  private async comTravaDeRenovacao<T>(executar: () => Promise<T>): Promise<T> {
    const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
    if (!locks?.request) return executar();
    return locks.request(`auth-gateway:renovar:${this.opcoes.clientId}`, executar) as Promise<T>;
  }

  /** Encerra a sessão no provedor (revoga o refresh token) e apaga os tokens locais. */
  async sair() {
    const tokens = await this.armazenamento.ler();
    await this.armazenamento.gravar(null);
    if (!tokens) return;
    await this.postar("/api/auth/logout", { tokenAtualizacao: tokens.tokenAtualizacao }).catch(() => {
      // Sair precisa funcionar do lado do usuário mesmo com o provedor fora do
      // ar; o refresh token expira sozinho em até 30 dias.
    });
  }

  /**
   * Requisição autenticada a qualquer rota do provedor, com o access token no
   * header e uma renovação automática se ele tiver expirado.
   */
  async requisicao(caminho: string, init: RequestInit = {}, jaRenovou = false): Promise<Response> {
    const tokens = await this.armazenamento.ler();
    const resposta = await this.fetch(`${this.urlBase}${caminho}`, {
      ...init,
      headers: {
        ...this.cabecalhos(),
        ...(tokens ? { Authorization: `Bearer ${tokens.tokenAcesso}` } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
    if (resposta.status === 401 && tokens && !jaRenovou && (await this.renovar(tokens.tokenAtualizacao))) {
      return this.requisicao(caminho, init, true);
    }
    return resposta;
  }

  /** O usuário da sessão atual, ou null se não houver sessão válida. */
  async usuarioAtual(): Promise<Usuario | null> {
    const resposta = await this.requisicao("/api/auth/me");
    if (!resposta.ok) return null;
    const corpo = (await resposta.json()) as { usuario: Usuario };
    return corpo.usuario;
  }
}
