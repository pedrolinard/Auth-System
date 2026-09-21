// Ponto de entrada da raiz do pacote: SÓ o cliente.
//
// O verificador de token vive em "@grupocz/auth-gateway-sdk/servidor" e não é
// reexportado aqui de propósito. Ele importa `jose`, que é peer dependency
// OPCIONAL (só o backend verifica token). Se a raiz reexportasse o
// verificador, uma aplicação de navegador que fizesse o import mais óbvio —
// `from "@grupocz/auth-gateway-sdk"` — quebraria no bundler com "Can't
// resolve 'jose'" sem nunca ter pedido um verificador. `sideEffects: false`
// não salva: o bundler precisa RESOLVER o import antes de poder descartá-lo.
export {
  armazenamentoEmMemoria,
  ClienteAuthGateway,
  ErroAuthGateway,
  type ArmazenamentoTokens,
  type OpcoesCliente,
  type ResultadoLogin,
  type Tokens,
  type Usuario,
} from "./cliente.js";
