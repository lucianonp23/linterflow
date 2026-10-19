/**
 * Retry with exponential backoff for LLM API calls.
 *
 * Why this exists: a run over the 60-file corpus makes hundreds of consecutive
 * calls, and a free-tier rate limit is a matter of when, not if. Without a
 * retry the 429 propagates out of the self-healing loop, the file is restored
 * from its backup and the Reporter records it as NOT CONVERGED — a transient
 * network condition silently becomes an experimental result.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  /** Called before each wait, for logging. */
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
}

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Rate limits, quota exhaustion and transient 5xx are worth retrying. A
 * malformed request or an invalid API key is not — retrying those just burns
 * time before failing anyway.
 *
 * `fetch failed` earns its place the hard way. Node's undici collapses every
 * connection-level problem — DNS, TLS, a dropped socket — into that one
 * message, with the cause buried in `error.cause`. It matched nothing here, so
 * a momentary network blip escaped the loop, the file was rolled back, and the
 * Reporter recorded a NOT CONVERGED that never happened. Two files in the first
 * mitigation run were lost that way before it was spotted: precisely the
 * failure this module exists to prevent, arriving through a door left open.
 */
export function isRetryableApiError(error: unknown): boolean {
  const error_ = error as { message?: string; cause?: { message?: string; code?: string } };
  const message = [
    String(error_?.message ?? error),
    error_?.cause?.message ?? '',
    error_?.cause?.code ?? '',
  ].join(' ');

  return /429|rate limit|quota|exhausted|resource_exhausted|50[0234]|unavailable|deadline|fetch failed|network|socket|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR/i.test(
    message,
  );
}

/**
 * Runs `operation`, retrying it on transient failures with exponential backoff
 * (4s, 8s, 16s, …). Non-retryable errors are rethrown immediately, and so is
 * the last error once the retries are exhausted.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableApiError(error) || attempt === maxRetries) break;

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      options.onRetry?.(attempt + 1, delayMs, error as Error);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
