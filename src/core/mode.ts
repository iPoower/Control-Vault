// Deux modes strictement séparés. Le choix est lu UNE fois au démarrage ; en changer recharge
// l'application : aucune donnée, aucun historique ne passe d'un mode à l'autre.

import { GOOGLE, realModeAvailability, type Availability } from '../config';

export type Mode = 'demo' | 'drive';
const KEY = 'control-vault:mode:v1';

export function availability(): Availability {
  if (typeof location === 'undefined') return { available: false, reason: 'not-configured', detail: '' };
  return realModeAvailability(GOOGLE, location.origin, globalThis.isSecureContext === true, !!globalThis.crypto?.subtle);
}

/** Le mode Drive n'est retenu que si la connexion réelle est réellement disponible ici. */
export function initialMode(): Mode {
  if (!availability().available) return 'demo';
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'demo') return 'demo';
  } catch {
    /* stockage indisponible : mode par défaut */
  }
  return 'drive';
}

export function switchMode(next: Mode) {
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* le choix vaut pour cette ouverture seulement */
  }
  // Rechargement complet : la mémoire (et donc tout jeton) repart de zéro.
  location.hash = '#/';
  location.reload();
}
