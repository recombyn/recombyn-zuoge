#!/usr/bin/env node
/**
 * Stdio MCP bridge → Recombyn REST `/api/v1/mcp/canvas/*`.
 *
 * Env:
 *   RECOMBYN_API_URL   default http://127.0.0.1:8000
 *   RECOMBYN_TOKEN     Bearer access token (required)
 *   RECOMBYN_PROJECT_ID default project_id injected into tool calls
 */
import readline from 'node:readline';

const API = (process.env.RECOMBYN_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const TOKEN = (process.env.RECOMBYN_TOKEN || '').trim();
const DEFAULT_PROJECT = (process.env.RECOMBYN_PROJECT_ID || '').trim();

let toolCatalog = [];

async function api(path, body) {
  const res = await fetch(`${API}/api/v1/mcp/canvas${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.detail?.message || data?.detail || text || res.statusText;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

function injectProject(args) {
  const out = { ...(args || {}) };
  if (!out.project_id && !out.projectId && DEFAULT_PROJECT) {
    out.project_id = DEFAULT_PROJECT;
  }
  return out;
}

function toMcpTools(openAiTools) {
  return (openAiTools || []).map((t) => {
    const fn = t.function || {};
    return {
      name: fn.name,
      description: fn.description || fn.name,
      inputSchema: fn.parameters || { type: 'object', properties: {} },
    };
  });
}

async function refreshTools() {
  const data = await api('/tools');
  toolCatalog = toMcpTools(data.tools || []);
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handleMessage(line) {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = req;

  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'recombyn-canvas', version: '0.1.0' },
        },
      });
      return;
    }
    if (method === 'notifications/initialized') {
      return;
    }
    if (method === 'tools/list') {
      if (!toolCatalog.length) await refreshTools();
      send({ jsonrpc: '2.0', id, result: { tools: toolCatalog } });
      return;
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = injectProject(params?.arguments || {});
      const data = await api('/call', { tool: name, arguments: args });
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(data.result ?? data, null, 2) }],
        },
      });
      return;
    }
    if (id != null) {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    if (id != null) {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: String(err?.message || err) },
      });
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error('RECOMBYN_TOKEN is required');
    process.exit(1);
  }
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    await handleMessage(line);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
