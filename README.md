# CARE PDF Generator

Aplicação em Next.js para importar um anúncio imobiliário, produzir o conteúdo
em português ou inglês, rever título/descrição/características, selecionar
imagens e gerar um dossier PDF através de webhooks privados do n8n.

## Fluxo funcional

1. O utilizador escolhe o consultor e o idioma do PDF. Os valores iniciais são
   Leonardo Giestas e Português.
2. Ao importar o anúncio, a app envia o URL e `Linguagem` ao webhook de
   importação.
3. O workflow do n8n recolhe os dados do anúncio e devolve `title`, `features` e
   `description` no idioma selecionado, juntamente com preço e imagens.
4. O utilizador revê o conteúdo, ordena as fotografias e escolhe quais devem
   entrar no dossier.
5. Ao gerar o PDF, a app envia o conteúdo revisto, as imagens, o consultor e o
   idioma ao webhook de PDF.
6. O n8n prepara as imagens como data URLs em base64 e incorpora-as diretamente
   no template HTML.
7. O PDF.co converte o HTML em PDF e comprime o ficheiro.
8. O n8n responde à aplicação com o URL do PDF final para iniciar o download.

## Desenvolvimento

1. Instalar dependências:
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

## Contrato do webhook de importação

O site envia para `N8N_SCRAPE_WEBHOOK_URL`:

```json
{
  "listingUrl": "https://www.idealista.pt/imovel/...",
  "Linguagem": "Português"
}
```

`Linguagem` aceita apenas `Português` ou `Inglês`. O workflow de importação deve
usar este valor no prompt do agente e devolver `title`, `features` e
`description` no idioma selecionado.

O n8n deve responder com JSON limpo:

```json
{
  "title": "Apartamento T4...",
  "pricing": "100000€",
  "features": ["Área: 78 m²", "Tipologia: T2"],
  "description": "Descrição com um ou vários parágrafos...",
  "images": ["https://...jpg", "https://...webp"],
  "sourceUrl": "https://www.idealista.pt/imovel/..."
}
```

Os nomes dos campos devem permanecer em inglês e minúsculas, mesmo quando o
conteúdo estiver em português: `title`, `pricing`, `features`, `description`,
`images` e `sourceUrl`.

No node **Respond to Webhook**, use `Respond With: JSON` e construa a resposta
com `JSON.stringify()` para escapar corretamente parágrafos, aspas e outros
caracteres da descrição:

```javascript
{{ JSON.stringify({
  title: $json.title,
  description: $json.description,
  images: $json.images,
  sourceUrl: $json.sourceUrl,
  pricing: $json.pricing,
  features: $json.features
}) }}
```

Adapte os caminhos caso o output do agente esteja, por exemplo, dentro de
`$json.output`.

O site filtra URLs inválidos e assets óbvios de sistema, como `loading.gif`,
captcha, favicon e logos.

## Contrato do webhook de PDF

O site envia para `N8N_PDF_WEBHOOK_URL`:

```json
{
  "title": "Título editado",
  "pricing": "100000€",
  "features": ["Área: 78 m²", "Tipologia: T2"],
  "description": "Descrição editada",
  "images": ["https://...jpg"],
  "sourceUrl": "https://www.idealista.pt/imovel/...",
  "Nome": "Leonardo Giestas",
  "Telefone": "913 740 456",
  "Linguagem": "Português"
}
```

Os valores aceites para `Nome` e `Telefone` são os pares:

- `Leonardo Giestas` / `913 740 456`;
- `Rogner Vieira` / `966 490 870`.

`Linguagem` aceita apenas `Português` ou `Inglês`. Nesta fase, `title`,
`features` e `description` já chegam no idioma correto, porque foram produzidos
pelo workflow de importação. O workflow de PDF apenas precisa de aplicar os
rótulos fixos correspondentes e renderizar o HTML.

O n8n pode responder de duas formas.

Opção utilizada com o PDF.co: JSON com o URL do PDF final já comprimido:

