import type { OpaqueDrive } from './opaque-drive';
export interface DriveConfig { approved: true; clientId: string; apiKey: string; appId: string; raceOrigin: string; vaultOrigin: string }
export interface DriveSession { prepare(): Promise<void>; connect(): Promise<void>; chooseFolder(): Promise<{ folder: string; binding: string }>; disconnect(): void; readonly connected: boolean }
export const GoogleDriveSession: {
  config(value: unknown, origin?: string): DriveConfig;
  load(fetcher?: typeof fetch): Promise<DriveConfig>;
  create(config: DriveConfig, provider: OpaqueDrive): DriveSession;
};
