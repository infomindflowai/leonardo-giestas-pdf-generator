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
  "description": "Descricao editada",
  "images": ["https://...jpg"],
  "sourceUrl": "https://www.idealista.pt/imovel/..."
}
```

O n8n deve responder com:

- status `200`;
- header `Content-Type: application/pdf`;
- opcionalmente `Content-Disposition: attachment; filename="proposta-imovel.pdf"`.

Erros devem usar status nao-200 e JSON com uma mensagem, por exemplo:

```json
{ "message": "Nao foi possivel gerar o PDF." }
```