```json
{
  "downloadUrl": "https://pdf-temp-files.s3.us-west-2.amazonaws.com/.../proposta-imovel.pdf"
}
```

A aplicação aceita os campos `pdfUrl`, `url` ou `downloadUrl`.

Opção alternativa: devolver diretamente o PDF em binário com:

- status `200`;
- header `Content-Type: application/pdf`;
- opcionalmente `Content-Disposition: attachment; filename="proposta-imovel.pdf"`.

Quando o n8n devolve um URL, a app descarrega esse PDF no backend e envia o
ficheiro ao browser como download.

### Pipeline do PDF.co no n8n

O workflow de geração segue esta sequência:

1. recebe o payload do webhook com o conteúdo e as imagens selecionadas;
2. prepara as imagens no formato `data:image/...;base64,...`;
3. incorpora essas imagens diretamente nas tags `<img>` do template HTML,
   preservando a ordem das fotografias;
4. usa a primeira imagem na capa e distribui as restantes pela galeria;
5. converte o HTML em PDF através do PDF.co;
6. comprime o PDF através da API do PDF.co;
7. devolve à aplicação o URL do ficheiro comprimido.

O workflow não faz upload individual das imagens para o armazenamento do
PDF.co. As imagens seguem incorporadas no próprio HTML em base64, reduzindo o
número de operações e os créditos consumidos. O passo de compressão ocorre
depois da conversão do HTML para PDF.

A rota `/api/generate-pdf` aguarda até quatro minutos pela conclusão do n8n. A
função está configurada com uma duração máxima de cinco minutos e o browser
mantém o pedido aberto durante quatro minutos e meio. Durante a geração, o
estado e eventuais erros aparecem junto ao botão **Gerar PDF**.

A chave da API do PDF.co deve ficar configurada nas credenciais do n8n e nunca
diretamente no HTML, no repositório ou nos campos públicos do webhook.

Erros devem usar status não-200 e JSON com uma mensagem, por exemplo:

```json
{ "message": "Não foi possível gerar o PDF." }
```

## Template HTML para o n8n

O ficheiro `templates/real-estate-dossier.html` contém o HTML A4 final para
converter em PDF no n8n. O template aceita tanto payloads com os campos na raiz
(`$json.title`, `$json.pricing`, `$json.description`, `$json.images`) como
payloads recebidos pelo Webhook dentro de `body` (`$json.body.title`,
`$json.body.pricing`, `$json.body.description`, `$json.body.images`).

O template também usa `Nome`, `Telefone` e `Linguagem`, procurando todos os
campos no item atual ou, como fallback, no `body` do node `Webhook1`. Se o node
tiver outro nome, substitua `Webhook1` no HTML.

Comportamento do template:

- traduz os rótulos fixos entre português e inglês;
- apresenta o nome e o telefone do consultor selecionado;
- acrescenta `+351` ao telefone apenas na apresentação visual;
- usa a primeira imagem como imagem principal da capa;
- distribui as restantes imagens em grupos de quatro por página;
- repete o logótipo da agência em cada página criada;
- preserva o título, preço, características e descrição recebidos do webhook.

No fluxo atual, o array `images` contém data URLs em base64. O template utiliza
essas strings diretamente nos atributos `src` das tags `<img>`, sem fazer upload
prévio das fotografias para o PDF.co.

No n8n, cole este HTML no campo que gera o conteúdo antes da conversão pelo
PDF.co. Os restantes dados continuam a ser lidos do item atual ou do node
`Webhook1`; se o webhook tiver outro nome, é necessário atualizar essa referência
no template.

## Validação no backend

Antes de contactar o n8n, a aplicação valida:

- URLs HTTP/HTTPS;
- presença de título, descrição e pelo menos uma imagem válida;
- idioma limitado a `Português` ou `Inglês`;
- correspondência exata entre o nome e o telefone de um consultor permitido.

Erros de validação devolvem status `400`. Falhas de comunicação ou respostas
inválidas do n8n devolvem um status `5xx` com uma mensagem em JSON.
