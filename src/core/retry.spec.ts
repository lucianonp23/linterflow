import { isRetryableApiError, withRetry } from './retry';

describe('isRetryableApiError', () => {
  // Everything here is a real message seen from the Gemini SDK or from undici.
  const transient = [
    ['a rate limit', '{"error":{"code":429,"message":"You exceeded your current quota"}}'],
    ['free-tier quota', 'Quota exceeded for metric: generate_content_free_tier_requests'],
    ['a busy model', '{"error":{"code":503,"message":"This model is currently experiencing high demand"}}'],
    ['a gateway error', 'Got 502 Bad Gateway'],
    // The gap that cost two files in the first mitigation run: undici reports
    // every connection-level failure as this one opaque string.
    ['a dropped connection', 'Gemini API call failed: fetch failed'],
    ['a socket reset', 'read ECONNRESET'],
    ['a DNS hiccup', 'getaddrinfo EAI_AGAIN generativelanguage.googleapis.com'],
    ['a timeout', 'connect ETIMEDOUT 142.250.0.1:443'],
  ] as const;

  it.each(transient)('retries %s', (_label, message) => {
    expect(isRetryableApiError(new Error(message))).toBe(true);
  });

  const permanent = [
    ['an invalid key', '400 API key not valid. Please pass a valid API key.'],
    ['a malformed request', '400 Invalid JSON payload received'],
    ['a missing model', '404 models/does-not-exist is not found'],
    ['a permission problem', '403 Permission denied on resource'],
    ['an empty response', 'Model returned an empty response.'],
  ] as const;

  it.each(permanent)('does not retry %s', (_label, message) => {
    expect(isRetryableApiError(new Error(message))).toBe(false);
  });

  it('inspects error.cause, where undici hides the real reason', () => {
    // `fetch failed` on its own says nothing; the code lives one level down.
    const wrapped = Object.assign(new Error('something went wrong'), {
      cause: { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
    });
    expect(isRetryableApiError(wrapped)).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns the result once the operation succeeds', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('fetch failed');
        return 'ok';
      },
      { baseDelayMs: 1 },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('rethrows a permanent error immediately, without burning the budget', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('400 API key not valid');
        },
        { baseDelayMs: 1, maxRetries: 5 },
      ),
    ).rejects.toThrow('API key not valid');

    expect(calls).toBe(1);
  });

  it('gives up after the retry budget and surfaces the last error', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('fetch failed');
        },
        { baseDelayMs: 1, maxRetries: 2 },
      ),
    ).rejects.toThrow('fetch failed');

    expect(calls).toBe(3); // the first attempt plus two retries
  });

  it('backs off exponentially', async () => {
    const delays: number[] = [];
    await withRetry(
      async () => {
        if (delays.length < 3) throw new Error('429 rate limit');
        return 'ok';
      },
      { baseDelayMs: 1, onRetry: (_attempt, delayMs) => delays.push(delayMs) },
    );

    expect(delays).toEqual([1, 2, 4]);
  });
});
