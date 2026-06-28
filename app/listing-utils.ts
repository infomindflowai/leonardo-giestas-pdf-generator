export type ListingDraft = {
  title: string;
  pricing?: string;
  description: string;
  images: string[];
  sourceUrl?: string;
};

export function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeImageUrls(images: unknown) {
  if (!Array.isArray(images)) {
    return [];
  }

  const seen = new Set<string>();

  return images.filter((image): image is string => {
    if (!isValidHttpUrl(image)) {
      return false;
    }

    const lowered = image.toLowerCase();
    const isSystemAsset =
      lowered.includes("loading.gif") ||
      lowered.includes("captcha") ||
      lowered.includes("favicon") ||
      lowered.includes("logo.png") ||
      lowered.includes("/logo") ||
      lowered.includes("static/common/icons");

    if (isSystemAsset || seen.has(image)) {
      return false;
    }

    seen.add(image);
    return true;
  });
}

export function cleanListingDescription(description: string) {
  return description
    .replace(/\r\n?/g, "\n")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/[ \t]*\|[ \t]*/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\uFE0E\uFE0F\u200D]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeListingDraft(payload: unknown): ListingDraft | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as {
    title?: unknown;
    listing_title?: unknown;
    pricing?: unknown;
    price?: unknown;
    description?: unknown;
    listing_description?: unknown;
    images?: unknown;
    sourceUrl?: unknown;
    sourceURL?: unknown;
    url?: unknown;
  };

  const title = typeof data.title === "string" ? data.title : data.listing_title;
  const pricing = typeof data.pricing === "string" ? data.pricing : data.price;
  const description =
    typeof data.description === "string" ? data.description : data.listing_description;
  const images = normalizeImageUrls(data.images);
  const sourceUrl =
    typeof data.sourceUrl === "string"
      ? data.sourceUrl
      : typeof data.sourceURL === "string"
        ? data.sourceURL
        : typeof data.url === "string"
          ? data.url
          : undefined;

  if (typeof title !== "string" || typeof description !== "string") {
    return null;
  }

  return {
    title: title.trim(),
    pricing: typeof pricing === "string" ? pricing.trim() : undefined,
    description: cleanListingDescription(description),
    images,
    sourceUrl
  };
}
