import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, MODEL } from '../src/config.mjs';
import path from 'node:path';
const client = new Client({ name: 'ui-tars-control-test', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'server.mjs')], env: process.env, stderr: 'pipe' }));
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert.deepEqual(tools.sort(), ['get_screenshot','get_status','health','list_windows','run_task','stop_task'].sort());
  const result = await client.callTool({ name: 'health', arguments: {} });
  assert.ok(!result.isError);
  assert.equal(JSON.parse(result.content[0].text).model, MODEL);
  const invalid = await client.callTool({ name: 'get_status', arguments: { job_id: '../../invalid' } });
  assert.equal(invalid.isError, true);
  console.log('MCP handshake, tool discovery, health, and input validation passed.');
} finally { await client.close(); }
