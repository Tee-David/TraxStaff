import { createHash } from "node:crypto";

// Tamper-evident hash chain over locally-queued activity blocks.
//
// Each block carries a monotonically increasing sequenceNo and a hash computed
// as sha256(prevHash + canonical(block)). The first block in a session chains
// from GENESIS. On sync the server recomputes each hash and checks that every
// block's prevHash equals the prior block's hash and that sequence numbers are
// contiguous — a broken chain, altered field, or missing row is detectable.
//
// The Rust desktop client MUST produce byte-identical canonical strings, so the
// format below is the shared contract: pipe-joined fields, numbers with fixed
// precision, timestamps as ISO-8601 UTC (milliseconds).

export const GENESIS = "GENESIS";

export interface ChainBlock {
  sessionId: string;
  sequenceNo: number;
  blockStart: string; // ISO-8601 UTC
  blockEnd: string; // ISO-8601 UTC
  keyboardPct: number;
  mousePct: number;
  activityPct: number;
  idleSeconds: number;
}

function num(n: number): string {
  // Fixed 2-decimal representation so client/server agree bit-for-bit.
  return n.toFixed(2);
}

export function canonical(b: ChainBlock): string {
  return [
    b.sessionId,
    b.sequenceNo,
    new Date(b.blockStart).toISOString(),
    new Date(b.blockEnd).toISOString(),
    num(b.keyboardPct),
    num(b.mousePct),
    num(b.activityPct),
    b.idleSeconds,
  ].join("|");
}

export function computeHash(prevHash: string, b: ChainBlock): string {
  return createHash("sha256").update(prevHash + canonical(b)).digest("hex");
}

export interface ChainVerifyResult {
  /** True when the chain is both complete and unaltered. */
  ok: boolean;
  reasons: string[];
  /**
   * A block's own hash does not match its own contents. This is the only
   * finding that PROVES alteration: it is self-contained, needs no neighbouring
   * block, and cannot be produced by delivery order.
   */
  altered: boolean;
  /**
   * A block is missing, so sequence numbers or prevHash links do not line up.
   * Expected in normal operation — the client is offline-first and a queued
   * block routinely flushes after later blocks have already synced inline — and
   * it resolves itself when the gap fills. Not evidence of anything.
   */
  incomplete: boolean;
}

/**
 * Verify a batch of blocks forms a contiguous, unbroken chain starting from
 * `startingPrevHash` (the hash of the last block already stored for this
 * session, or GENESIS for a fresh session). Returns all problems found; never
 * throws. Ingestion proceeds regardless — the caller decides to flag, not block.
 */
export function verifyChain(
  blocks: (ChainBlock & { prevHash: string; hash: string })[],
  startingPrevHash: string,
  startingSequenceNo: number
): ChainVerifyResult {
  const reasons: string[] = [];
  let expectedPrev = startingPrevHash;
  let expectedSeq = startingSequenceNo;
  let altered = false;
  let incomplete = false;

  for (const b of blocks) {
    if (b.sequenceNo !== expectedSeq) {
      reasons.push(`sequence gap: expected ${expectedSeq}, got ${b.sequenceNo}`);
      incomplete = true;
    }
    if (b.prevHash !== expectedPrev) {
      reasons.push(`chain break at seq ${b.sequenceNo}: prevHash mismatch`);
      incomplete = true;
    }
    const recomputed = computeHash(b.prevHash, b);
    if (recomputed !== b.hash) {
      reasons.push(`hash mismatch at seq ${b.sequenceNo}: block was altered`);
      altered = true;
    }
    expectedPrev = b.hash;
    expectedSeq = b.sequenceNo + 1;
  }

  return { ok: reasons.length === 0, reasons, altered, incomplete };
}
