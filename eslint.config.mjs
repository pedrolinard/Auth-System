import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores de eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Distdirs alternativos usados só pelos testes (ver next.config.ts e
    // playwright.config.ts) — servidores `next dev`/`next build` à parte
    // pra Vitest (.next-test) e Playwright (.next-e2e), fora do padrão
    // ".next/**" acima por não ficarem aninhados nele. Sem isso, bundle
    // compilado (JS minificado/gerado) acaba sendo varrido como se fosse
    // código-fonte.
    ".next-test/**",
    ".next-e2e/**",
    // django/ é um projeto Python à parte (serviço de domínio) — sem isso,
    // django/venv/** (virtualenv local, fora do controle de versão) acaba
    // sendo varrido também, incluindo JS vendorizado de dependências Python
    // (ex.: django-rest-framework) que nunca deveria passar por este ESLint.
    "django/**",
  ]),
]);

export default eslintConfig;
