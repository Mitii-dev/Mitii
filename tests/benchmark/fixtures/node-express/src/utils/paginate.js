/**
 * Slices an array into a single page of results.
 * @param {unknown[]} items
 * @param {number} page 1-based page number
 * @param {number} pageSize
 */
export function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize;
  // BUG: off-by-one — drops the last item of every full page.
  return items.slice(start, start + pageSize - 1);
}
