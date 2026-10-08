// Authentification Google Identity Services — modèle « token client » (navigateur seul).
//
// Règles :
//  - scope unique drive.file ;
//  - jeton d'accès gardé dans CETTE closure uniquement : jamais dans localStorage, IndexedDB,
//    l'URL, les journaux ou le store de l'application ;
//  - aucun jeton de rafraîchissement : à expiration, reconnexion explicite par un geste ;
//  - déconnexion = oubli local ; révocation Google = action séparée.

import { DRIVE_FILE_SCOPE } from '../config';

export type AuthState = 'signed-out' | 'signing-in' | 'connected' | 'expired' | 'denied' | 'error';

export interface AuthSnapshot {
  state: AuthState;
  /** Explication lisible du dernier refus ou de la dernière erreur. */
  message?: string;
  grantedScopes: string[];
  expiresAt?: number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(override?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: (r: { successful?: boolean; error?: string }) => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } } & Record<string, unknown>;
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Marge avant l'expiration annoncée : on considère le jeton expiré une minute plus tôt. */
const SAFETY_MS = 60_000;

let gisPromise: Promise<GoogleOAuth2> | null = null;

export function loadScript(src: string, timeoutMs = 15_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing?.dataset.loaded === 'true') return resolve();
    const el = existing ?? document.createElement('script');
    const timer = setTimeout(() => reject(new Error('Chargement du service Google trop long.')), timeoutMs);
    el.addEventListener('load', () => {
      clearTimeout(timer);
      el.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    el.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Service Google injoignable (réseau ou bloqueur).'));
    }, { once: true });
    if (!existing) {
      el.src = src;
      el.async = true;
      el.referrerPolicy = 'strict-origin-when-cross-origin';
      document.head.appendChild(el);
    }
  });
}

function loadGis(): Promise<GoogleOAuth2> {
  gisPromise ??= loadScript(GIS_SRC).then(() => {
    const o = window.google?.accounts?.oauth2;
    if (!o) throw new Error('Google Identity Services indisponible.');
    return o;
  });
  gisPromise.catch(() => (gisPromise = null));
  return gisPromise;
}

const ERROR_TEXT: Record<string, string> = {
  access_denied: 'Tu as refusé l’accès. Rien n’a été partagé avec Control Vault.',
  popup_closed: 'Fenêtre Google fermée avant la fin. Tu peux recommencer quand tu veux.',
  popup_failed_to_open: 'La fenêtre Google n’a pas pu s’ouvrir. Autorise les fenêtres pour ce site, ou ouvre Control Vault dans Safari plutôt que depuis l’écran d’accueil.',
  invalid_client: 'Identifiant OAuth refusé par Google : la configuration Google Cloud doit être vérifiée.',
  origin_mismatch: 'Cette adresse n’est pas autorisée dans la configuration Google Cloud.',
};

export class GoogleAuth {
  private token: string | null = null;
  private expiresAt = 0;
  private client: TokenClient | null = null;
  private snap: AuthSnapshot = { state: 'signed-out', grantedScopes: [] };
  private listeners = new Set<(s: AuthSnapshot) => void>();
  private pending: { resolve: () => void; reject: (e: Error) => void } | null = null;

  constructor(private clientId: string) {}

  get snapshot() {
    return this.snap;
  }

  subscribe(fn: (s: AuthSnapshot) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(next: Partial<AuthSnapshot>) {
    this.snap = { ...this.snap, ...next };
    for (const fn of this.listeners) fn(this.snap);
  }

  /** Précharge la bibliothèque pour que le clic sur « Se connecter » ouvre la fenêtre sans délai. */
  async prepare() {
    const oauth2 = await loadGis();
    this.client ??= oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (r) => this.onToken(oauth2, r),
      error_callback: (e) => this.onError(e?.type ?? 'unknown'),
    });
  }

  get ready() {
    return !!this.client;
  }

  /**
   * À appeler DIRECTEMENT dans un gestionnaire de clic : Safari bloque les fenêtres
   * ouvertes hors d'un geste de l'utilisateur.
   */
  signIn(opts: { selectAccount?: boolean } = {}): Promise<void> {
    if (!this.client) return Promise.reject(new Error('Service Google pas encore chargé. Réessaie dans un instant.'));
    this.set({ state: 'signing-in', message: undefined });
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.client!.requestAccessToken({ prompt: opts.selectAccount ? 'select_account' : '' });
    });
  }

  private onToken(oauth2: GoogleOAuth2, r: TokenResponse) {
    const p = this.pending;
    this.pending = null;
    if (r.error || !r.access_token) {
      const code = r.error ?? 'unknown';
      this.set({ state: code === 'access_denied' ? 'denied' : 'error', message: ERROR_TEXT[code] ?? `Connexion refusée par Google (${code}).` });
      p?.reject(new Error(this.snap.message));
      return;
    }
    if (!oauth2.hasGrantedAllScopes(r, DRIVE_FILE_SCOPE)) {
      // L'utilisateur a décoché l'accès Drive dans l'écran de consentement : on n'utilise pas ce jeton.
      this.token = null;
      this.set({ state: 'denied', grantedScopes: (r.scope ?? '').split(' ').filter(Boolean), message: 'L’accès à Google Drive n’a pas été coché. Sans lui, Control Vault ne peut rien lire ni écrire.' });
      p?.reject(new Error(this.snap.message));
      return;
    }
    this.token = r.access_token;
    const ttl = Number(r.expires_in ?? 3600) * 1000;
    this.expiresAt = Date.now() + Math.max(0, ttl - SAFETY_MS);
    this.set({ state: 'connected', message: undefined, grantedScopes: (r.scope ?? DRIVE_FILE_SCOPE).split(' ').filter(Boolean), expiresAt: this.expiresAt });
    p?.resolve();
  }

  private onError(type: string) {
    const p = this.pending;
    this.pending = null;
    this.set({ state: this.token && Date.now() < this.expiresAt ? 'connected' : type === 'popup_closed' ? 'signed-out' : 'error', message: ERROR_TEXT[type] ?? 'Connexion Google interrompue.' });
    p?.reject(new Error(this.snap.message));
  }

  /** Jeton valide ou null. Un jeton expiré est oublié immédiatement. */
  accessToken(): string | null {
    if (this.token && Date.now() >= this.expiresAt) this.expire();
    return this.token;
  }

  /** À appeler au retour de veille et sur une réponse 401. */
  expire() {
    if (!this.token && this.snap.state !== 'connected') return;
    this.token = null;
    this.set({ state: 'expired', message: 'Session Google expirée. Reconnecte-toi pour continuer.' });
  }

  checkExpiry() {
    if (this.token && Date.now() >= this.expiresAt) this.expire();
  }

  /** Déconnexion locale : le jeton est oublié, l'autorisation Google reste en place. */
  signOut() {
    this.token = null;
    this.expiresAt = 0;
    this.set({ state: 'signed-out', message: undefined, grantedScopes: [], expiresAt: undefined });
  }

  /** Révocation côté Google : supprime l'autorisation donnée à Control Vault. */
  async revoke(): Promise<boolean> {
    const token = this.token;
    this.signOut();
    if (!token) return false;
    const oauth2 = await loadGis();
    return new Promise((resolve) => oauth2.revoke(token, (r) => resolve(r?.successful !== false)));
  }
}
