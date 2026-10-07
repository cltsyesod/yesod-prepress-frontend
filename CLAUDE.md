# CLAUDE.md

Este arquivo fornece orientações ao Claude Code (claude.ai/code) ao trabalhar com o código deste repositório.

## Visão geral

Yesod Prepress AI: um dashboard de preflight de PDF com interface em português do Brasil (pt-BR). Este repositório contém três partes:

- **Frontend** (raiz do repositório): React 19 + Vite + TypeScript + Tailwind 3 + shadcn/ui (Radix). Gerado originalmente pelo Skip; `src/components/ui/` é boilerplate do shadcn.
- **Backend** ([supabase/](supabase/)): migrations do Postgres (`migrations/0001..0003`) e Edge Functions em Deno (`start_analysis`, `analysis_callback`).
- **Analyzer** ([yesod-prepress-analyzer/](yesod-prepress-analyzer/)): serviço independente e determinístico de preflight de PDF em Python (FastAPI + Celery + Valkey), com README, Dockerfile e testes próprios. Não faz parte do build do frontend.

## Comandos

Frontend (execute na raiz do repositório; existem `package-lock.json`, `pnpm-lock.yaml` e `bun.lockb`):

- `npm run dev` / `npm start` — servidor de desenvolvimento do Vite na porta 8080
- `npm run build` — build de produção em `dist/` (`build:dev` → `dev-dist/`)
- `npm run lint` — `oxlint src` (a categoria correctness está desativada em `.oxlintrc.json`); `npm run format` / `format:check` — oxfmt
- Não há test runner para o frontend (`npm test` é apenas um stub) nem script separado de typecheck; use `npx tsc -p tsconfig.app.json --noEmit` se necessário.

Analyzer (a partir de `yesod-prepress-analyzer/`, conforme [.github/workflows/prepress-analyzer-ci.yml](.github/workflows/prepress-analyzer-ci.yml)): `python -m pip install -e '.[dev]'`, `ruff check app tests scripts`, `pytest --cov=app` (um único teste: `pytest tests/<arquivo>::<nome>`). Requer `qpdf` e `liblcms2` instalados. O CI só é disparado por mudanças nesse diretório.

## Arquitetura

**Pipeline de análise (abrange vários arquivos):**
1. O frontend chama a Edge Function `start_analysis` ([supabase/functions/start_analysis/index.ts](supabase/functions/start_analysis/index.ts)), que autentica o usuário, cria uma linha em `analysis_jobs` e envia um job assinado ao analyzer (`ANALYZER_URL`).
2. O analyzer baixa o PDF por uma URL assinada temporária, executa as regras e envia callbacks de progresso/conclusão assinados com HMAC para `analysis_callback`, que grava o status do job e os `analysis_issues` usando a service role.
3. O frontend acompanha o job por [src/hooks/use-analysis-job.ts](src/hooks/use-analysis-job.ts) (realtime do Supabase via `use-realtime.ts` mais polling de fallback a cada 10s). Estados finais: `completed`, `completed_with_warnings`, `failed`, `cancelled`.
4. [src/lib/issueMapper.ts](src/lib/issueMapper.ts) / [analysisHelpers.ts](src/lib/analysisHelpers.ts) convertem as linhas de issues do banco para o formato `AnalysisProblem` usado pela UI.

**Camadas do frontend:** `pages/` (rotas definidas em [src/App.tsx](src/App.tsx), todas atrás de `ProtectedRoute` + `Layout`, exceto `/login`) → `components/<feature>/` → `services/*Service.ts` → `lib/supabase/client.ts` (único client Supabase compartilhado). O estado de autenticação vem do `AuthProvider` em `hooks/use-auth.tsx`. Os tipos compartilhados ficam em [src/types/index.ts](src/types/index.ts). O alias de caminho `@` aponta para `src`.

**Dados reais e mock misturados:** Os services estão no meio da migração de localStorage + mocks para o Supabase. Alguns (por exemplo `projectService` e `analysisService`) ainda importam `mockProjects`/`mockData` e persistem em `localStorage` (`yesod-projects`, `yesod-analysis-problems`) junto com chamadas ao Supabase. Verifique qual caminho um service realmente usa antes de alterá-lo. `VITE_ENABLE_ANALYZER_DEV_FIXTURE` habilita [src/lib/devFixture.ts](src/lib/devFixture.ts), que simula progresso e issues do analyzer sem o serviço real.

**Variáveis de ambiente:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_ENABLE_ANALYZER_DEV_FIXTURE` em `.env` / `.env.local`. Deploy na Vercel (rewrite de SPA em `vercel.json`). As Edge Functions usam `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANALYZER_URL`, `ANALYZER_INBOUND_SECRET` e `ANALYZER_CALLBACK_SECRET` (assinatura HMAC em [supabase/functions/_shared/analyzer.ts](supabase/functions/_shared/analyzer.ts)). Sem `ANALYZER_URL`, `start_analysis` roda só uma verificação simplificada de cores especiais (útil apenas em desenvolvimento). `analysis_callback` é publicada com `--no-verify-jwt`. O analyzer roda numa VPS com Docker + Caddy; o passo a passo está em [yesod-prepress-analyzer/deploy/VPS.md](yesod-prepress-analyzer/deploy/VPS.md).

**Parâmetros de produção:** nunca fixe valores (larguras de material, espaçamentos, RIP, sangria, DPI, escala). Eles vêm do perfil de produção e da ficha técnica do trabalho (`projects.job_ticket`), definidos pelo operador; a ficha tem prioridade. O sistema é pré-RIP e independente de RIP.

## Convenções e armadilhas

- `.skip.config.json` lista arquivos (configs, lockfiles, `.env*`) marcados como proibidos para edição por IA pela ferramenta Skip; edite-os apenas quando a tarefa exigir.
- `vite-plugin-react-uid.js` só fica ativo no modo de desenvolvimento.
- Mudanças no banco vão em um novo arquivo numerado em `supabase/migrations/`; não edite migrations já aplicadas.
- O texto da UI e os termos de domínio (sangria, faca de corte, perfil de produção) estão em português; mantenha o novo texto em pt-BR.
