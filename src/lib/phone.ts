// Normalize a phone number to last 9 digits (Czech format).
export function normalizePhone(input: string | number | null | undefined): string {
  if (input == null) return "";
  const digits = String(input).replace(/\D/g, "");
  return digits.slice(-9);
}
