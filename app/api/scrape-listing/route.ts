import { NextResponse } from "next/server";
import { isValidHttpUrl, normalizeListingDraft } from "../../listing-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

type ScrapeBody = {
  listingUrl?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

function mockListing(listingUrl: string) {
  const draft = normalizeListingDraft({
    title: "Apartamento T4 a venda na Estrada das Laranjeiras",
    pricing: "1.000.000€",
    description:
      "Apartamento T4 de luxo no Condominio Villas do Carmo, em Sete Rios/Avenidas Novas, com areas amplas, muita luz natural, varanda e estacionamento. Uma proposta indicada para clientes que procuram uma residencia premium em localizacao central.",
    sourceUrl: listingUrl,
    images: [
      "https://img4.idealista.pt/blur/WEB_DETAIL-L-L/0/id.pro.pt.image.master/a1/6f/33/318252830.jpg",
      "https://img4.idealista.pt/blur/WEB_DETAIL-L-L/0/id.pro.pt.image.master/44/df/20/318253241.jpg",
      "https://img4.idealista.pt/blur/WEB_DETAIL/0/id.pro.pt.image.master/2c/de/5f/318253212.webp",
      "https://st3.idealista.pt/static/common/release/detail/resources/img/loading.gif",
      "https://static.captcha-delivery.com/captcha/assets/set/logo.png"
    ]
  });

  return NextResponse.json(draft);
}

export async function POST(request: Request) {
  let body: ScrapeBody;

  try {
    body = (await request.json()) as ScrapeBody;
  } catch {
    return jsonError("Pedido inválido. Envie JSON com o link do anúncio.", 400);
  }

  if (!isValidHttpUrl(body.listingUrl)) {
    return jsonError("Use um link válido começado por http:// ou https://.", 400);
  }

  if (process.env.N8N_MOCK_SCRAPE === "true") {
    return mockListing(body.listingUrl);
  }

  const webhookUrl = process.env.N8N_SCRAPE_WEBHOOK_URL;

  if (!webhookUrl) {
    return jsonError("O webhook de importação do n8n ainda não está configurado.", 500);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ listingUrl: body.listingUrl }),
      signal: controller.signal
    });

    if (!n8nResponse.ok) {
      let message = "A automação não conseguiu importar o anúncio.";

      try {
        const payload = (await n8nResponse.json()) as { message?: unknown; error?: unknown };
        if (typeof payload.message === "string") {
          message = payload.message;
        } else if (typeof payload.error === "string") {
          message = payload.error;
        }
      } catch {
        // Keep the default message when n8n returns malformed JSON.
      }

      return jsonError(message, n8nResponse.status);
    }

    let payload: unknown;

    try {
      payload = await n8nResponse.json();
    } catch {
      return jsonError(
        "O webhook respondeu com sucesso, mas não devolveu JSON. Configure o n8n para responder com title, description e images.",
        502
      );
    }

    const draft = normalizeListingDraft(payload);

    if (!draft) {
      return jsonError(
        "O webhook devolveu JSON, mas não no formato esperado: title, description e images.",
        502
      );
    }

    return NextResponse.json(draft);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return jsonError("A importação do anúncio excedeu o tempo disponível.", 504);
    }

    return jsonError("Não foi possível contactar a automação de importação do n8n.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
