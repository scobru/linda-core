# Ownership & Transfer on ZEN — Under a 1-of-N Honest Watcher Model

**Status:** Research / Design Phase  
**Date:** 2026-04-20  
**Author:** ZEN Core Team

---

## 1. Problem Statement

Most distributed systems fail at one deceptively simple task: **proving that exactly one entity owns exactly one thing, and that ownership can change hands without a trusted intermediary.**

Blockchains solve this, but they do so by introducing global consensus — miners, validators, stakers, a shared ledger that every participant must agree on. The cost is enormous: energy, latency, validator centralization, and a single point of regulatory or technical failure.

ZEN's goal is different: **local-first, peer-to-peer, no special roles, no validators, no global state.** Can ownership transfer work inside this model without a trusted third party?

This document argues: **yes, under a well-defined trust assumption that is weaker than "trustless" but stronger than requiring a trusted third party — and more honest about its trade-offs than most blockchain alternatives.**

---

## 2. Why This Is Hard

### 2.1 The Double-Spend Problem

Alice owns a sword. She wants to give it to Bob. The naive approach:

```
Alice writes: sword.owner = "bob"
```

But Alice can also write:

```
Alice writes: sword.owner = "carol"
```

In a distributed system, different peers may see different writes first. CRDT (last-write-wins) resolves this by taking the higher timestamp — but Alice controls her own timestamps. She can write both with the same timestamp, or forge a later one. **CRDT cannot solve ownership.**

### 2.2 FLP Impossibility and the Honest Trade-Off

Fischer, Lynch, and Paterson (1985) proved: **no deterministic algorithm can achieve consensus in an asynchronous network if even one process can fail.**

This means there is no perfect solution. Every ownership system is a compromise — including ZEN's. The table below maps each approach to its trust assumption:

| Approach | Trust assumption | What you sacrifice |
|---|---|---|
| Bitcoin (PoW) | ≥51% honest hashrate | Decentralization, energy, speed |
| Tendermint (BFT) | ≥2/3 honest validators | Permissioned validator set |
| Optimistic Rollup | ≥1 honest watcher + L1 liveness | Finality latency, L1 dependency |
| Notary | Single trusted party | Centralization |
| **ZEN ownership (current)** | **≥1 honest watcher + network liveness** | **Finality latency (must wait T)** |
| True "trustless" | Does not exist (FLP) | — |

ZEN's fraud-proof design sits in the same category as Optimistic Rollups: it requires **at least one honest peer to witness both forks during the challenge period T and broadcast fraud evidence**. This is sometimes called a **1-of-N honest watcher assumption**. If no peer witnesses both forks in time (due to eclipse or partition), the fraud can go undetected.

This assumption is weaker than "trustless" but considerably stronger than requiring a trusted third party. Naming it precisely matters: it tells you exactly what you must ensure at the network layer to uphold the security guarantee.

### 2.3 Off-Chain Payment is Unsolvable

If Bob pays Alice with fiat/crypto *outside* ZEN, and Alice then transfers the item *inside* ZEN — this is the **Two Generals Problem**. There is no protocol that atomically links an off-chain payment to an on-chain asset transfer without a trusted third party.

**ZEN does not claim to solve this.** It solves the *on-chain* half: proving who owns what inside the ZEN graph, without validators or global consensus.

---

## 3. Core Design: Optimistic Ownership with Fraud Proofs

### 3.1 Mental Model

Borrow from **Optimistic Rollups** (Arbitrum, Optimism), but without needing an L1 chain underneath:

> **Assume all transfers are valid. If fraud is detected during a challenge window, the fraudulent transfer is self-invalidating. After the window closes with no challenge, the transfer is final.**

No validators needed. No global agreement needed. Fraud proofs are pure cryptography — anyone can verify, no one has a special role.

### 3.2 The Three Rules

**Rule 1: Write-once claims**  
Each transfer claim is written to a unique soul derived from its signature hash. A claim, once written, cannot be overwritten (PEN enforces this). This is the foundation of fraud detection.

**Rule 2: Fork = burn**  
If two claims exist from the same previous owner pointing to different successors, the item is permanently burned. No winner. Both lose. This creates a **strong economic disincentive** against double-spending — the attacker loses the item too.

**Rule 3: Challenge period**  
A transfer is "pending" for T seconds (e.g., 60 seconds on LAN, 300–600 seconds on wide-area P2P). During this window, any honest peer can detect a fork and broadcast fraud evidence. After T with no fork detected, the transfer is final.

