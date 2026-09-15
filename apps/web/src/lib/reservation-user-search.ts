export function reservationUserSearchPattern(term: string): string {
  const escaped = term.trim().toLocaleLowerCase().replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return `%${escaped}%`;
}
