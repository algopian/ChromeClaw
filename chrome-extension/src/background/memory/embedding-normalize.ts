/**
 * Sanitize non-finite values (NaN, Infinity) and L2-normalize to unit magnitude.
 * After normalization, cosine similarity equals the dot product.
 *
 */
const sanitizeAndNormalizeEmbedding = (vec: number[]): number[] => {
  const sanitized = vec.map(v => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return sanitized;
  return sanitized.map(v => v / magnitude);
};

export { sanitizeAndNormalizeEmbedding };
