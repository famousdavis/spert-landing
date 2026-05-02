import {HttpsError} from "firebase-functions/v2/https";

const fakeTx = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const fakeDocRef = {id: "uid-1"};

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: jest.fn(() => "<serverTimestamp>"),
  },
  getFirestore: jest.fn(() => ({
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn(() => fakeDocRef),
    runTransaction: jest.fn(async (fn: (tx: typeof fakeTx) => unknown) =>
      fn(fakeTx),
    ),
  })),
}));

import {checkAndIncrement, LIMIT_MSG} from "../rateLimiter";

beforeEach(() => {
  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeTx.update.mockReset();
  fakeTx.delete.mockReset();
});

describe("checkAndIncrement", () => {
  it("creates a fresh doc when none exists", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false,
      get: () => undefined,
    });

    await checkAndIncrement("uid-1", 3, "2026-05-02");

    expect(fakeTx.set).toHaveBeenCalledWith(
      fakeDocRef,
      expect.objectContaining({date: "2026-05-02", count: 3}),
    );
    expect(fakeTx.update).not.toHaveBeenCalled();
  });

  it("increments same-day counter", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => (k === "date" ? "2026-05-02" : 5),
    });

    await checkAndIncrement("uid-1", 4, "2026-05-02");

    expect(fakeTx.update).toHaveBeenCalledWith(
      fakeDocRef,
      expect.objectContaining({count: 9}),
    );
    expect(fakeTx.set).not.toHaveBeenCalled();
  });

  it("resets counter when the UTC date rolls over", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => (k === "date" ? "2026-05-01" : 25),
    });

    await checkAndIncrement("uid-1", 1, "2026-05-02");

    expect(fakeTx.set).toHaveBeenCalledWith(
      fakeDocRef,
      expect.objectContaining({date: "2026-05-02", count: 1}),
    );
  });

  it("throws resource-exhausted when over the daily cap", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => (k === "date" ? "2026-05-02" : 25),
    });

    await expect(
      checkAndIncrement("uid-1", 1, "2026-05-02"),
    ).rejects.toMatchObject({
      code: "resource-exhausted",
      message: LIMIT_MSG,
    });
    expect(fakeTx.update).not.toHaveBeenCalled();
    expect(fakeTx.set).not.toHaveBeenCalled();
  });

  it("rejection is an HttpsError", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => (k === "date" ? "2026-05-02" : 25),
    });

    await expect(
      checkAndIncrement("uid-1", 1, "2026-05-02"),
    ).rejects.toBeInstanceOf(HttpsError);
  });
});
