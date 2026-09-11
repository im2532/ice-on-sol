import { expect } from "chai";
import { buildTree, buildTreeFromInputs, getProof, hashLeaf, verify, verifyInput, type MerkleLeafInput } from "./merkle";

function pk(seed: number): Buffer {
  const buf = Buffer.alloc(32, 0);
  buf.writeUInt32LE(seed, 0);
  return buf;
}

describe("merkle.ts", () => {
  const epoch = pk(999);

  it("hashLeaf is deterministic for the same input", () => {
    const input: MerkleLeafInput = { epoch, wallet: pk(1), amount: 12345n };
    expect(hashLeaf(input).equals(hashLeaf({ ...input }))).to.equal(true);
  });

  it("hashLeaf differs when amount differs", () => {
    const a = hashLeaf({ epoch, wallet: pk(1), amount: 1n });
    const b = hashLeaf({ epoch, wallet: pk(1), amount: 2n });
    expect(a.equals(b)).to.equal(false);
  });

  it("builds a tree and verifies every leaf's proof against the root (even leaf count)", () => {
    const inputs: MerkleLeafInput[] = Array.from({ length: 8 }, (_, i) => ({
      epoch,
      wallet: pk(i),
      amount: BigInt(1000 * (i + 1)),
    }));
    const tree = buildTreeFromInputs(inputs);
    for (let i = 0; i < inputs.length; i++) {
      const proof = getProof(tree, i);
      expect(verify(tree.leaves[i], proof, tree.root)).to.equal(true);
      expect(verifyInput(inputs[i], proof, tree.root)).to.equal(true);
    }
  });

  it("handles odd leaf counts by carrying the unpaired node up", () => {
    const inputs: MerkleLeafInput[] = Array.from({ length: 7 }, (_, i) => ({
      epoch,
      wallet: pk(i),
      amount: BigInt(100 * (i + 1)),
    }));
    const tree = buildTreeFromInputs(inputs);
    for (let i = 0; i < inputs.length; i++) {
      const proof = getProof(tree, i);
      expect(verifyInput(inputs[i], proof, tree.root)).to.equal(true);
    }
  });

  it("handles a single-leaf tree (root == leaf, empty proof)", () => {
    const inputs: MerkleLeafInput[] = [{ epoch, wallet: pk(1), amount: 42n }];
    const tree = buildTreeFromInputs(inputs);
    expect(tree.root.equals(tree.leaves[0])).to.equal(true);
    const proof = getProof(tree, 0);
    expect(proof.length).to.equal(0);
    expect(verifyInput(inputs[0], proof, tree.root)).to.equal(true);
  });

  it("rejects a tampered amount", () => {
    const inputs: MerkleLeafInput[] = Array.from({ length: 5 }, (_, i) => ({
      epoch,
      wallet: pk(i),
      amount: BigInt(10 * (i + 1)),
    }));
    const tree = buildTreeFromInputs(inputs);
    const proof = getProof(tree, 2);
    const tampered: MerkleLeafInput = { ...inputs[2], amount: inputs[2].amount + 1n };
    expect(verifyInput(tampered, proof, tree.root)).to.equal(false);
  });

  it("rejects a proof against the wrong root", () => {
    const inputsA: MerkleLeafInput[] = Array.from({ length: 4 }, (_, i) => ({
      epoch,
      wallet: pk(i),
      amount: BigInt(i + 1),
    }));
    const inputsB: MerkleLeafInput[] = Array.from({ length: 4 }, (_, i) => ({
      epoch,
      wallet: pk(i + 100),
      amount: BigInt(i + 1),
    }));
    const treeA = buildTreeFromInputs(inputsA);
    const treeB = buildTreeFromInputs(inputsB);
    const proofA0 = getProof(treeA, 0);
    expect(verifyInput(inputsA[0], proofA0, treeB.root)).to.equal(false);
  });

  it("proof order doesn't matter for verification correctness at each layer (sorted-pair hashing)", () => {
    // buildTree from raw leaf buffers directly (bypassing hashLeaf) also round-trips.
    const rawLeaves = Array.from({ length: 6 }, (_, i) => hashLeaf({ epoch, wallet: pk(i), amount: BigInt(i) }));
    const tree = buildTree(rawLeaves);
    for (let i = 0; i < rawLeaves.length; i++) {
      const proof = getProof(tree, i);
      expect(verify(rawLeaves[i], proof, tree.root)).to.equal(true);
    }
  });
});
