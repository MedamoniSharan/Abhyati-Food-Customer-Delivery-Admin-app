/**
 * Softens ALL-CAPS catalog names for on-screen reading without changing meaning.
 */
export function formatCatalogTitle(name: string): string {
  const t = name.trim()
  if (t.length < 3) return t
  const letters = t.replace(/[\s\d\-./]/g, '')
  if (letters.length === 0) return t
  const upper = (letters.match(/[A-Z]/g) || []).length
  const lower = (letters.match(/[a-z]/g) || []).length
  if (upper / letters.length < 0.55 && lower > 0) return t

  return t
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      if (!word) return word
      if (/^[A-Z0-9]{1,4}$/i.test(word) && word.length <= 4) return word.toUpperCase()
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
