(async () => {
  const createStore = window.CVPacketTest.DriveStore.create;
  const name = 'noesis-native-drive-store-fixture-v1';
  const original = IDBDatabase.prototype.transaction;
  let captured, abortNext = false;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = original.apply(this, args);
    if (this.name === name) {
      captured = this;
      if (args[1] === 'readwrite' && abortNext) {
        abortNext = false;
        queueMicrotask(() => tx.abort());
      }
    }
    return tx;
  };
  const seed = { v: 1, job: { fileId: 'synthetic-reserved', bytes: new Uint8Array([0, 1, 254, 255]) }, receipts: [{ id: 'fixture-receipt' }] };
  const store = createStore(name);
  let aborted = false, closedRejected = false;
  try {
    await store.write(seed);
    abortNext = true;
    try { await store.write({ v: 1, job: null, receipts: [] }); } catch { aborted = true; }
    const afterAbort = await store.read();
    captured.close();
    try { await store.read(); } catch { closedRejected = true; }
    const afterReopen = await store.read();
    captured.dispatchEvent(new Event('versionchange'));
    const afterVersionChange = await store.read();
    const recovery = new Uint8Array([9, 8, 7, 0, 255]);
    const hash = await store.recovery(recovery);
    const copy = await store.latestRecovery();
    const value = x => ({ ...x, job: { ...x.job, bytes: Array.from(x.job.bytes) } });
    return { aborted, closedRejected, expected: value(seed), afterAbort: value(afterAbort),
      afterReopen: value(afterReopen), afterVersionChange: value(afterVersionChange),
      recoveryHash: hash, recovery: Array.from(copy) };
  } finally { IDBDatabase.prototype.transaction = original; }
})()