### 3.3 Safety Condition: Choosing T

> **Safety condition:** The challenge period T must be chosen such that `T >> expected_max_partition_duration` for the network topology in use. On a LAN with reliable connectivity, T=60s is reasonable. On wide-area P2P with potentially hostile relay nodes, T should be 300–600s minimum.
>
> **T is not a UX parameter — it is a security parameter derived from network characteristics.**

With gossip-of-gossip propagation over N peers, worst-case propagation time is `O(log N) × round_latency`. For typical ZEN meshes this is on the order of 1–2 seconds, so T=60s already provides a large safety margin. T should be calibrated using empirical measurements on the target network topology (see §11.0).

### 3.4 Active Witnessing During T

Passive receipt is insufficient during the challenge period. A node relying only on what peers push to it can be silenced by a targeted eclipse. **During T, the finalizing node must actively query diverse peers** for conflicting steps — not just wait for conflicts to arrive.

This transforms the 1-of-N watcher assumption: with active polling from diverse peers, any single honest peer in the queried set is sufficient to surface a fraud. The protocol's finalization gate enforces this requirement (see §5.2).

## 4. Data Structure

### 4.1 Soul Layout

```
item/<id>/current       → hash of the most recent valid transfer step
item/<id>/chain/<hash>  → individual transfer steps (append-only)
item/<id>/burned        → fraud evidence (if double-spend detected)
```

### 4.2 Transfer Step Format

Each step is a ZEN signed value:

```js
const step = await ZEN.sign({
    to: newOwner.pub,         // recipient's public key
    prev: prevStepHash,       // hash of previous step (links the chain)
    t: ZEN.state(),           // HAM timestamp
    item: itemId,             // which item
}, currentOwner);             // signed by current owner's keypair
```

After `ZEN.sign`, the value looks like:

```json
{
    ":": "{\"to\":\"...\",\"prev\":\"...\",\"t\":...,\"item\":\"...\"}",
    "~": "v1:r:s",
    "_": {}
}
```

No `"*"` field. Signer identity is recovered via `ZEN.recover(step)`.

### 4.3 Genesis (Item Creation)

```js
// Alice creates an item she owns
const genesis = await ZEN.sign({
    to: alice.pub,
    prev: null,
    t: ZEN.state(),
    item: itemId,
}, alice);

await zen.get(`item/${itemId}/chain/${hashOf(genesis)}`).put(genesis, alice);
await zen.get(`item/${itemId}/current`).put(hashOf(genesis), alice);
```

The item now exists in a neutral soul. Alice's namespace is not required. Alice is the owner by virtue of being the genesis signer — not by having a special flag.

---

## 5. Transfer Protocol

### 5.1 Alice Transfers to Bob (Bob Offline)

```js
async function transfer(itemId, fromPair, toPub) {
    const currentHash = await zen.get(`item/${itemId}/current`).then();
    const currentStep = await zen.get(`item/${itemId}/chain/${currentHash}`).then();

    // Alice signs a new step
    const newStep = await ZEN.sign({
        to: toPub,
        prev: currentHash,
        t: ZEN.state(),
        item: itemId,
    }, fromPair);

    const newHash = hashOf(newStep);

    // Write-once: PEN rejects if this hash already exists
    await zen.get(`item/${itemId}/chain/${newHash}`).put(newStep, fromPair);

    // Bob does NOT need to be online. Transfer is complete on Alice's side.
    // Bob reads item/${itemId}/current after challenge period to confirm.
}
```

**Bob is completely passive.** He comes online 10 minutes, 10 days, or 10 months later and reads the current pointer. If the challenge period has passed and no fork exists, he is the confirmed owner.

### 5.2 Challenge Period and Finalization

Finalization is split into two explicit phases to enforce active witnessing.

**Phase 1 — Active witnessing (during T):**

After receiving a transfer step, the interested node must actively broadcast the step and query diverse peers for conflicts — passive receipt is not sufficient.

```js
async function watchForConflicts(itemId, stepHash, duration) {
    const deadline = Date.now() + duration;
    const queriedPeers = new Set();

    while (Date.now() < deadline) {
        // Query a peer not yet asked, preferring high graph-distance peers
        const peer = selectDiversePeer(queriedPeers);
        const theirView = await peer.query(`item/${itemId}/chain`);
        const conflicts = findConflicts(theirView, stepHash);
        if (conflicts.length > 0) {
            return { status: "conflict", evidence: conflicts };
        }
        queriedPeers.add(peer.pub);
        await sleep(POLL_INTERVAL);
    }

    return { status: "clean" };
}
```

