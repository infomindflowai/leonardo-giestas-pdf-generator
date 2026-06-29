import { NextResponse } from "next/server";
import { isValidHttpUrl, normalizeFeatures, normalizeImageUrls } from "../../listing-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

type GeneratePdfBody = {
  title?: unknown;
  pricing?: unknown;
  features?: unknown;
  description?: unknown;
  images?: unknown;
  sourceUrl?: unknown;
};

type PdfPayload = {
  title: string;
  pricing?: string;
  features: string[];
  description: string;
  images: string[];
  sourceUrl?: string;
};

type ValidationResult = { error: string } | { payload: PdfPayload };

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

function safeContentDisposition(disposition: string | null) {
  if (!disposition) {
    return 'attachment; filename="proposta-imovel.pdf"';
  }

  return disposition;
}

function filenameFromTitle(title: string) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  return `${slug || "proposta-imovel"}.pdf`;
}

function pdfResponse(pdf: ArrayBuffer, contentDisposition: string | null) {
  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": safeContentDisposition(contentDisposition),
      "Cache-Control": "no-store"
    }
  });
}

async function getPdfUrlFromJson(response: Response) {
  try {
    const payload = (await response.json()) as {
      pdfUrl?: unknown;
      url?: unknown;
      downloadUrl?: unknown;
    };

    const url =
      typeof payload.pdfUrl === "string"
        ? payload.pdfUrl
        : typeof payload.url === "string"
          ? payload.url
          : typeof payload.downloadUrl === "string"
            ? payload.downloadUrl
            : "";

    return isValidHttpUrl(url) ? url : null;
  } catch {
    return null;
  }
}

function mockPdf() {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 105 >>
stream
BT
/F1 22 Tf
72 760 Td
(CARE PDF Generator) Tj
0 -34 Td
(PDF de teste gerado com selecao de imagens.) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000242 00000 n 
0000000398 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
468
%%EOF`;

  return new Response(pdf, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="proposta-imovel-teste.pdf"',
      "Cache-Control": "no-store"
    }
  });
}

function contentDispositionFromTitle(title: string) {
  return `attachment; filename="${filenameFromTitle(title)}"`;
}

function validatePayload(body: GeneratePdfBody): ValidationResult {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const pricing = typeof body.pricing === "string" ? body.pricing.trim() : "";
  const features = normalizeFeatures(body.features);
  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const images = normalizeImageUrls(body.images);
  const sourceUrl =
    typeof body.sourceUrl === "string" && isValidHttpUrl(body.sourceUrl)
      ? body.sourceUrl
      : undefined;

  if (!title) {
    return { error: "Adicione um titulo antes de gerar o PDF." };
  }

  if (!description) {
    return { error: "Adicione uma descricao antes de gerar o PDF." };
  }

  if (images.length === 0) {
    return { error: "Selecione pelo menos uma imagem valida para gerar o PDF." };
  }

  return {
    payload: {
      title,
      pricing: pricing || undefined,
      features,
      description,
      images,
      sourceUrl
    }
  };
}

export async function POST(request: Request) {
  let body: GeneratePdfBody;

  try {
    body = (await request.json()) as GeneratePdfBody;
  } catch {
    return jsonError("Pedido inválido. Envie JSON com título, descrição e imagens.", 400);
  }

  const validated = validatePayload(body);

  if ("error" in validated) {
    return jsonError(validated.error, 400);
  }

  if (process.env.N8N_MOCK_PDF === "true") {
    return mockPdf();
  }

  const webhookUrl = process.env.N8N_PDF_WEBHOOK_URL;

  if (!webhookUrl) {
    return jsonError("O webhook de PDF do n8n ainda não está configurado.", 500);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);

  try {
    const n8nResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf, application/json"
      },
      body: JSON.stringify(validated.payload),
      signal: controller.signal
    });

    const contentType = n8nResponse.headers.get("content-type") ?? "";

    if (!n8nResponse.ok) {
      let message = "A automação não conseguiu gerar o PDF.";

      if (contentType.toLowerCase().includes("application/json")) {
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
      }

      return jsonError(message, n8nResponse.status);
    }

    if (contentType.toLowerCase().includes("application/pdf")) {
      const pdf = await n8nResponse.arrayBuffer();

      return pdfResponse(
        pdf,
        contentDispositionFromTitle(validated.payload.title)
      );
    }

    if (contentType.toLowerCase().includes("application/json")) {
      const pdfUrl = await getPdfUrlFromJson(n8nResponse);

      if (!pdfUrl) {
        return jsonError(
          "A automação respondeu, mas não devolveu um URL de PDF válido.",
          502
        );
      }

      const pdfResponseFromUrl = await fetch(pdfUrl, {
        headers: {
          Accept: "application/pdf"
        },
        signal: controller.signal
      });

      const pdfContentType = pdfResponseFromUrl.headers.get("content-type") ?? "";

      if (
        !pdfResponseFromUrl.ok ||
        !pdfContentType.toLowerCase().includes("application/pdf")
      ) {
        return jsonError("Não foi possível descarregar o PDF gerado.", 502);
      }

      const pdf = await pdfResponseFromUrl.arrayBuffer();

      return pdfResponse(
        pdf,
        contentDispositionFromTitle(validated.payload.title)
      );
    }

    return jsonError(
      "A automação respondeu, mas não devolveu um PDF nem um URL de PDF.",
      502
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return jsonError("A geração do PDF excedeu o tempo disponível.", 504);
    }

    return jsonError("Não foi possível contactar a automação de PDF do n8n.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
