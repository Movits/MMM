export type LabeledOption = { label: string };

export function sortOptionsAlphabetically<T extends LabeledOption>(options: readonly T[], locale = "pt-BR"): T[] {
  return [...options].sort((a, b) => a.label.localeCompare(b.label, locale, { sensitivity: "base" }));
}

export function sortTextAlphabetically(options: readonly string[], locale = "pt-BR"): string[] {
  return [...options].sort((a, b) => a.localeCompare(b, locale, { sensitivity: "base" }));
}
