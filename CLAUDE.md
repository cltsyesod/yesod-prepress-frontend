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
4. A tela do trabalho ([src/pages/JobWorkspace.tsx](src/pages/JobWorkspace.tsx)) mostra as `analysis_issues` agrupadas por gravidade (bloqueia / precisa de decisão / informação) e grava as decisões do operador (`corrected`, `approved` com motivo = exceção aceita, `rejected` = devolver ao cliente, `ignored`).

**Correções automáticas:** as regras do analyzer anexam `fix` à ocorrência (`analysis_issues.fix`: `target` `pdf` ou `ticket`). Correções `ticket` (ex.: escala) só alteram a ficha e reanalisam. Correções `pdf` (`set_page_boxes`, `add_cut_contour`, `add_crop_marks`, em [app/fixes/engine.py](yesod-prepress-analyzer/app/fixes/engine.py)) chamam `start_analysis` com `fixes` e sem `jobId`: a Edge Function cria a cópia em `project_files` (`status = 'pending'`, `derived_from` = original) e o job; o analyzer corrige, envia a cópia por URL de upload assinada e analisa a cópia; `analysis_callback` a promove a principal ao concluir (ou a remove se falhar). O original nunca é alterado e "Voltar ao original" só troca o `is_primary`. As correções nunca reamostram imagens, convertem cores ou movem a arte.

**Interface:** duas telas principais. `/trabalhos` ([Queue.tsx](src/pages/Queue.tsx)) recebe o PDF + ficha do trabalho e lista os trabalhos; `/trabalhos/:id` é a tela do trabalho (PDF real num iframe com URL assinada + checklist). Além delas, só `/perfis` e `/configuracoes`. Um "trabalho" é uma linha de `projects`; [src/services/jobsService.ts](src/services/jobsService.ts) é a camada usada por essas telas e lê apenas a Supabase. Mantenha a interface enxuta: nada de dashboards, dados de demonstração ou telas que não ajudem o pré-impressor no dia a dia.

**Camadas do frontend:** `pages/` (rotas definidas em [src/App.tsx](src/App.tsx), todas atrás de `ProtectedRoute` + `Layout`, exceto `/login`) → `components/<feature>/` → `services/*Service.ts` → `lib/supabase/client.ts` (único client Supabase compartilhado). O estado de autenticação vem do `AuthProvider` em `hooks/use-auth.tsx`. Os tipos compartilhados ficam em [src/types/index.ts](src/types/index.ts). O alias de caminho `@` aponta para `src`.

**Perfis de produção ainda no navegador:** [profileService.ts](src/services/profileService.ts) usa `localStorage`; o perfil completo é enviado junto ao pedido de análise. A tabela `production_profiles` já existe na Supabase para a migração. `projectService` ainda tem fallback com `mockProjects` e só é usado pela tela de perfis.

**Variáveis de ambiente:** `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em `.env` / `.env.local`. Deploy na Vercel (rewrite de SPA em `vercel.json`). As Edge Functions usam `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANALYZER_URL`, `ANALYZER_INBOUND_SECRET` e `ANALYZER_CALLBACK_SECRET` (assinatura HMAC em [supabase/functions/_shared/analyzer.ts](supabase/functions/_shared/analyzer.ts)). Sem `ANALYZER_URL`, `start_analysis` marca o job como falho (`analyzer_not_configured`). `analysis_callback` é publicada com `--no-verify-jwt`. O analyzer roda na VPS Hostinger via Coolify (`docker-compose.coolify.yml`, branch `feat/backend-supabase-integration`) em `https://analyzer.yesodautomation.com.br`; [deploy/VPS.md](yesod-prepress-analyzer/deploy/VPS.md) descreve a alternativa com Caddy.

**Parâmetros de produção:** nunca fixe valores (larguras de material, espaçamentos, RIP, sangria, DPI, escala). Eles vêm do perfil de produção e da ficha técnica do trabalho (`projects.job_ticket`), definidos pelo operador; a ficha tem prioridade. O sistema é pré-RIP e independente de RIP.

## Convenções e armadilhas

- `.skip.config.json` lista arquivos (configs, lockfiles, `.env*`) marcados como proibidos para edição por IA pela ferramenta Skip; edite-os apenas quando a tarefa exigir.
- `vite-plugin-react-uid.js` só fica ativo no modo de desenvolvimento.
- Mudanças no banco vão em um novo arquivo numerado em `supabase/migrations/`; não edite migrations já aplicadas.
- O texto da UI e os termos de domínio (sangria, faca de corte, perfil de produção) estão em português; mantenha o novo texto em pt-BR.
