"use client";

import { FormEvent, useMemo, useState } from "react";

type Stage = "empty" | "editing";
type BusyState = "idle" | "scraping" | "generating";
type MessageTone = "neutral" | "success" | "error";

type ListingResponse = {
  title: string;
  pricing?: string;
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
    selected: true,
    broken: false
  }));
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
  const [description, setDescription] = useState("");
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Importe um anuncio para rever o conteudo antes de gerar o PDF."
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
      setNotice("Cole o link do anuncio antes de importar.", "error");
      return;
    }

    if (!isValidHttpUrl(trimmedUrl)) {
      setNotice("Use um link valido comecado por http:// ou https://.", "error");
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);

    try {
      setBusy("scraping");
      setNotice("A importar o anuncio e a recolher imagens.");

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
          await readError(response, "Nao foi possivel importar o anuncio.")
        );
      }

      const payload = (await response.json()) as ListingResponse;

      setTitle(payload.title ?? "");
      setPricing(payload.pricing ?? "");
      setDescription(payload.description ?? "");
      setSourceUrl(payload.sourceUrl ?? trimmedUrl);
      setImages(createGalleryImages(payload.images ?? []));
      setStage("editing");
      setNotice(
        "Anuncio importado. Reveja o texto e escolha as imagens para o PDF.",
        "success"
      );
    } catch (error) {
      setNotice(
        error instanceof DOMException && error.name === "AbortError"
          ? "A importacao demorou demasiado tempo. Confirme o workflow no n8n."
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
        "Confirme que existe titulo, descricao e pelo menos uma imagem selecionada.",
        "error"
      );
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90000);

    try {
      setBusy("generating");
      setNotice("A gerar o PDF com a selecao atual.");

      const response = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: title.trim(),
          pricing: pricing.trim(),
          description: description.trim(),
          images: selectedImages.map((image) => image.url),
          sourceUrl
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readError(response, "Nao foi possivel gerar o PDF."));
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().includes("application/pdf")) {
        throw new Error("A automacao respondeu, mas nao devolveu um ficheiro PDF.");
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
          ? "A geracao demorou demasiado tempo. Confirme o workflow no n8n."
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

  function resetFlow() {
    setStage("empty");
    setSourceUrl("");
    setTitle("");
    setPricing("");
    setDescription("");
    setImages([]);
    setNotice("Importe um anuncio para rever o conteudo antes de gerar o PDF.");
  }

  return (
    <main className="page-shell">
      <section className="hero-tool editor-shell" aria-labelledby="page-title">
        <header className="topbar">
          <div className="brand-mark" aria-label="CARE Real Estate">
            <span className="care-logo">CARE</span>
            <span className="brand-subtitle">Real Estate</span>
          </div>
          <div className="private-label">Dossier privado</div>
        </header>

        <div className="editor-intro">
          <div>
            <p className="eyebrow">Apresentacao para cliente comprador</p>
            <h1 id="page-title">Preparar PDF de imovel</h1>
          </div>
          <p className="lead">
            Importe o anuncio, ajuste o texto e escolha apenas as fotografias que
            devem entrar na proposta final.
          </p>
        </div>

        <form className="generator-panel import-panel" onSubmit={handleImport} noValidate>
          <label htmlFor="listing-url">Link do anuncio</label>
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
                  setNotice("Importe um anuncio para rever o conteudo antes de gerar o PDF.");
                }
              }}
              aria-describedby="form-message"
            />
            <button type="submit" disabled={!canImport}>
              {busy === "scraping" ? "A importar" : "Importar anuncio"}
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
                  <label htmlFor="listing-title">Titulo</label>
                  <input
                    id="listing-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>

                <div>
                  <label htmlFor="listing-pricing">Preco</label>
                  <input
                    id="listing-pricing"
                    value={pricing}
                    onChange={(event) => setPricing(event.target.value)}
                    placeholder="100000€"
                  />
                </div>
              </div>

              <label htmlFor="listing-description">Descricao</label>
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
                    Limpar selecao
                  </button>
                </div>
              </div>

              {selectedImages.length > 12 ? (
                <p className="gallery-warning">
                  Ha muitas imagens selecionadas. O PDF pode ficar mais pesado e longo.
                </p>
              ) : null}

              <p className="gallery-note">
                Arraste as imagens para ordenar. Ao remover uma imagem, ela desce para o
                fim da selecao.
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
                        alt={`Imagem ${index + 1} do imovel`}
                        onError={() => markImageBroken(image.id)}
                      />
                      <span>{image.broken ? "Falhou" : image.selected ? "Selecionada" : "Usar"}</span>
                    </button>
                    <div className="image-position">Imagem {index + 1}</div>
                  </article>
                ))}
              </div>
            </div>

            <div className="final-actions">
              <button type="button" className="secondary-action" onClick={resetFlow}>
                Importar outro anuncio
              </button>
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
