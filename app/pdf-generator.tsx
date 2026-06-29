"use client";

import { FormEvent, useMemo, useState } from "react";

type Stage = "empty" | "editing";
type BusyState = "idle" | "scraping" | "generating";
type MessageTone = "neutral" | "success" | "error";

type ListingResponse = {
  title: string;
  pricing?: string;
  features?: string[];
  description: string;
  images: string[];
  sourceUrl?: string;
};

type GalleryImage = {
  id: string;
  url: string;
  selected: boolean;
  broken: boolean;
};

function isValidHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function filenameFromDisposition(disposition: string | null) {
  if (!disposition) {
    return null;
  }

  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1].replaceAll('"', ""));
  }

  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] ?? null;
}

function createGalleryImages(images: string[]) {
  return images.map((url, index) => ({
    id: `${index}-${url}`,
    url,
    selected: index < 8,
    broken: false
  }));
}

function featuresToText(features: string[] | undefined) {
  return Array.isArray(features) ? features.filter(Boolean).join("\n") : "";
}

function textToFeatures(value: string) {
  return value
    .split("\n")
    .map((feature) => feature.replace(/^•\s*/, "").trim())
    .filter(Boolean);
}

function selectedFirst(images: GalleryImage[]) {
  return [
    ...images.filter((image) => image.selected && !image.broken),
    ...images.filter((image) => !image.selected && !image.broken),
    ...images.filter((image) => image.broken)
  ];
}

async function readError(response: Response, fallback: string) {
  try {
    const payload = await response.json();
    if (typeof payload?.message === "string") {
      return payload.message;
    }
  } catch {
    // Keep fallback when the response is not JSON.
  }

  return fallback;
}

