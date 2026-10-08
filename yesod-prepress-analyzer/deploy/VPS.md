# Publicar o analyzer na VPS (Hostinger KVM 2)

Resultado: `https://analyzer.seudominio.com.br` recebendo jobs da Supabase, com
HTTPS automático. Tempo estimado: 20 minutos.

## 1. DNS

No hPanel, em **Domínios → DNS**, crie um registro **A**:

| Nome | Aponta para |
|---|---|
| `analyzer` | IP da VPS |

Na **VPS → Firewall** do hPanel, libere as portas **22, 80 e 443**.

## 2. Na VPS (via SSH)

Se a VPS não tiver Docker (o template "Ubuntu com Docker" já tem):

```bash
curl -fsSL https://get.docker.com | sh
```

Baixe o projeto e configure:

```bash
git clone https://github.com/cltsyesod/yesod-prepress-frontend.git
cd yesod-prepress-frontend/yesod-prepress-analyzer
cp .env.example .env
openssl rand -hex 32   # rode duas vezes: um valor para cada segredo
nano .env              # preencha ANALYZER_DOMAIN e os dois segredos
```

O repositório é privado: o `git clone` pede seu usuário do GitHub e um
*personal access token* (GitHub → Settings → Developer settings → Tokens) no
lugar da senha.

Suba os serviços:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Teste (pode levar 1 minuto até o certificado ser emitido):

```bash
curl https://analyzer.seudominio.com.br/health
```

## 3. Na Supabase

Em **Project Settings → Edge Functions → Secrets**, cadastre:

| Secret | Valor |
|---|---|
| `ANALYZER_URL` | `https://analyzer.seudominio.com.br` |
| `ANALYZER_INBOUND_SECRET` | o mesmo `INBOUND_SIGNING_SECRET` do `.env` |
| `ANALYZER_CALLBACK_SECRET` | o mesmo `CALLBACK_SIGNING_SECRET` do `.env` |

Depois, no computador, na raiz do repositório:

```bash
supabase link --project-ref rfnckjmkfkphwnjpyhdz
supabase db push
supabase functions deploy start_analysis
supabase functions deploy analysis_callback --no-verify-jwt
```

`--no-verify-jwt` é necessário porque quem chama o callback é o analyzer, que
se autentica pela assinatura HMAC, e não por login da Supabase.

## Atualizar depois

```bash
cd yesod-prepress-frontend && git pull
cd yesod-prepress-analyzer
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Se algo falhar

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail=100
```

- **Job falha com `analyzer_rejected` (HTTP 401):** os segredos da VPS e da
  Supabase estão diferentes, ou o relógio da VPS está errado (`timedatectl`).
- **Job fica parado em "Na fila do analisador":** veja os logs do `worker`;
  normalmente é `ALLOWED_CALLBACK_HOSTS` ou `ALLOWED_DOWNLOAD_HOSTS` errado.
