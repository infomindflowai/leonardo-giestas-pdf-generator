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
    description: description.trim(),
    images,
    sourceUrl
  };
}
