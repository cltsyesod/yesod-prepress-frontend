# Yesod Prepress Analyzer

Serviço externo e determinístico de preflight para o Yesod Prepress AI. Ele
recebe jobs assinados do Skip Cloud, baixa uma URL privada temporária, executa
inspeções reais do PDF e devolve progresso, ocorrências e conclusão para o
callback existente.

Este diretório é independente do frontend React. O serviço **não** possui UI,
**não** persiste jobs/issues em banco e **não** utiliza IA. Skip Cloud continua
sendo a fonte de verdade.

## Verificações implementadas

- integridade estrutural com `qpdf --check`;
- abertura e renderização independente das páginas com PDFium;
- versão PDF e identificação PDF/X;
- MediaBox, CropBox, TrimBox, BleedBox, dimensões e rotação;
- medida real da sangria a partir de TrimBox e BleedBox;
- consistência de dimensões entre páginas;
- imagens XObject, espaço de cor, transparência e DPI efetivo em usos `cm/Do`;
- fontes incorporadas, subset, ToUnicode e validação TrueType/OpenType com fontTools;
- operadores vetoriais RGB/CMYK/Gray, spot colors e cobertura CMYK declarada;
- OutputIntent e validação do perfil ICC usando LittleCMS via Pillow ImageCms;
- Optional Content Groups (camadas) e nomes spot para faca de corte.

O analisador não inventa resultados quando uma propriedade não pode ser medida.
Por exemplo, DPI de imagens dentro de Form XObjects complexos permanece
desconhecido em vez de receber uma estimativa falsa. Regras adicionais podem ser
incluídas no registro sem alterar o contrato HTTP.

## Fluxo operacional

1. `POST /v1/jobs` valida HMAC, tolerância de horário e request ID sem replay.
2. Valkey registra idempotência e Celery enfileira o job.
3. O worker baixa o PDF para um diretório temporário com permissão `0700`.
4. O SHA-256 e tamanho assinados são validados quando informados.
5. O motor inspeciona o PDF e executa as regras habilitadas.
6. Callbacks HMAC são enviados com idempotência e retry limitado.
7. O arquivo e o diretório temporário são removidos ao final.

Valkey contém somente fila, estado operacional efêmero, idempotência e
cancelamento. Não substitui as coleções `analysis_jobs` e `analysis_issues`.

## Contrato de entrada

O corpo é compatível com os nomes camelCase já expostos pelo frontend:

```json
{
  "analysisId": "analysis-record-id",
  "projectId": "project-record-id",
  "fileId": "file-record-id",
  "versionId": "version-record-id",
  "downloadUrl": "https://private-files.example/signed.pdf?...",
  "fileSha256": "64-hex-characters",
  "fileSizeBytes": 123456,
  "productionProfile": {
    "id": "profile-record-id",
    "rules": [],
    "colorModeExpected": "CMYK",
    "minimumResolutionDpi": 300,
    "minimumBleedMm": 3,
    "minimumSafetyMarginMm": 3,
    "requiresCutLayer": false,
    "cutLayerNames": ["CutContour", "Corte"],
    "requirePdfX": false,
    "maximumInkCoveragePercent": 320
  },
  "callbackUrl": "https://skip.example/backend/v1/analyzer/callback"
}
```

Também é aceito o formato aninhado:

```json
"file": {
  "url": "https://private-files.example/signed.pdf?...",
  "sha256": "64-hex-characters",
  "sizeBytes": 123456,
  "filename": "arte.pdf"
}
```

O contrato recomendado pelo Skip Cloud também é aceito e normalizado para o
mesmo modelo interno:

```json
{
  "fileAccess": {
    "downloadUrl": "https://private-files.example/signed.pdf?...",
    "accessToken": null,
    "expiresAt": "2026-08-04T12:30:00Z",
    "expectedSha256": null,
    "expectedMimeType": "application/pdf",
    "maximumSizeBytes": 104857600
  },
  "callback": {
    "url": "https://skip.example/backend/v1/analyzer/callback"
  }
}
```

`expiresAt` precisa estar no futuro. `expectedMimeType` deve ser
`application/pdf`. O limite efetivo é o menor valor entre `maximumSizeBytes` e
`MAX_PDF_BYTES`. Quando `accessToken` é informado, ele é enviado somente no
header `Authorization: Bearer`; não é incluído em logs ou callbacks.

O arquivo privado deve ser fornecido por URL pré-assinada de curta duração. O
analisador não aceita credenciais embutidas na URL, segue zero redirects e
bloqueia destinos privados/loopback para reduzir SSRF.

### Assinatura da solicitação

Headers:

```text
X-Yesod-Timestamp: 1785800000
X-Yesod-Request-Id: 0198f8d0-unique-request-id
X-Yesod-Signature: sha256=<hex-hmac>
```

Assinatura:

```text
HMAC-SHA256(
  INBOUND_SIGNING_SECRET,
  timestamp + "." + request_id + "." + raw_request_body
)
```

O corpo deve ser assinado exatamente como transmitido. O relógio dos dois
serviços deve estar sincronizado por NTP. O request ID deve ter entre 8 e 128
caracteres seguros e nunca pode ser reutilizado dentro do TTL. O Valkey grava
somente o SHA-256 desse identificador, com TTL nunca inferior à tolerância da
assinatura. A mesma autenticação protege criação, cancelamento e consulta.

