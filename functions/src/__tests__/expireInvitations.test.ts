import {Timestamp} from "firebase-admin/firestore";

const batchUpdate = jest.fn();
const batchCommit = jest.fn().mockResolvedValue(undefined);
const fakeBatch = {update: batchUpdate, commit: batchCommit};

const queryChain = {
  where: jest.fn().mockReturnThis(),
  get: jest.fn(),
};

const fakeDb = {
  collection: jest.fn(() => queryChain),
  batch: jest.fn(() => fakeBatch),
};

jest.mock("firebase-admin/firestore", () => {
  const actual = jest.requireActual("firebase-admin/firestore");
  return {
    ...actual,
    FieldValue: {
      serverTimestamp: jest.fn(() => "<serverTimestamp>"),
    },
    getFirestore: jest.fn(() => fakeDb),
  };
});

import {expireInvitations} from "../expireInvitations";

const handler = (
  expireInvitations as unknown as {run: (event: unknown) => Promise<void>}
).run;

beforeEach(() => {
  batchUpdate.mockReset();
  batchCommit.mockReset();
  batchCommit.mockResolvedValue(undefined);
  queryChain.where.mockClear();
  queryChain.get.mockReset();
  fakeDb.collection.mockClear();
  fakeDb.batch.mockClear();
});

describe("expireInvitations", () => {
  it("marks pending+past-expiry docs as expired", async () => {
    const docRef = {id: "tok-1"};
    queryChain.get.mockResolvedValueOnce({
      empty: false,
      docs: [{ref: docRef}],
    });

    await handler({} as unknown);

    expect(batchUpdate).toHaveBeenCalledWith(
      docRef,
      expect.objectContaining({status: "expired"}),
    );
    expect(batchCommit).toHaveBeenCalled();
  });

  it("no-ops when no pending+past-expiry docs match", async () => {
    queryChain.get.mockResolvedValueOnce({empty: true, docs: []});

    await handler({} as unknown);

    expect(batchUpdate).not.toHaveBeenCalled();
    expect(batchCommit).not.toHaveBeenCalled();
  });

  it("only includes status=pending in the query", async () => {
    queryChain.get.mockResolvedValueOnce({empty: true, docs: []});

    await handler({} as unknown);

    // Two .where() calls: status==pending, expiresAt<now.
    expect(queryChain.where).toHaveBeenCalledWith("status", "==", "pending");
    expect(queryChain.where).toHaveBeenCalledWith(
      "expiresAt",
      "<",
      expect.any(Timestamp),
    );
  });

  it("chunks updates into batches of 500", async () => {
    const manyDocs = Array.from({length: 750}, (_, i) => ({
      ref: {id: `tok-${i}`},
    }));
    queryChain.get.mockResolvedValueOnce({empty: false, docs: manyDocs});

    await handler({} as unknown);

    // 750 updates spread across two batches.
    expect(batchUpdate).toHaveBeenCalledTimes(750);
    expect(batchCommit).toHaveBeenCalledTimes(2);
  });
});
