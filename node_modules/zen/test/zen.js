import assert from 'assert';
import * as ZenModule from '../zen.js';
import ZENDefault, { ZEN } from '../zen.js';

describe('ZEN', function() {
  it('exports the ZEN class by default', function() {
    assert.strictEqual(ZENDefault, ZEN);
  });

  it('exposes only ZEN from the public entry', function() {
    assert.strictEqual(typeof ZenModule.GUN, 'undefined');
    assert.strictEqual(typeof ZenModule.PEN, 'undefined');
    assert.strictEqual(typeof ZenModule.createZEN, 'undefined');
  });

  it('keeps merged helpers on class and instance', function() {
    var zen = new ZEN();
    var soul = ZEN.pen({ key: 'fixed' });
    assert.strictEqual(typeof soul, 'string');
    assert.ok(soul.startsWith('!'));
    assert.strictEqual(zen.pen({ key: 'fixed' }), soul);
    assert.strictEqual(typeof ZEN.certify, 'function');
    assert.strictEqual(typeof zen.certify, 'function');
  });

  it('merges graph crypto and pen statics onto ZEN', function() {
    assert.strictEqual(typeof ZEN.state, 'function');
    assert.strictEqual(typeof ZEN.valid, 'function');
    assert.ok(ZEN.graph);
    assert.strictEqual(typeof ZEN.graph.create, 'function');
    assert.strictEqual(typeof ZEN.Buffer, 'function');
    assert.strictEqual(typeof ZEN.random, 'function');
    assert.strictEqual(typeof ZEN.keyid, 'function');
    assert.strictEqual(typeof ZEN.check, 'function');
    assert.ok(ZEN.security && ZEN.opt);
    assert.strictEqual(ZEN.security.opt, ZEN.opt);
    assert.strictEqual(typeof ZEN.pack, 'function');
    assert.strictEqual(typeof ZEN.unpack, 'function');
    assert.strictEqual(typeof ZEN.run, 'function');
    assert.ok(ZEN.ready && typeof ZEN.ready.then === 'function');
  });

  it('creates isolated instances without globals', function() {
    var a = new ZEN({ graphOpt: { localStorage: false, peers: [] } });
    var b = new ZEN({ graphOpt: { localStorage: false, peers: [] } });
    assert.ok(a instanceof ZEN);
    assert.ok(b instanceof ZEN);
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a.chain(), b.chain());
    assert.strictEqual(globalThis.ZEN, undefined);
  });

  it('bridges ZEN helpers', async function() {
    var zen = new ZEN();
    var pair = await zen.pair();
    assert.strictEqual(typeof ZEN.sign, 'function');
    assert.strictEqual(ZEN.opt.pub('~' + pair.pub + '/profile'), pair.pub);
    assert.strictEqual(pair.curve, 'secp256k1');
    assert.strictEqual(typeof pair.pub, 'string');
    assert.strictEqual(pair.pub.length, 45);
  });

  it('loads security runtime through ZEN', function() {
    var zen = new ZEN({ localStorage: false, peers: [] });
    var graph = zen.chain();
    assert.ok(graph._.root.zen);
    assert.strictEqual(typeof graph._.root.zen.own, 'object');
  });

  it('accepts graph-native runtime options and instances', function() {
    var graph = ZEN.graph.create({ localStorage: false, peers: [] });
    var zen = new ZEN({ graph: graph });
    assert.strictEqual(zen.chain(), graph);
    assert.ok(ZEN.graph.is(graph));
  });

  it('mirrors ZEN chain and PEN methods onto instances', function() {
    var zen = new ZEN({ localStorage: false, peers: [] });
    var raw = Uint8Array.from([1, 2, 3, 4]);
    assert.strictEqual(typeof zen.opt, 'function');
    assert.strictEqual(typeof zen.then, 'function');
    assert.strictEqual(typeof zen.pack, 'function');
    assert.strictEqual(typeof zen.unpack, 'function');
    assert.deepStrictEqual(Array.from(zen.unpack(zen.pack(raw))), Array.from(raw));
  });
});
