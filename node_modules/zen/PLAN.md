# ZEN PLAN

## Mission

ZEN exists to replace GUN in `akao`.

This is not a speculative rewrite. It is a successor direction built on:

> GUN -> akaoio/gun -> ZEN

The plan is to keep the strongest parts of the lineage, remove legacy layers that are no longer needed, and rebuild the core around a cleaner architecture.

## Core rules

1. **PEN is the core policy system.**
2. **Tests are the spec.** Tests go first, fail first, code comes later, then red turns green.
3. **ZEN node metadata must match GUN node metadata.**
4. **`state` comes from `zen.now`, not `Gun.state()`.**
5. **`zen.now = Math.floor(Date.now() / candle)`**, with `candle = 1` by default.
6. **ZEN favors secp256k1, base62, and clean JSON crypto.**
7. **ZEN should reuse strong lineage pieces instead of rewriting them without need**, especially `gun/lib/opfs.js`.

## What ZEN keeps

- graph-first thinking
- offline-first sync mindset
- CRDT / HAM intuition
- P2P orientation
- abstract symbolic graph keys like `>`, `#`, `.`, `:`, `~`
- OPFS reuse from `akaoio/gun`
- PEN lineage and base62-oriented bytecode identity

## What ZEN drops

- `SEA.certify` as a first-class architecture layer
- user namespace model as a first-class architecture layer
- content-address as a separate feature layer
- SEA-style prefixed or wrapped crypto payload formats
- wrapper-heavy auth/session layering where policy should live in PEN

## Architecture direction

### 1. Runtime and compute

- move toward Zig -> WASM for heavy compute paths
- keep browser / server / edge direction
- preserve worker-friendly thinking

### 2. Storage

- reuse `gun/lib/opfs.js` first
- only fork storage behavior when ZEN truly needs a different contract
- keep OPFS as the preferred local-first browser persistence direction

### 3. Crypto

- use secp256k1 as the baseline
- support deterministic identity from seed
- keep JSON-native `sign`, `verify`, `encrypt`, `decrypt`
- prefer base62-friendly identifiers and encodings

### 4. Graph semantics

- keep GUN-compatible node metadata shape
- keep symbolic key naming close to GUN
- replace state clock semantics with candle-based `zen.now`

### 5. Policy and execution

- PEN becomes the center of policy and execution
- avoid rebuilding legacy SEA-era feature layers
- treat executable logic as a first-class part of the graph direction

## Delivery order

### Phase 1: documentation and architecture alignment

- keep README aligned with reality, lineage, and direction
- keep diary entries as design memory
- preserve architectural rules in docs before implementation drifts

### Phase 2: minimal executable core

- define the first ZEN runtime shape
- define instance init with `candle`
- define metadata contract identical to GUN node metadata
- define `zen.now` behavior

### Phase 3: crypto and policy core

- land secp256k1 baseline
- land clean JSON crypto behavior
- land PEN as the policy core

### Phase 4: storage and local-first persistence

- integrate OPFS through reused lineage components
- define persistence contract for ZEN runtime

### Phase 5: replacement path for akao

- identify the first GUN surfaces in `akao` to replace
- migrate by real product slices, not theory

## README discipline

ZEN docs must keep every claim labeled implicitly or explicitly as one of:

- **current repo reality**
- **inherited lineage from `akaoio/gun`**
- **ZEN direction**

If these are mixed together carelessly, the docs stop being trustworthy.

## Success condition

ZEN succeeds when it is no longer just a design direction, but the real graph + crypto + execution core that can replace GUN inside `akao` with a simpler and stronger architecture.
