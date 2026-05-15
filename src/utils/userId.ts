/** 이름 + 전화번호 숫자만 추출 후 뒤 4자리 */
export function buildUserId(name: string, phone: string): string {
  const trimmed = name.trim();
  const digits = phone.replace(/\D/g, "");
  const last4 =
    digits.length >= 4 ? digits.slice(-4) : digits.padStart(4, "0");
  return `${trimmed}${last4}`;
}
