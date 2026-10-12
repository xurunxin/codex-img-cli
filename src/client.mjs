import fs from 'node:fs';
import path from 'node:path';

import { CODEX_API_BASE, resolveCredentials } from './auth.mjs';

export const DEFAULT_MODEL = 'gpt-image-2';

/** openai/codex `ext/image-generation/src/tool.rs`: MAX_EDIT_IMAGES = 5. */
export const MAX_EDIT_IMAGES = 5;

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export function fileToDataUrl(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Input image not found: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(
      `Unsupported image extension "${ext}" for ${abs}. Use png, jpg, jpeg, webp or gif.`,
    );
  }
  const bytes = fs.readFileSync(abs);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function buildHeaders(creds) {
  const headers = {
    Authorization: `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json',
  };
  if (creds.accountId) headers['ChatGPT-Account-ID'] = creds.accountId;
  return headers;
}

/**
 * Compose a timeout signal with an optional caller-supplied signal.
 *
 * A server that lets users cancel a queued/running generation needs to abort the
 * in-flight request from the outside. The timeout controller alone cannot express
 * that, so the two are merged rather than one replacing the other.
 *
 * Abort reasons matter here: a timeout and a user cancel produce the same
 * `AbortError` class, and "user hit cancel" is not a failure worth retrying or
 * surfacing as a red error. Each path aborts with a distinguishable reason.
 */
function withTimeout(timeoutMs, signal) {
  const controller = new AbortController();
  const reason = new Error(`Image request timed out after ${timeoutMs}ms`);
  const timer = setTimeout(() => controller.abort(reason), timeoutMs);
  if (timer.unref) timer.unref();
  return {
    signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
    dispose() {
      clearTimeout(timer);
    },
  };
}

async function postImages(op, payload, { baseUrl, allowRefresh, timeoutMs, signal }) {
  const url = `${baseUrl || CODEX_API_BASE}/images/${op}`;

  const attempt = async () => {
    const creds = await resolveCredentials({ refresh: allowRefresh });
    const scoped = withTimeout(timeoutMs, signal);
    if (signal?.aborted) scoped.dispose();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(creds),
        body: JSON.stringify(payload),
        signal: scoped.signal,
      });
      const text = await res.text();
      return { res, text, creds };
    } finally {
      scoped.dispose();
    }
  };

  let { res, text, creds } = await attempt();

  // A stale token can survive the local exp check (revoked, or refreshed by
  // Codex into a different slot). Retry exactly once with a forced refresh.
  if (res.status === 401 && allowRefresh) {
    const { refreshAccessToken, readAuthFile } = await import('./auth.mjs');
    await refreshAccessToken(readAuthFile());
    ({ res, text, creds } = await attempt());
  }

  if (!res.ok) {
    const requestId = res.headers.get('x-codex-imagegen-request-id');
    throw new Error(
      `Image request failed: HTTP ${res.status}` +
        (requestId ? ` (x-codex-imagegen-request-id: ${requestId})` : '') +
        `\n${extractErrorMessage(text)}`,
    );
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Image endpoint returned non-JSON (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!Array.isArray(data?.data) || data.data.length === 0) {
    throw new Error(`Image endpoint returned no image data: ${text.slice(0, 300)}`);
  }

  return { response: data, creds };
}

function extractErrorMessage(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message ?? parsed?.message ?? text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

function normalizeResult(data, endpoint) {
  const items = data.data;
  const first = items[0];
  return {
    endpoint,
    b64: first.b64_json,
    generationId: first.generation_id ?? null,
    background: data.background ?? null,
    size: data.size ?? null,
    quality: data.quality ?? null,
    outputFormat: data.output_format ?? null,
    usage: data.usage ?? null,
    // n > 1 returns several images. `b64` stays the first one so existing
    // callers (--out writes a single file) keep working, while callers that can
    // use them all read this instead of re-requesting.
    count: items.length,
    images: items.map((it) => ({
      b64: it.b64_json,
      generationId: it.generation_id ?? null,
    })),
  };
}

export async function generateImage({
  prompt,
  model = DEFAULT_MODEL,
  background = 'opaque',
  quality = 'auto',
  size = 'auto',
  n = 1,
  baseUrl,
  allowRefresh = true,
  timeoutMs = 300000,
  signal,
}) {
  if (!prompt) throw new Error('A prompt is required.');
  const payload = {
    model,
    prompt,
    background,
    quality,
    size,
  };
  if (n > 1) payload.n = n;

  const { response } = await postImages('generations', payload, {
    baseUrl,
    allowRefresh,
    timeoutMs,
    signal,
  });
  return normalizeResult(response, 'generations');
}

export async function editImage({
  prompt,
  images,
  model = DEFAULT_MODEL,
  background = 'opaque',
  quality = 'auto',
  size = 'auto',
  baseUrl,
  allowRefresh = true,
  timeoutMs = 300000,
  signal,
}) {
  if (!prompt) throw new Error('A prompt is required.');
  if (!Array.isArray(images) || images.length === 0) {
    throw new Error('At least one input image is required for editing.');
  }
  if (images.length > MAX_EDIT_IMAGES) {
    throw new Error(
      `At most ${MAX_EDIT_IMAGES} input images are supported (got ${images.length}).`,
    );
  }

  const payload = {
    model,
    prompt,
    background,
    quality,
    size,
    // The edits endpoint takes ImageReference objects, not bare data URLs:
    // { "images": [{ "image_url": "data:image/png;base64,..." }] }
    images: images.map((file) => ({ image_url: fileToDataUrl(file) })),
  };

  const { response } = await postImages('edits', payload, {
    baseUrl,
    allowRefresh,
    timeoutMs,
    signal,
  });
  return normalizeResult(response, 'edits');
}

/**
 * Probe which model identifiers the subscription endpoint actually honours.
 *
 * Codex hardcodes a single model constant, so there is no supported way to pick
 * between model ids here. This exists to answer, with first-hand evidence,
 * whether the backend routes on the `model` field or ignores it.
 */
export async function probeModels({ prompt, models, baseUrl, allowRefresh = true }) {
  const results = [];
  for (const model of models) {
    try {
      const r = await generateImage({
        prompt,
        model,
        quality: 'low',
        size: '1024x1024',
        baseUrl,
        allowRefresh,
      });
      results.push({
        model,
        ok: true,
        reportedQuality: r.quality,
        reportedSize: r.size,
        reportedBackground: r.background,
        generationId: r.generationId,
        bytes: r.b64 ? Buffer.from(r.b64, 'base64').length : 0,
      });
    } catch (err) {
      results.push({ model, ok: false, error: err.message });
    }
  }
  return results;
}

export function writeBase64ToFile(b64, outPath) {
  const abs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
  return abs;
}