import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { MAX_EDIT_IMAGES, editImage, generateImage } from './client.mjs';

/**
 * Minimal MCP stdio server.
 *
 * Transport is newline-delimited JSON-RPC 2.0 on stdin/stdout. Everything that
 * is not a protocol message must go to stderr, or it corrupts the stream.
 */

const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'generate_image',
    description:
      'Generate an image from a text prompt using the local ChatGPT/Codex subscription. ' +
      'Returns the saved file path plus the size/quality/usage reported by the API.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to draw.' },
        out_path: { type: 'string', description: 'Where to write the image file.' },
        transparent: {
          type: 'boolean',
          description: 'Request a transparent background (sent as background=transparent).',
        },
        size: { type: 'string', description: 'e.g. 1024x1024, 2048x1152, auto.' },
        quality: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
        },
        model: { type: 'string', description: 'Model id to place in the request body.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_image',
    description:
      'Edit one or more existing images using a text instruction. ' +
      `Pass 1-${MAX_EDIT_IMAGES} local file paths.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'What to change.' },
        image_paths: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_EDIT_IMAGES,
          description: 'Local image file paths to edit.',
        },
        out_path: { type: 'string', description: 'Where to write the result.' },
        transparent: { type: 'boolean' },
        size: { type: 'string' },
        quality: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] },
        model: { type: 'string' },
      },
      required: ['prompt', 'image_paths'],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(...args) {
  process.stderr.write(`[codex-img-mcp] ${args.join(' ')}\n`);
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function toolResult(payload, isError = false) {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
    isError,
  };
}

async function handleToolCall(args) {
  const name = args?.name;
  const input = args?.arguments ?? {};

  if (typeof input.prompt !== 'string' || input.prompt.length === 0) {
    throw new Error('`prompt` is required.');
  }

  const shared = {
    prompt: input.prompt,
    model: input.model,
    background: input.transparent ? 'transparent' : 'opaque',
    quality: input.quality ?? 'auto',
    size: input.size ?? 'auto',
  };

  let result;
  if (name === 'generate_image') {
    result = await generateImage(shared);
  } else if (name === 'edit_image') {
    if (!Array.isArray(input.image_paths) || input.image_paths.length === 0) {
      throw new Error('`image_paths` must contain at least one path.');
    }
    result = await editImage({ ...shared, images: input.image_paths });
  } else {
    throw new Error(`Unknown tool: ${name}`);
  }

  const outPath =
    typeof input.out_path === 'string' && input.out_path.length > 0
      ? input.out_path
      : path.resolve(
          process.cwd(),
          `codex-img-${result.endpoint}-${Date.now()}.png`,
        );

  const abs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(result.b64, 'base64'));

  return {
    saved_path: abs,
    endpoint: result.endpoint,
    size: result.size,
    quality: result.quality,
    background: result.background,
    output_format: result.outputFormat,
    generation_id: result.generationId,
    usage: result.usage,
  };
}

export async function runMcpServer() {
  log('starting; tools:', TOOLS.map((t) => t.name).join(', '));

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (err) {
      log('dropping malformed JSON line:', err.message);
      continue;
    }

    const { id, method, params } = msg;

    try {
      switch (method) {
        case 'initialize':
          ok(id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'codex-img-cli', version: '0.1.0' },
          });
          break;

        case 'notifications/initialized':
        case 'initialized':
          break; // notification: no response

        case 'ping':
          ok(id, {});
          break;

        case 'tools/list':
          ok(id, { tools: TOOLS });
          break;

        case 'tools/call':
          try {
            const result = await handleToolCall(params);
            ok(id, toolResult(result));
          } catch (err) {
            // Tool-level failure: report it as a result, not a protocol error.
            ok(id, toolResult(err.message, true));
          }
          break;

        default:
          if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
          break;
      }
    } catch (err) {
      log('handler error:', err.stack || err.message);
      if (id !== undefined) fail(id, -32603, err.message);
    }
  }
}