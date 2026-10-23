export interface DurableStore<T> { read(): Promise<T | null>; write(state: T): Promise<void>; recovery(bytes: Uint8Array): Promise<string>; readRecovery(hash: string): Promise<Uint8Array | null>; latestRecovery(): Promise<Uint8Array | null> }
export const DriveStore: { create<T>(name: string, indexedDB?: IDBFactory): DurableStore<T> };
