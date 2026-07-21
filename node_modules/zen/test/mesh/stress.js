import assert from 'assert';
import { fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PEER_COUNT = Number(process.env.ZEN_MESH_PEERS || 5);
const WRITES_PER_PEER = Number(process.env.ZEN_MESH_WRITES || 20);
const OFFLINE_WRITES = Number(process.env.ZEN_MESH_OFFLINE_WRITES || 8);
const BASE_PORT = Number(process.env.ZEN_MESH_BASE_PORT || 9900);
const WAIT_TIMEOUT_MS = Number(process.env.ZEN_MESH_TIMEOUT || 45000);
const STARTUP_SETTLE_MS = Number(process.env.ZEN_MESH_STARTUP_SETTLE || 1500);
const DATA_ROOT = path.join(__dirname, '..', '..', 'tmp', 'mesh-stress');
const WORKER_PATH = path.join(__dirname, 'peer.js');

let rpcSeq = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fileFor(id, suffix = '') {
  return path.join(DATA_ROOT, `peer-${id}${suffix ? `-${suffix}` : ''}`);
}

function peerUrl(port) {
  return `http://127.0.0.1:${port}/zen`;
}

function cleanupData() {
  fs.rmSync(DATA_ROOT, { recursive: true, force: true });
  fs.mkdirSync(DATA_ROOT, { recursive: true });
}

async function waitFor(check, { timeoutMs = WAIT_TIMEOUT_MS, intervalMs = 150, label = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return true;
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function peerPorts(id, ports) {
  return ports.filter((_, index) => index !== id).map(peerUrl);
}

function rejectPending(peer, error) {
  for (const pending of peer.pending.values()) {
    pending.reject(error);
  }
  peer.pending.clear();
}

function spawnPeer(id, port, file) {
  return new Promise((resolve, reject) => {
    const child = fork(WORKER_PATH, [String(id), String(port), file], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    const peer = {
      id,
      port,
      file,
      child,
      pending: new Map(),
      exited: false,
      failure: null,
      osPid: null,
      zenPid: null,
      stdout: '',
      stderr: ''
    };

    const fail = (error) => {
      rejectPending(peer, error);
      reject(error);
    };

    child.stdout?.on('data', (chunk) => {
      peer.stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      peer.stderr += chunk.toString();
    });
    child.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'listening') {
        peer.osPid = message.osPid;
        resolve(peer);
        return;
      }
      if (message.type === 'reply') {
        const pending = peer.pending.get(message.id);
        if (!pending) return;
        peer.pending.delete(message.id);
        if (message.ok) {
          pending.resolve(message.value);
        } else {
          pending.reject(new Error(message.error || `peer-${id} RPC failed`));
        }
        return;
      }
      if (message.type === 'fatal') {
        peer.failure = message.error || `peer-${id} crashed`;
        fail(new Error(peer.failure));
      }
    });
    child.once('error', fail);
    child.once('exit', (code, signal) => {
      peer.exited = true;
      const detail = peer.failure || peer.stderr || peer.stdout || `peer-${id} exited (${code ?? 'null'}${signal ? `, ${signal}` : ''})`;
      rejectPending(peer, new Error(detail));
    });
  });
}

function call(peer, type, payload = {}) {
  if (peer.exited) {
    const detail = peer.failure || peer.stderr || peer.stdout || `peer-${peer.id} is not running`;
    return Promise.reject(new Error(detail));
  }
  return new Promise((resolve, reject) => {
    const id = `${type}-${++rpcSeq}`;
    peer.pending.set(id, { resolve, reject });
    peer.child.send({ id, type, ...payload });
  });
}

async function activatePeer(peer, ports) {
  const started = await call(peer, 'start', { peers: peerPorts(peer.id, ports) });
  peer.zenPid = started.zenPid;
  peer.osPid = started.osPid;
}

async function putValue(peer, key, value) {
  await call(peer, 'put', { key, value });
}

async function expectValue(peer, key, expected, label) {
  await waitFor(async () => {
    const value = await call(peer, 'get', { key });
    try {
      assert.deepStrictEqual(value, expected);
      return true;
    } catch {
      return false;
    }
  }, { label });
}

async function stopPeer(peer) {
  if (!peer || peer.exited) return;
  try {
    await call(peer, 'shutdown');
  } catch {}
  await Promise.race([
    new Promise((resolve) => peer.child.once('exit', resolve)),
    delay(3000).then(() => {
      if (!peer.exited) peer.child.kill('SIGKILL');
    })
  ]);
}

async function startMesh() {
  cleanupData();
  const ports = Array.from({ length: PEER_COUNT }, (_, i) => BASE_PORT + i);
  const peers = await Promise.all(
    ports.map((port, id) => spawnPeer(id, port, fileFor(id)))
  );
  await Promise.all(peers.map((peer) => activatePeer(peer, ports)));
  await delay(STARTUP_SETTLE_MS);
  const osPids = new Set(peers.map((peer) => peer.osPid));
  const zenPids = new Set(peers.map((peer) => peer.zenPid));
  assert.strictEqual(osPids.size, peers.length, 'each peer must run in its own process');
  assert.strictEqual(zenPids.size, peers.length, 'each peer must expose its own ZEN pid');
  return { peers, ports };
}

async function stopMesh(peers) {
  await Promise.all(peers.map((peer) => stopPeer(peer).catch(() => {})));
}

describe('ZEN mesh stress', function() {
  this.timeout(2 * 60 * 1000);

  let peers = [];
  let ports = [];

  before(async function() {
    ({ peers, ports } = await startMesh());
  });

  after(async function() {
    await stopMesh(peers);
    cleanupData();
  });

  it(`converges ${PEER_COUNT} fully-connected peers under concurrent writes`, async function() {
    const expected = new Map();
    const writes = [];

    peers.forEach((peer, peerIndex) => {
      for (let i = 0; i < WRITES_PER_PEER; i += 1) {
        const key = `peer-${peerIndex}-write-${i}`;
        const value = {
          from: peerIndex,
          index: i,
          stamp: `${peerIndex}:${i}`,
          payload: `stress-${peerIndex}-${i}`
        };
        expected.set(key, value);
        writes.push(putValue(peer, key, value));
      }
    });

    await Promise.all(writes);

    for (const [key, value] of expected.entries()) {
      await Promise.all(
        peers.map((peer) =>
          expectValue(peer, key, value, `peer-${peer.id} to receive ${key}`)
        )
      );
    }
  });

  it('resyncs a restarted peer after the rest continue writing', async function() {
    const expected = new Map();

    await stopPeer(peers[0]);

    for (let i = 0; i < OFFLINE_WRITES; i += 1) {
      const writer = peers[(i % (peers.length - 1)) + 1];
      const key = `offline-phase-${i}`;
      const value = {
        writer: writer.id,
        phase: 'offline',
        index: i,
        payload: `catchup-${i}`
      };
      expected.set(key, value);
      await putValue(writer, key, value);
    }

    peers[0] = await spawnPeer(0, ports[0], fileFor(0, `restart-${Date.now()}`));
    await activatePeer(peers[0], ports);
    await delay(STARTUP_SETTLE_MS);

    for (const [key, value] of expected.entries()) {
      await expectValue(peers[0], key, value, `restarted peer to receive ${key}`);
    }
  });
});