**Phase 2 — Finalization (after T, only if Phase 1 returned "clean"):**

```js
async function finalizeTransfer(itemId, pendingHash) {
    const step = await zen.get(`item/${itemId}/chain/${pendingHash}`).then();
    const { prev, t } = JSON.parse(step[":"]);

    // Check challenge period has passed
    if (ZEN.state() - t < CHALLENGE_PERIOD_MS) {
        throw new Error("Transfer still pending");
    }

    // Check for forks in the locally merged graph (defense-in-depth after active polling)
    const allSteps = await zen.get(`item/${itemId}/chain`).map().then();
    const conflicts = Object.values(allSteps).filter(s => {
        const m = JSON.parse(s[":"]);
        return m.prev === prev && hashOf(s) !== pendingHash;
    });

    if (conflicts.length > 0) {
        // Fork detected → burn (self-evident evidence, no trusted writer needed)
        await zen.get(`item/${itemId}/burned`).put({
            reason: "double-spend",
            evidence: [pendingHash, hashOf(conflicts[0])],
        });
        return { status: "burned" };
    }

    // No conflicts → update current pointer
    await zen.get(`item/${itemId}/current`).put(pendingHash);
    return { status: "confirmed", owner: JSON.parse(step[":"]).to };
}
```

> **Core invariant:** A transfer step can only be finalized if, during the challenge period T, the finalizing node actively queried a diverse set of peers and none reported a conflicting step for the same `prev`. Finalization must not proceed on local state alone.

### 5.3 Who Runs Finalization?

There is no special role. Anyone can run the two-phase protocol:

- **Bob**, when he comes online and wants to confirm he's the owner
- **Any peer** watching the network (automated watchers)
- **Alice herself**, to complete the transfer she initiated
- **A background process** in a ZEN relay node

This is the optimistic rollup pattern: you don't need anyone in particular to finalize — you just need *someone* to eventually do it, and the math guarantees they'll arrive at the same answer, provided the safety condition on T is met.

---

## 6. Storage Strategy: O(1) Long-Term

### 6.1 The Chain Growth Problem

Naive implementation: every transfer appends to the chain. After 1,000 transfers, the chain has 1,000 entries. Verification requires reading all 1,000. **This does not scale.**

### 6.2 Key Insight: Only the Leaf Can Fork

Once a transfer step has been finalized (challenge period passed, no conflicts), it **cannot be disputed**. Fraud can only happen at the **current pending step** (the leaf). Historical steps are immutable facts.

This means:

- To verify ownership: read `current` pointer → read that one step → check challenge period → check siblings for conflicts. **O(1).**
- The rest of the chain is audit trail only.

### 6.3 Lazy Pruning by Sender

When Bob transfers to Carol, he prunes the history:

```js
async function transferWithPrune(itemId, fromPair, toPub) {
    const currentHash = await zen.get(`item/${itemId}/current`).then();
    const currentStep = await zen.get(`item/${itemId}/chain/${currentHash}`).then();
    const { prev: grandparentHash } = JSON.parse(currentStep[":"]);

    // Create new step
    const newStep = await ZEN.sign({ to: toPub, prev: currentHash, ... }, fromPair);
    await zen.get(`item/${itemId}/chain/${hashOf(newStep)}`).put(newStep, fromPair);

    // Prune grandparent (no longer needed for fraud detection)
    if (grandparentHash) {
        await zen.get(`item/${itemId}/chain/${grandparentHash}`).put(null, fromPair);
    }
}
```

**Storage invariant:**

| State | Chain entries | Reason |
|---|---|---|
| Idle (owner holds item) | 1 | Only current step |
| Transfer in progress | 2 | Current + pending |
| After finalization | 1 again | Current only |
| Dispute (double-spend) | 2 + burned flag | Evidence preserved |

Long-term storage is **O(1) per item in the steady state** (item changes hands regularly). In the worst case: O(depth) if transfers are not finalized; O(∞) for burned items where fraud evidence must be retained indefinitely to prevent re-creation under the same item ID. A reconfirm mechanism (§6.4) exists for long-term holders but requires active participation with no protocol-level incentive.

