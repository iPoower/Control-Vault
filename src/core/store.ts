// Magasin d'état unique, minimal et synchrone. Les vues s'abonnent ; rien n'est caché.

import type { AuthState } from '../services/google-auth';
import type { Mode } from './mode';
import type { AppId, AppRecord, Connectivity, DriveItem, OpEvent, PendingOp, Quota, Scenario, Settings, Version } from './types';

/** Accès d'un dossier ou fichier autorisé, vérifié auprès de Drive. */
export interface RootAccess {
  id: string;
  name: string;
  key?: string;
  source: 'config' | 'picker';
  kind: 'folder' | 'file';
  access: 'unknown' | 'checking' | 'granted' | 'missing' | 'error';
  canAddChildren?: boolean;
  /** Nombre d'éléments visibles à l'intérieur lors du dernier contrôle (dossiers seulement). */
  visibleChildren?: number;
}

export interface DriveState {
  auth: AuthState;
  message?: string;
  scopes: string[];
  expiresAt?: number;
  account?: { name?: string; email?: string };
  /** Dernière réponse réussie de l'API Google : seule preuve d'une connexion fonctionnelle. */
  lastCheckAt?: number;
  roots: RootAccess[];
}

export interface State {
  ready: boolean;
  /** Fixé au démarrage. Démonstration et Google Drive ne partagent aucune donnée. */
  mode: Mode;
  drive: DriveState;
  scenario: Scenario;
  connectivity: Connectivity;
  quota?: Quota;
  apps: Record<AppId, AppRecord>;
  versions: Version[];
  events: OpEvent[];
  queue: PendingOp[];
  settings: Settings;
  /** Une seule opération sensible à la fois. */
  busy: null | { kind: 'backup' | 'restore' | 'verify'; appId?: AppId };
  /** Index plat des éléments Drive connus (recherche rapide). */
  catalog: DriveItem[];
}

type Listener = (s: State, changed: Set<keyof State>) => void;

const SETTINGS_KEY = 'control-vault:settings:v1';

export function loadSettings(): Settings {
  const fallback: Settings = { theme: 'system', motion: 'system', view: 'list' };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<Settings>;
    return {
      theme: s.theme === 'dark' || s.theme === 'light' ? s.theme : 'system',
      motion: s.motion === 'reduced' ? 'reduced' : 'system',
      view: s.view === 'grid' ? 'grid' : 'list',
    };
  } catch {
    return fallback;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* stockage indisponible (navigation privée) : le réglage vaut pour la session */
  }
}

export function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    subscribe(fn: Listener) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(patch: Partial<State>) {
      const changed = new Set(Object.keys(patch) as (keyof State)[]);
      state = { ...state, ...patch };
      if (patch.settings) saveSettings(state.settings);
      for (const fn of listeners) fn(state, changed);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