export default function PdfGenerator() {
  const [stage, setStage] = useState<Stage>("empty");
  const [busy, setBusy] = useState<BusyState>("idle");
  const [listingUrl, setListingUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [pricing, setPricing] = useState("");
  const [features, setFeatures] = useState("");
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Importe um anúncio para rever o conteúdo antes de gerar o PDF."
  );
  const [messageTone, setMessageTone] = useState<MessageTone>("neutral");

  const trimmedUrl = listingUrl.trim();
  const selectedImages = useMemo(
    () => images.filter((image) => image.selected && !image.broken),
    [images]
  );
  const brokenCount = images.filter((image) => image.broken).length;
  const canImport =
    trimmedUrl.length > 0 && isValidHttpUrl(trimmedUrl) && busy === "idle";
  const canGenerate =
    title.trim().length > 0 &&
    description.trim().length > 0 &&
    selectedImages.length > 0 &&
    busy === "idle";

  function setNotice(nextMessage: string, tone: MessageTone = "neutral") {
    setMessage(nextMessage);
    setMessageTone(tone);
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!trimmedUrl) {
      setNotice("Cole o link do anúncio antes de importar.", "error");
      return;
    }

    if (!isValidHttpUrl(trimmedUrl)) {
      setNotice("Use um link válido começado por http:// ou https://.", "error");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);

    try {
      setBusy("scraping");
      setNotice("A importar o anúncio e a recolher imagens.");

      const response = await fetch("/api/scrape-listing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ listingUrl: trimmedUrl }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          await readError(response, "Não foi possível importar o anúncio.")
        );
      }

      const payload = (await response.json()) as ListingResponse;

      setTitle(payload.title ?? "");
      setPricing(payload.pricing ?? "");
      setFeatures(featuresToText(payload.features));
      setDescription(payload.description ?? "");
      setSourceUrl(payload.sourceUrl ?? trimmedUrl);
      setImages(createGalleryImages(payload.images ?? []));
      setStage("editing");
      setNotice(
        "Anúncio importado. Reveja o texto e escolha as imagens para o PDF.",
        "success"
      );
    } catch (error) {
      setNotice(
        error instanceof DOMException && error.name === "AbortError"
          ? "A importação demorou demasiado tempo. Confirme o workflow no n8n."
          : error instanceof Error
            ? error.message
            : "Ocorreu um erro inesperado ao importar.",
        "error"
      );
    } finally {
      setBusy("idle");
      window.clearTimeout(timeoutId);
    }
  }

  async function handleGeneratePdf() {
    if (!canGenerate) {
      setNotice(
        "Confirme que existe título, descrição e pelo menos uma imagem selecionada.",
        "error"
      );
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);

    try {
      setBusy("generating");
      setNotice("A gerar o PDF com a seleção atual.");

      const response = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: title.trim(),
          pricing: pricing.trim(),
          features: textToFeatures(features),
          description: description.trim(),
          images: selectedImages.map((image) => image.url),
          sourceUrl
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Não foi possível gerar o PDF."));
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/pdf")) {
        throw new Error("A automação respondeu, mas não devolveu um ficheiro PDF.");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download =
        filenameFromDisposition(response.headers.get("content-disposition")) ??
        "proposta-imovel.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setNotice("PDF gerado e descarregado com sucesso.", "success");
    } catch (error) {
      setNotice(
        error instanceof DOMException && error.name === "AbortError"
          ? "A geração demorou demasiado tempo. Confirme o workflow no n8n."
          : error instanceof Error
            ? error.message
            : "Ocorreu um erro inesperado ao gerar o PDF.",
        "error"
      );
    } finally {
      setBusy("idle");
      window.clearTimeout(timeoutId);
    }
  }

  function toggleImage(id: string) {
    setImages((current) =>
      selectedFirst(
        current.map((image) =>
          image.id === id && !image.broken
            ? { ...image, selected: !image.selected }
            : image
        )
      )
    );
  }

  function reorderImages(activeId: string, targetId: string) {
    if (activeId === targetId) {
      return;
    }

    setImages((current) => {
      const activeIndex = current.findIndex((image) => image.id === activeId);
      const targetIndex = current.findIndex((image) => image.id === targetId);

      if (activeIndex < 0 || targetIndex < 0) {
        return current;
      }

      const next = [...current];
      const [image] = next.splice(activeIndex, 1);
      next.splice(targetIndex, 0, image);
      return selectedFirst(next);
    });
  }

  function moveImage(id: string, direction: -1 | 1) {
    setImages((current) => {
      const activeIndex = current.findIndex((image) => image.id === id);
      const targetIndex = activeIndex + direction;

      if (
        activeIndex < 0 ||
        targetIndex < 0 ||
        targetIndex >= current.length ||
        current[activeIndex].broken
      ) {
        return current;
      }

      const next = [...current];
      const [image] = next.splice(activeIndex, 1);
      next.splice(targetIndex, 0, image);
      return selectedFirst(next);
    });
  }

  function markImageBroken(id: string) {
    setImages((current) =>
      selectedFirst(
        current.map((image) =>
          image.id === id ? { ...image, broken: true, selected: false } : image
        )
      )
    );
  }

  function selectAllImages() {
    setImages((current) =>
      selectedFirst(current.map((image) => ({ ...image, selected: !image.broken })))
    );
  }

  function clearImageSelection() {
    setImages((current) => current.map((image) => ({ ...image, selected: false })));
  }

  return (
    <main className="page-shell">
      <section className="hero-tool editor-shell" aria-labelledby="page-title">
        <header className="topbar">
          <div className="brand-mark" aria-label="CARE Real Estate">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="agency-logo"
              src="https://media.egorealestate.com/ORIGINAL/27b7d0cb-032b-4644-bc49-4de29b36138b.png"
              alt="Logótipo da agência"
            />
          </div>
          <div className="private-label">Dossier privado</div>
        </header>

        <div className="editor-intro">
          <div>
            <p className="eyebrow">Apresentação para cliente comprador</p>
            <h1 id="page-title">Preparar PDF de imóvel</h1>
          </div>
          <p className="lead">
            Importe o anúncio, ajuste o texto e escolha apenas as fotografias que
            devem entrar na proposta final.
          </p>
        </div>

        <form className="generator-panel import-panel" onSubmit={handleImport} noValidate>
          <label htmlFor="listing-url">Link do anúncio</label>
          <div className="input-row">
            <input
              id="listing-url"
              name="listingUrl"
              type="url"
              inputMode="url"
              placeholder="https://www.idealista.pt/imovel/..."
              value={listingUrl}
              onChange={(event) => {
                setListingUrl(event.target.value);
                if (busy === "idle") {
                  setNotice("Importe um anúncio para rever o conteúdo antes de gerar o PDF.");
                }
              }}
              aria-describedby="form-message"
            />
            <button type="submit" disabled={!canImport}>
              {busy === "scraping" ? "A importar" : "Importar anúncio"}
            </button>
          </div>
        </form>

        <p
          id="form-message"
          className={`status-message ${messageTone}`}
          role={messageTone === "error" ? "alert" : "status"}
        >
          {message}
        </p>

        {stage === "editing" ? (
          <section className="editor-workspace" aria-label="Editor do PDF">
            <div className="copy-editor">
              <div className="title-price-grid">
                <div>
                  <label htmlFor="listing-title">Título</label>
                  <input
                    id="listing-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="listing-pricing">Preço</label>
                  <input
                    id="listing-pricing"
                    value={pricing}
                    onChange={(event) => setPricing(event.target.value)}
                    placeholder="100000€"
                  />
                </div>
              </div>

              <label htmlFor="listing-features">Características</label>
              <textarea
                id="listing-features"
                className="features-textarea"
                value={features}
                onChange={(event) => setFeatures(event.target.value)}
                placeholder={"Área: 78 m²\nTipologia: T2\n1º andar sem elevador"}
                rows={5}
              />

              <label htmlFor="listing-description">Descrição</label>
              <textarea
                id="listing-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={12}
              />
            </div>

            <div className="gallery-editor">
              <div className="gallery-toolbar">
                <div>
                  <span className="toolbar-kicker">Galeria</span>
                  <strong>
                    {selectedImages.length} de {images.length - brokenCount} imagens
                    selecionadas
                  </strong>
                </div>
                <div className="toolbar-actions">
                  <button type="button" onClick={selectAllImages}>
                    Selecionar todas
                  </button>
                  <button type="button" onClick={clearImageSelection}>
                    Limpar seleção
                  </button>
                </div>
              </div>

              {selectedImages.length > 12 ? (
                <p className="gallery-warning">
                  Há muitas imagens selecionadas. O PDF pode ficar mais pesado e longo.
                </p>
              ) : null}

              <p className="gallery-note">
                Arraste as imagens para ordenar. No telemóvel, use Subir e Descer.
              </p>

              <div className="image-grid">
                {images.map((image, index) => (
                  <article
                    className={`image-card ${image.selected ? "selected" : ""} ${
                      image.broken ? "broken" : ""
                    } ${draggingId === image.id ? "dragging" : ""}`}
                    key={image.id}
                    draggable={!image.broken}
                    onDragStart={(event) => {
                      setDraggingId(image.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", image.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const activeId = event.dataTransfer.getData("text/plain") || draggingId;
                      if (activeId) {
                        reorderImages(activeId, image.id);
                      }
                      setDraggingId(null);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                  >
                    <button
                      type="button"
                      className="image-toggle"
                      onClick={() => toggleImage(image.id)}
                      disabled={image.broken}
                      aria-pressed={image.selected}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={`Imagem ${index + 1} do imóvel`}
                        onError={() => markImageBroken(image.id)}
                      />
                      <span>{image.broken ? "Falhou" : image.selected ? "Selecionada" : "Usar"}</span>
                    </button>
                    <div className="image-footer">
                      <span className="image-position">Imagem {index + 1}</span>
                      <div className="image-order-actions" aria-label="Ordenar imagem">
                        <button
                          type="button"
                          onClick={() => moveImage(image.id, -1)}
                          disabled={index === 0 || image.broken}
                        >
                          Subir
                        </button>
                        <button
                          type="button"
                          onClick={() => moveImage(image.id, 1)}
                          disabled={index === images.length - 1 || image.broken}
                        >
                          Descer
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="final-actions">
              <button
                type="button"
                className="primary-action"
                onClick={handleGeneratePdf}
                disabled={!canGenerate}
              >
                {busy === "generating" ? "A gerar PDF" : "Gerar PDF"}
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
