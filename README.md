# CARE PDF Generator

MVP em Next.js para importar um anuncio imobiliario, rever titulo/descricao,
selecionar imagens e gerar um PDF atraves de webhooks privados do n8n.

## Desenvolvimento

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Criar `.env.local`:
   ```bash
   N8N_SCRAPE_WEBHOOK_URL=https://your-n8n-cloud-scrape-webhook-url
   N8N_PDF_WEBHOOK_URL=https://your-n8n-cloud-pdf-webhook-url
   N8N_MOCK_SCRAPE=false
   N8N_MOCK_PDF=false
   ```

3. Para testar sem n8n:
   ```bash
   N8N_MOCK_SCRAPE=true
   N8N_MOCK_PDF=true
   ```

4. Correr localmente:
   ```bash
   npm run dev
   ```

## Contrato do webhook de importacao

O site envia para `N8N_SCRAPE_WEBHOOK_URL`:

```json
{ "listingUrl": "https://www.idealista.pt/imovel/..." }
```

O n8n deve responder com JSON limpo:

```json
{
  "title": "Apartamento T4...",
  "pricing": "100000€",
  "description": "Descricao...",
  "images": ["https://...jpg", "https://...webp"],
  "sourceUrl": "https://www.idealista.pt/imovel/..."
}
```

O site filtra URLs invalidos e assets obvios de sistema, como `loading.gif`,
captcha, favicon e logos.

## Contrato do webhook de PDF

O site envia para `N8N_PDF_WEBHOOK_URL`:

```json
{
  "title": "Titulo editado",
  "pricing": "100000€",
  "description": "Descricao editada",
  "images": ["https://...jpg"],
  "sourceUrl": "https://www.idealista.pt/imovel/..."
}
```

O n8n pode responder de duas formas.

Opcao recomendada para fornecedores como PDFEndpoint: JSON com URL do PDF:

```json
{
  "pdfUrl": "https://storage.pdfendpoint.com/.../proposta-imovel.pdf"
}
```

Tambem sao aceites os campos `url` e `downloadUrl`.

Opcao alternativa: devolver diretamente o PDF em binario com:

- status `200`;
- header `Content-Type: application/pdf`;
- opcionalmente `Content-Disposition: attachment; filename="proposta-imovel.pdf"`.

Quando o n8n devolve um URL, a app descarrega esse PDF no backend e envia o
ficheiro ao browser como download.

Erros devem usar status nao-200 e JSON com uma mensagem, por exemplo:

```json
{ "message": "Nao foi possivel gerar o PDF." }
```

## Template HTML para o n8n

O ficheiro `templates/real-estate-dossier.html` contem um HTML A4 basico para
converter em PDF no n8n. O template aceita tanto payloads com os campos na raiz
(`$json.title`, `$json.pricing`, `$json.description`, `$json.images`) como
payloads recebidos pelo Webhook dentro de `body` (`$json.body.title`,
`$json.body.pricing`, `$json.body.description`, `$json.body.images`).

No n8n, cole este HTML no campo/template que gera o HTML antes da conversao para
PDF. As imagens sao renderizadas a partir do array `images`, usando a primeira
como imagem principal e as restantes numa galeria simples.
