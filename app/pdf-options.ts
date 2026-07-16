export const PDF_CONSULTANTS = [
  { name: "Leonardo Giestas", phone: "913 740 456" },
  { name: "Rogner Vieira", phone: "966 490 870" }
] as const;

export const PDF_LANGUAGES = ["Português", "Inglês"] as const;

export type PdfConsultantName = (typeof PDF_CONSULTANTS)[number]["name"];
export type PdfLanguage = (typeof PDF_LANGUAGES)[number];

export function getPdfConsultant(name: unknown) {
  return PDF_CONSULTANTS.find((consultant) => consultant.name === name);
}

export function isPdfLanguage(value: unknown): value is PdfLanguage {
  return PDF_LANGUAGES.some((language) => language === value);
}