Resposta `202`:

```json
{
  "analysis_id": "analysis-record-id",
  "external_job_id": "celery-task-id",
  "status": "queued",
  "duplicate": false
}
```

Uma nova solicitação com o mesmo `analysisId` dentro do TTL retorna o mesmo job e
`duplicate: true`.

## Contrato de callback

Eventos: `progress`, `issues`, `completed`, `failed` e `cancelled`.

```json
{
  "contract_version": "2026-08-04",
  "event": "issues",
  "event_id": "evt-uuid",
  "analysisId": "analysis-record-id",
  "externalJobId": "celery-task-id",
  "sequence": 4,
  "timestamp": "2026-08-04T12:00:00Z",
  "status": "analyzing",
  "progress": 82,
  "currentStep": "Enviando ocorrências",
  "issues": [
    {
      "rule_code": "IMAGE_LOW_RESOLUTION",
      "title": "Imagem com baixa resolução",
      "category": "Imagem",
      "severity": "critical",
      "status": "pending",
      "page": 3,
      "object_id": "/Im1",
      "coordinates": "",
      "found_value": "149.8 dpi efetivos",
      "expected_value": "Mínimo 300 dpi",
      "description": "...",
      "recommendation": "...",
      "confidence": 100,
      "source": "pikepdf",
      "can_auto_correct": false
    }
  ],
  "summary": {},
  "errorCode": "",
  "errorMessage": ""
}
```

Headers enviados ao callback:

```text
X-Yesod-Timestamp
X-Yesod-Request-Id
X-Yesod-Signature
X-Yesod-Event-Id
Idempotency-Key
```

A assinatura usa o mesmo algoritmo com request ID, mas com
`CALLBACK_SIGNING_SECRET`. O callback deve deduplicar por `event_id`, respeitar
`sequence` e tratar HTTP `409` como evento já processado. O destino esperado é
`POST /backend/v1/analyzer/callback`.

## Configuração local

```bash
cd yesod-prepress-analyzer
cp .env.example .env
# edite os dois secrets e allowlists
docker compose up --build
```

Endpoints:

- `GET /health`: processo ativo;
- `GET /ready`: Valkey e qpdf disponíveis;
- `POST /v1/jobs`: cria job assinado;
- `DELETE /v1/jobs/{analysisId}`: solicita cancelamento assinado.
- `GET /v1/jobs/{externalJobId}`: consulta estado técnico assinado.

A consulta retorna exclusivamente:

```json
{
  "analysisId": "analysis-record-id",
  "externalJobId": "celery-task-id",
  "status": "analyzing",
  "progress": 70,
  "currentStep": "Aplicando regras de pré-impressão",
  "updatedAt": "2026-08-04T12:00:00Z"
}
```

`/ready` valida Valkey, qpdf, importação de pikepdf/PDFium e o mecanismo ICC
LittleCMS. Em produção, retorna somente disponibilidade booleana, sem versões.

O worker é separado da API para permitir escala independente.

## Testes

```bash
python -m venv .venv
. .venv/bin/activate
pip install -e '.[dev]'
pytest --cov=app
ruff check app tests scripts
```

Os testes Python não substituem o teste da imagem final, pois `qpdf` e
LittleCMS são dependências de sistema. Antes do deploy execute também:

```bash
docker compose build
docker compose run --rm api qpdf --version
docker compose run --rm api python -c "import pikepdf, pypdfium2, fontTools, PIL.ImageCms"
```

## Integração necessária no Skip Cloud

O backend existente precisa apenas trocar a fixture pelo `POST /v1/jobs`:

1. criar o registro em `analysis_jobs` como já faz;
2. gerar URL privada curta para o PDF;
3. enviar o contrato acima com HMAC e request ID único;
4. validar a assinatura de cada callback;
5. atualizar o job pelo `analysisId`;
6. inserir `issues` preservando os campos snake_case;
7. deduplicar `event_id` e ignorar sequências antigas.

Nenhuma chamada deve partir do navegador. Os dois secrets ficam somente no
backend do Skip e no ambiente do analisador.

## Segurança e produção

- use secrets diferentes para entrada e callback;
- configure `REQUEST_ID_TTL_SECONDS` igual ou acima da tolerância da assinatura;
- configure `ENVIRONMENT=production` para rejeitar secrets padrão;
- preencha `ALLOWED_DOWNLOAD_HOSTS` e `ALLOWED_CALLBACK_HOSTS`;
- limite CPU, memória, PIDs, disco temporário e tempo de execução no orquestrador;
- mantenha a API atrás de TLS e rate limiting;
- não registre query strings de URLs assinadas;
- execute como usuário sem privilégios e filesystem read-only;
- gere SBOM, escaneie a imagem e revise `THIRD_PARTY_LICENSES.md` a cada release.

## Fora do escopo

- UI ou alteração do frontend;
- recriação do backend Skip/PocketBase;
- banco de dados próprio;
- correção automática do PDF;
- Ghostscript, Poppler, MuPDF/PyMuPDF, Callas ou PitStop;
- modelos ou serviços de inteligência artificial.
