export function togglePrimarySpecialty(selected: string[], specialty: string): string[] {
  if (selected.includes(specialty)) {
    return selected.filter(item => item !== specialty);
  }

  return [...selected, specialty];
}

export function normalizePrimarySpecialties(selected: string[], customSpecialty: string): string[] {
  const values = [...selected, customSpecialty.trim()]
    .map(value => value.trim())
    .filter(Boolean);

  return Array.from(new Set(values));
}