> **Storage incentives are an open problem** — there is currently no mechanism that encourages nodes to retain fraud evidence long-term (see §10.6).

### 6.4 "Re-confirm" for Holders Who Never Transfer

If Bob holds an item forever and never transfers, his step stays. If he wants to clean up the chain without transferring:

```js
// Bob re-signs his ownership, pruning the incoming step from Alice
const reconfirm = await ZEN.sign({
    to: bob.pub,        // same owner
    prev: currentHash,  // same prev
    t: ZEN.state(),     // new timestamp
    item: itemId,
    action: "reconfirm",
}, bob);
// This prunes the step that Alice created
```

After challenge period, `reconfirm` becomes current. Alice's step gets pruned. **Chain resets to depth 1.**

---

## 7. PEN Policy Enforcement

PEN (ZEN's WASM policy engine) enforces the write rules at the protocol level. No application code can bypass these rules.

> **Layer note:** The `recover(S)` call in all policy pseudocode below is handled by the **ZEN-PEN Bridge** (Layer 1), not PEN Core (Layer 0). The bridge recovers the signer's public key from the signature using `ZEN.recover()`, then injects it into register R[5] before invoking PEN Core. PEN Core itself only performs register comparisons — it has no cryptographic capabilities. When reading the policies below, treat `recover(S)` as "the pub already placed in R[5] by the bridge."

### 7.1 Policy for `item/<id>/chain/<hash>`

```
POLICY chain-write:
  1. Input: new step S, writer W
  2. Recover signer: pub = recover(S)          // R[5], injected by ZEN-PEN Bridge
  3. Get current step C = graph[item/id/current]
  4. If C is null (genesis):
       Accept only if signer matches genesis conditions
  5. Else:
       current_owner = JSON.parse(C).to
       Assert pub === current_owner             // only owner can transfer
  6. Compute expected_hash = hash(S)
  7. Assert soul_key === expected_hash          // write-once (hash is the key)
  8. Assert soul does not exist yet             // truly write-once
  9. Accept.
```

### 7.2 Policy for `item/<id>/current`

```
POLICY current-update:
  1. Input: new hash H, writer W
  2. Get step S = graph[item/id/chain/H]
  3. Assert S exists
  4. Recover step signer: pub = recover(S)
  5. Get previous current step PC = graph[item/id/chain/current_pointer]
  6. Assert JSON.parse(PC).to === pub     // updater is the step's signer (previous owner)
     OR Assert JSON.parse(PC).to === W   // or the new owner finalizing their own receipt
  7. Check challenge period passed
  8. Check no sibling forks exist
  9. Accept.
```

### 7.3 Policy for `item/<id>/burned`

Without a policy here, any node can write a fake `burned` record with fabricated evidence — a **grief attack** that destroys Alice and Bob's item without any real double-spend. The fix: accept a burn write if and only if the evidence is cryptographically self-evident. No trusted writer is needed.

```
POLICY burned-write:
  1. Input: burn record B = { reason, evidence: [hash1, hash2] }
  2. Assert evidence is an array of exactly 2 distinct step hashes
  3. Get step1 = graph[item/id/chain/hash1]
  4. Get step2 = graph[item/id/chain/hash2]
  5. Assert step1 exists AND step2 exists
  6. Assert JSON.parse(step1).prev === JSON.parse(step2).prev  // same predecessor → fork
  7. Assert recover(step1) === recover(step2)                  // signed by the same sender
  8. Assert graph[item/id/burned] does not already exist       // write-once
  9. Accept.  // Evidence is self-proving; any node may write it.
```

This policy transforms burn into a **permission-less, self-evident operation**: whoever finds a fork first can write the burn evidence, and the policy engine verifies the evidence itself rather than trusting the writer's identity.

---

## 8. Attack Analysis

### 8.1 Double-Spend (Fork Attack)

**Attack:** Alice sends item to Bob via chain step A, then also sends to Carol via chain step B. Both reference the same `prev`.

**Defense:**
- Both A and B are write-once. Both get written to the graph (different hash keys).
- Any peer who syncs both detects the fork.
- Fork detection triggers burn. Alice loses the item. Bob and Carol get nothing.
- **Economic outcome:** Alice lost the item she was trying to steal. Strong disincentive.

**Residual risk:** Before sync (partition), Bob and Carol each believe they own it. After sync resolves, both discover the truth. Burn is then finalized.

### 8.2 Eclipse Attack

**Attack:** Alice controls Bob's peers during the transfer. She ensures Bob only sees "fork A" (transfer to Carol), not "fork B" (transfer to himself). After T seconds, Alice's preferred fork gets finalized while Bob's fork is isolated.

**Defense:** After partition heals, the burn rule still applies retroactively — *provided fraud evidence arrives before finalization*. The `current` pointer update requires passing conflict checks. If both forks exist in the merged graph, `current` update is rejected and burn is triggered.

**Critical caveat:** The burn rule applies retroactively **only if fraud evidence propagates before finalization**. If Alice can maintain an eclipse for the full duration T, fork A finalizes before the conflict is ever detected. This is the most precise attack vector against the system: it exploits the gap between the passive propagation assumption and the liveness requirement.

Mitigations:
1. **Active conflict polling** (Phase 1 of finalization, §5.2): query diverse peers during T, not just wait for gossip to arrive.
2. **T >> eclipse duration**: T must exceed Alice's realistic eclipse capacity, not just typical propagation time.
3. **Diverse peer connections**: connect to peers with different network paths to minimize eclipse surface.
4. **Onion routing / relay diversity**: prevent Alice from controlling a single network chokepoint.

**Residual risk:** If Alice can maintain a permanent eclipse, she can prevent Bob's fork from ever reaching other peers, and Carol's fork gets finalized. This is a network-layer attack; the protocol cannot defend against it without network-layer counter-measures.

### 8.3 Grief Attack

**Attack (self-grief):** Alice deliberately creates two conflicting transfers to burn her own item (out of spite, to deny Bob after Bob paid off-chain, etc.).

**Defense:** The protocol cannot prevent an owner from destroying their own item. If Alice is willing to burn it, she can. This is the Two Generals Problem — off-chain payment is not atomically linked to on-chain transfer.

**Attack (third-party grief):** Carol writes a fake `burned` record for Alice and Bob's item without any real double-spend.

**Defense:** The PEN policy for `item/<id>/burned` (§7.3) is self-evident — it accepts a burn write only if the submitted evidence (two step hashes) cryptographically proves a fork by the same sender. Carol cannot fabricate valid evidence without Alice's signing key.

**Mitigation for self-grief:** HTLC (Hash Time-Locked Contracts) for on-chain payment coordination (see §10).

### 8.4 Timestamp Manipulation

**Attack:** Alice creates a step with a fake future timestamp to extend or shrink the challenge period.

**Defense:** HAM (ZEN's CRDT) handles timestamp conflicts by taking the higher value. A future timestamp doesn't help Alice — it just means her step's challenge period starts later. A past timestamp would be overridden by HAM.

**Residual risk:** Skewed clocks in a network can cause minor finality variations (e.g., ±30 seconds). Challenge period T should be large enough to absorb clock skew.

### 8.5 Replay Attack

**Attack:** Alice keeps a copy of an old signed step from a previous transfer and replays it to reclaim the item.

**Defense:** Each step contains `prev: prevHash`. A replay of an old step would have the wrong `prev` (pointing to an old state that no longer matches `current`). The PEN policy rejects steps whose `prev` doesn't match the current pointer.

---

## 9. Comparison to Blockchain and Analogous Systems

This design reuses blockchain's foundational data structure (hash chain) but differs at every level of the stack. The closest analogs in the design space are Nano's block lattice and Lightning Network's payment channels.

### 9.1 Bitcoin / Ethereum vs. ZEN

| Property | Bitcoin/Ethereum | ZEN Ownership |
|---|---|---|
| **Data structure** | Hash chain | Hash chain |
| **Scope** | Global ledger (all txns) | Per-item micro-chain |
| **Consensus** | PoW / PoS (global agreement) | None — fraud proofs only |
| **Validators** | Miners / stakers | No special roles |
| **Finality** | Probabilistic (depth) | Deterministic after T |
| **History** | Immutable forever | Prunable (O(1) steady-state) |
| **Global clock** | Block height | Not required |
| **Throughput** | ~7–30 TPS (global) | Parallel per item |
| **Trust model** | ≥51% honest hashrate | ≥1 honest watcher + network liveness |

### 9.2 Nano, Lightning Network, and ZEN

| Property | Nano | Lightning Network | ZEN Ownership |
|---|---|---|---|
| Per-item/account chain | ✓ | ✓ (per channel) | ✓ |
| Fraud proofs | ✗ (delegated PoS voting) | ✓ (justice transactions) | ✓ |
| Settlement layer | Nano L1 | Bitcoin L1 | **Self (no L1)** |
| Receiver must be online | ✓ (receive block required) | ✓ (for routing) | ✗ |
| Challenge period | None | ~1 week | Configurable (T) |
| Trust assumption | Delegated representatives | ≥1 honest watcher | ≥1 honest watcher |

**Nano** is architecturally closest to ZEN: each account has its own chain, and no global consensus is needed for individual transfers. Nano resolves double-spend by delegated PoS voting (representatives). ZEN replaces that vote with fraud proofs — the fork itself is the evidence, and burn is the automatic penalty. This eliminates any representative-selection centralization.

**Lightning Network** uses the same optimistic pattern: off-chain state transitions optimistically, with fraud proofs (justice transactions) and a challenge period enforced by the Bitcoin L1. The critical difference is that Lightning settles on Bitcoin's L1 as a backstop; **ZEN has no L1** — it is its own settlement layer.

This "no L1" property is both a strength and a limitation:
- **Strength:** no dependency on an external blockchain; fully self-contained; no transaction fees or throughput bottleneck from a base layer.
- **Limitation:** no ultimate settlement fallback. If fraud evidence is suppressed for long enough, there is no external anchor to appeal to. T and active witnessing are the only safeguards.

ZEN consciously accepts this trade-off: the target use cases (game items, digital collectibles, access rights, certificates) rarely require the finality guarantees that justify L1 dependency costs.

---

## 10. Open Problems

### 10.1 Off-Chain Payment Atomicity (HTLC)

For atomic "Bob pays Alice, Alice transfers item" without trust:

**Hash Time-Locked Contract on ZEN:**

```
Alice creates:
  item/<id>/chain/<hash_A> = transfer to Bob,
  BUT with condition: only valid if Bob publishes preimage R
  where H(R) = agreed_hash

Bob creates (after seeing Alice's conditional transfer):
  payment/<payment_id> = payment to Alice,
  BUT with condition: only valid if Alice publishes preimage R

Alice reveals R → both conditions unlock atomically.
```

ZEN's PEN can implement the conditional logic. The challenge: **timing race.** If Alice reveals R just before T expires and Bob's payment times out, Alice gets the preimage credit but Bob's payment has already expired. This requires careful T alignment.

**Further research needed:** VDF (Verifiable Delay Function) to provide a provable time gap that prevents timing races.

### 10.2 Privacy

All ownership data is public in the current design. Anyone reading the ZEN graph can see:
- Who owns what item
- Full transfer history (even with pruning, current owner is visible)

**Approaches to explore:**
- **Stealth addresses:** recipient generates a one-time address; only recipient knows they own it
- **ZK proofs of ownership:** prove you own item X without revealing your public key
- **Encrypted item souls:** item data encrypted with owner's key; ownership proof is separate

### 10.3 Multi-Owner / Threshold Ownership

The current design assumes single-key ownership. Multi-sig ownership (e.g., item owned by 2-of-3 keys):

- Transfer requires M-of-N signatures on the new step
- ZEN's multi-sig primitives (if built) can verify the threshold
- Challenge period is same; burn rule is same

**Further research needed:** how to represent M-of-N in the step format, and how PEN policy verifies threshold signatures.

### 10.4 Rentals and Temporary Delegation

Alice owns item but wants to let Bob use it for 7 days:

```js
const rental = await ZEN.sign({
    type: "rental",
    to: bob.pub,
    expires: ZEN.state() + 7 * 24 * 3600 * 1000,
    item: itemId,
}, alice);
```

Bob can prove rental (not ownership) to third parties. After expiry, rental is void — but Alice still has the permanent transfer step. **No new step needed.**

PEN can enforce rental-specific policies (e.g., renter cannot sub-transfer, rental expires, etc.).

### 10.5 Chain Compaction via ZK Accumulators

If audit trail must be preserved (regulatory, provenance) but chain still needs to be O(1) verifiable:

**ZK accumulator approach:**
- Maintain a Merkle root of all historical steps
- Current owner provides a Merkle proof of their step
- Verification: check Merkle proof → O(log N), not O(N)

This requires ZK proof infrastructure that ZEN does not currently have. Long-term research direction.

### 10.6 Item Namespacing and Discovery

Current design: item souls are `item/<id>/...`. Who names the ID? Who discovers items?

- **Creator names:** Alice creates `item/alice-sword-001/...`
- **Content-addressed:** item ID = hash of genesis step (globally unique, no coordination)
- **Registry soul:** a discovery layer at `registry/<category>/<id>` pointing to items

Content-addressing is the most collision-resistant: `item/<hash_of_genesis>/...` — no naming conflicts possible, globally unique by construction.

### 10.7 Storage Incentives for Fraud Evidence

Burned items leave fraud evidence that must be retained indefinitely to prevent re-creation under the same item ID. Currently there is no protocol-level incentive for nodes to store this evidence long-term. Nodes may prune it to save space, creating a window for item resurrection attacks.

**Further research needed:** reputation systems, economic incentives, or archival node designation for fraud evidence storage.

---

## 11. Implementation Roadmap

### Phase 0: Network Primitives (Prerequisite for All Phases)

Without these primitives, Phase 1's `finalizeTransfer` will have a silent security bug: it checks only local state and passes when it should not, violating the core invariant.

- [ ] **Active peer querying for conflict detection** — `zen.get(path).fromPeers(k)` queries k diverse peers, not just local merged state
- [ ] **Propagation bound measurement** — empirical measurement of O(log N) propagation time on test network with N peers
- [ ] **T calibration tooling** — given measured propagation bound, compute a recommended safe T value
- [ ] **Gossip-of-gossip integration** — ensure fork broadcasts propagate to the full peer set within T; verify worst-case with simulated eclipse scenarios

### Phase 1: Core Protocol (Proof of Concept)
- [ ] `ZEN.item.create(pair, metadata)` — genesis step
- [ ] `ZEN.item.transfer(itemId, fromPair, toPub)` — transfer step
- [ ] `ZEN.item.owner(itemId)` — verify current owner
- [ ] `ZEN.item.finalize(itemId, hash)` — two-phase finalize (active poll + promote)
- [ ] PEN policy for `chain/*` (write-once, signer check)
- [ ] PEN policy for `burned` (self-evident burn, §7.3)

### Phase 2: Fraud Detection
- [ ] `ZEN.item.watch(itemId, cb)` — active conflict watcher during T
- [ ] Automatic burn on fork detection
- [ ] `ZEN.item.status(itemId)` — `pending | confirmed | burned`
- [ ] Peer broadcasting of fraud evidence

### Phase 3: Ergonomics
- [ ] `ZEN.item.transfer(itemId, fromPair, toPub, { prune: true })` — transfer + prune
- [ ] `ZEN.item.reconfirm(itemId, pair)` — reconfirm + prune without transfer
- [ ] Chain explorer utility

### Phase 4: Advanced
- [ ] Rental / temporary delegation
- [ ] Multi-sig ownership
- [ ] HTLC for atomic payment-transfer
- [ ] Stealth address recipient

---

## 12. Summary

ZEN implements ownership transfer under a **1-of-N honest watcher assumption**: as long as at least one honest peer witnesses both forks during the challenge period T and fraud evidence propagates before finalization, fraud is self-defeating. This is weaker than "trustless" (which FLP impossibility shows cannot exist in an asynchronous network) but stronger than requiring a trusted third party.

The design:

1. **Uses ZEN's native primitives**: `ZEN.sign`, `ZEN.recover`, HAM CRDT, PEN policies
2. **Fraud proofs replace consensus**: double-spend is self-detecting and self-punishing
3. **Bob never needs to be online to receive**: transfer is one-sided (Alice signs, Bob reads later)
4. **O(1) storage in steady state**: lazy pruning by sender keeps chain at depth 1–2; burned items retain evidence indefinitely
5. **O(1) verification**: only the leaf of the chain matters; history is confirmed and irrelevant

The honest trade-offs:
- **Finality latency** (challenge period T) — unavoidable under FLP impossibility
- **Network liveness requirement** — partition must heal before finalization; T must be chosen with this in mind
- **Active witnessing obligation** — finalization requires querying diverse peers during T, not just passive receipt
- **No L1 settlement fallback** — ZEN is its own settlement layer; T and active witnessing are the only safeguards

For most real-world use cases (game items, digital collectibles, access rights, certificates), a 60–600 second finality window is entirely acceptable, and the trust assumption is far more honest than blockchain alternatives that obscure similar assumptions under "decentralization" language.

---

*Next: implement Phase 0 network primitives, then Phase 1 as a standalone `lib/item.js` module, and validate against the PANIC test suite.*
