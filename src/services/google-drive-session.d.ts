import type { OpaqueDrive, DedicatedFolder } from './opaque-drive';
export interface DriveConfig { approved: true; clientId: string; apiKey: string; appId: string; raceOrigin: string; vaultOrigin: string }
export interface DriveSession { prepare(): Promise<void>; connect(): Promise<void>; confirmAccount(id: string): void; newFolder(): Promise<string>; listDedicatedFolders(): Promise<DedicatedFolder[]>; chooseDedicatedFolder(id: string): Promise<{ folder: string; binding: string; account: string }>; chooseFolder(): Promise<{ folder: string; binding: string; account: string }>; readonly identity: { id: string; label: string } | null; readonly confirmed: boolean; disconnect(): void; readonly connected: boolean }
export const GoogleDriveSession: {
  config(value: unknown, origin?: string): DriveConfig;
  load(fetcher?: typeof fetch): Promise<DriveConfig>;
  create(config: DriveConfig, provider: OpaqueDrive): DriveSession;
};
