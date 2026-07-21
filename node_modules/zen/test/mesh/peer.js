import fs from 'fs';
import http from 'http';
import path from 'path';
import ZEN from '../../index.js';

const id = Number(process.argv[2]);
const port = Number(process.argv[3]);
const file = process.argv[4];

let server;
let zen;
const seen = new Map();

function isSocketDrop(error) {
  const text = error?.stack || error?.message || String(error);
  return /ECONNRESET|EPIPE/.test(text);
}

function reply(message, ok, value, error) {
  process.send?.({
    type: 'reply',
    id: message.id,
    ok,
    value,
    error
  });
}

function plainValue(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const copy = { ...data };
  delete copy._;
  return copy;
}

function listen(app, listenPort) {
  return new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(listenPort, () => {
      app.removeListener('error', reject);
      resolve();
    });
  });
}

function close(app) {
  return new Promise((resolve) => {
    if (!app || !app.listening) return resolve();
    app.close(() => resolve());
  });
}

function onceValue(chain, timeoutMs = 500) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(undefined);
    }, timeoutMs);
    chain.once((data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(plainValue(data));
    });
  });
}

async function start(peers) {
  if (zen) {
    return {
      osPid: process.pid,
      zenPid: zen.chain().back('opt.pid')
    };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  zen = new ZEN({
    file,
    peers,
    web: server,
    localStorage: false,
    axe: false,
    multicast: false
  });
  zen._graph;
  const route = zen.get('mesh');
  route.on(() => {});
  route.map().on((data, key) => {
    if (typeof key === 'string' && typeof data !== 'undefined') {
      seen.set(key, plainValue(data));
    }
  });
  return {
    osPid: process.pid,
    zenPid: zen.chain().back('opt.pid')
  };
}

async function put(key, value) {
  return new Promise((resolve, reject) => {
    zen.get('mesh').get(key).put(value, (ack) => {
      if (ack?.err) return reject(new Error(String(ack.err)));
      resolve();
    });
  });
}

async function get(key) {
  let value = seen.get(key);
  if (typeof value !== 'undefined') return value;
  value = await onceValue(zen.get('mesh').get(key));
  if (typeof value !== 'undefined') seen.set(key, value);
  return value;
}

process.on('uncaughtException', (error) => {
  if (isSocketDrop(error)) return;
  process.send?.({ type: 'fatal', error: error?.stack || String(error) });
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  if (isSocketDrop(error)) return;
  process.send?.({ type: 'fatal', error: error?.stack || String(error) });
  process.exit(1);
});

process.on('message', async (message) => {
  try {
    switch (message.type) {
      case 'start':
        reply(message, true, await start(message.peers || []));
        return;
      case 'put':
        await put(message.key, message.value);
        reply(message, true, null);
        return;
      case 'get':
        reply(message, true, await get(message.key));
        return;
      case 'shutdown':
        reply(message, true, null);
        await close(server);
        process.exit(0);
        return;
      default:
        reply(message, false, null, `unknown command: ${message.type}`);
    }
  } catch (error) {
    reply(message, false, null, error?.stack || String(error));
  }
});

server = http.createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`peer-${id}`);
});

await listen(server, port);
process.send?.({ type: 'listening', id, port, osPid: process.pid, file });
