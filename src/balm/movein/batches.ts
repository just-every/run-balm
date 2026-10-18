/** Bound each SQL input by both row count and encoded size. One D1 batch keeps the cutover atomic. */
export function chunks<T>(records: T[]): T[][] {
  const result: T[][] = []
  let group: T[] = [], size = 2
  for (const record of records) {
    const bytes = new TextEncoder().encode(JSON.stringify(record)).length + 1
    if (group.length && (group.length >= 250 || size + bytes > 200_000)) { result.push(group); group = []; size = 2 }
    group.push(record); size += bytes
  }
  if (group.length) result.push(group)
  return result
}
export function textChunks(value: string) {
  const result: string[] = []
  for (let i = 0; i < value.length; i += 100_000) result.push(value.slice(i, i + 100_000))
  return result
}
