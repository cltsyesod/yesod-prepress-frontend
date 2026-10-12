# Yesod Prepress AI

Sistema de pré-impressão (pré-RIP, independente de RIP): análise e correção de arquivos, montagem (nesting) e painéis (tiling), com interface em português.

- **Frontend** (esta pasta): React 19, Vite, TypeScript, Tailwind e shadcn/ui.
- **Backend** ([supabase/](supabase/)): banco, armazenamento e Edge Functions na Supabase.
- **Analisador** ([yesod-prepress-analyzer/](yesod-prepress-analyzer/)): serviço em Python que analisa e corrige os PDFs; tem README próprio.

## Desenvolvimento

Requer Node.js 18+ e um `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.

```bash
npm install
npm run dev      # http://localhost:8080
npm test         # testes (Vitest)
npm run lint     # oxlint
npm run build    # produção em dist/
```

Arquitetura, fluxos e convenções estão em [CLAUDE.md](CLAUDE.md).
