// Jeu de données de DÉMONSTRATION. Entièrement fictif, généré à chaque ouverture.
// Aucune donnée réelle de Race Control ou de Reconversion Control n'est lue ici.

import { encrypt, sha256 } from '../core/crypto';
import { countCollections } from '../core/diff';
import type { AppId, AppRecord, DriveItem, OpEvent, Payload, Version } from '../core/types';
import type { DemoDrive } from '../services/demo-drive';

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const ROOT_ID = 'cv-root';
export const FOLDER: Record<AppId | 'archives', string> = {
  'race-control': 'cv-race',
  'reconversion-control': 'cv-reco',
  archives: 'cv-archives',
};

const TRIP_NOTES = [
  'Chaussée humide au départ, adhérence rassurante en courbe.',
  'Vent latéral sur le viaduc, rien à signaler côté pneus.',
  'Bouchon long, températures douces, conduite souple.',
  'Averse soudaine, freinage un peu plus long que prévu.',
  'Route sèche, pression vérifiée la veille.',
  'Brouillard matinal, visibilité réduite sur 10 km.',
  'Retour de nuit, route grasse après la pluie.',
];

// Ancre fixe : une version plus ancienne contient exactement les premiers éléments d'une plus récente,
// comme dans la réalité (on ajoute des trajets, on ne réécrit pas les anciens).
const ANCHOR = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 45 * DAY;
})();

function trips(n: number, _now: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `trajet-${String(i + 1).padStart(3, '0')}`,
    date: new Date(ANCHOR + i * 1.3 * DAY).toISOString().slice(0, 10),
    trajet: i % 2 ? 'Bureau → Domicile' : 'Domicile → Bureau',
    km: 128 + ((i * 7) % 23),
    debrief: TRIP_NOTES[i % TRIP_NOTES.length],
  }));
}

function racePayload(nTrips: number, now: number, revision: number): Payload {
  return {
    app: 'race-control',
    schema: 3,
    revision,
    pneus: [
      { id: 'train-ete', libelle: 'Train été', montage: '2026-04-12', profondeur_mm: 6.1 },
      { id: 'train-4s', libelle: 'Train 4 saisons', montage: '2025-10-30', profondeur_mm: 5.4 },
    ],
    trajets: trips(nTrips, now),
    reglages: { unites: 'métriques', alertes_pluie: true, seuil_vent_kmh: 55 },
  };
}

function recoPayload(nSessions: number, _now: number, revision: number): Payload {
  const modules = [
    ['python-bases', 'Python — bases', 'terminé'],
    ['sql-requetes', 'SQL — requêtes et jointures', 'terminé'],
    ['stats-descriptives', 'Statistiques descriptives', 'en cours'],
    ['docker-intro', 'Docker — introduction', 'en cours'],
    ['ml-supervise', 'Apprentissage supervisé', 'à venir'],
    ['architecture-ia', 'Architecture de solutions IA', 'à venir'],
  ].map(([id, titre, statut]) => ({ id, titre, statut }));
  return {
    app: 'reconversion-control',
    schema: 1,
    revision,
    modules,
    sessions: Array.from({ length: nSessions }, (_, i) => ({
      id: `session-${i + 1}`,
      date: new Date(ANCHOR + i * 0.9 * DAY).toISOString().slice(0, 10),
      minutes: 35 + ((i * 13) % 50),
      sujet: modules[i % 4].titre,
    })),
  };
}

export function demoApps(now: number): Record<AppId, AppRecord> {
  return {
    'race-control': {
      id: 'race-control',
      name: 'Race Control',
      tagline: 'Météo, pneus et journal des trajets',
      payload: racePayload(31, now, 14),
      collections: {
        trajets: { one: 'débrief de trajet', many: 'débriefs de trajet', critical: true },
        pneus: { one: 'train de pneus', many: 'trains de pneus' },
      },
      freshnessDays: 7,
    },
    'reconversion-control': {
      id: 'reconversion-control',
      name: 'Reconversion Control',
      tagline: 'Parcours de formation et sessions de travail',
      payload: recoPayload(42, now, 9),
      collections: {
        modules: { one: 'module', many: 'modules' },
        sessions: { one: 'session de travail', many: 'sessions de travail', critical: true },
      },
      freshnessDays: 7,
    },
  };
}

const stamp = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

export const versionFileName = (appId: AppId, at: number) => `${appId}_${stamp(at)}.cvault`;

let vcount = 0;
export const newVersionId = () => `v${Date.now().toString(36).slice(-5)}${(vcount++).toString(36)}`.toUpperCase();

export interface Seed {
  versions: Version[];
  events: OpEvent[];
}

/** Construit les dossiers, les versions chiffrées et l'historique de démonstration. */
export async function seedDemo(drive: DemoDrive, _apps: Record<AppId, AppRecord>, key: CryptoKey, now: number): Promise<Seed> {
  const versions: Version[] = [];
  const events: OpEvent[] = [];
  const enc = new TextEncoder();

  drive.seed({ id: ROOT_ID, parentId: null, name: 'Control Vault', kind: 'folder', modifiedAt: now - 2 * DAY, pinned: true });
  drive.seed({ id: FOLDER['race-control'], parentId: ROOT_ID, name: 'Race Control', kind: 'folder', modifiedAt: now - 1 * DAY, pinned: true });
  drive.seed({ id: FOLDER['reconversion-control'], parentId: ROOT_ID, name: 'Reconversion Control', kind: 'folder', modifiedAt: now - 9 * DAY, pinned: true });
  drive.seed({ id: FOLDER.archives, parentId: ROOT_ID, name: 'Archives', kind: 'folder', modifiedAt: now - 30 * DAY, pinned: true });
  drive.seed({ id: 'cv-archives-2025', parentId: FOLDER.archives, name: '2025', kind: 'folder', modifiedAt: now - 120 * DAY });

  const plan: { appId: AppId; ago: number; size: number }[] = [
    { appId: 'race-control', ago: 38 * DAY, size: 24 },
    { appId: 'race-control', ago: 24 * DAY, size: 26 },
    { appId: 'race-control', ago: 15 * DAY + 3 * HOUR, size: 28 },
    { appId: 'race-control', ago: 8 * DAY, size: 29 },
    { appId: 'race-control', ago: 1 * DAY + 5 * HOUR, size: 31 },
    { appId: 'reconversion-control', ago: 33 * DAY, size: 22 },
    { appId: 'reconversion-control', ago: 20 * DAY, size: 31 },
    { appId: 'reconversion-control', ago: 9 * DAY + 2 * HOUR, size: 40 },
  ];

  for (const [i, p] of plan.entries()) {
    const at = now - p.ago;
    const payload = p.appId === 'race-control' ? racePayload(p.size, at, 9 + i) : recoPayload(p.size, at, 4 + i);
    const json = JSON.stringify(payload);
    const blob = await encrypt(key, json);
    const hash = await sha256(blob);
    const id = newVersionId();
    const v: Version = {
      id,
      appId: p.appId,
      createdAt: at,
      sizeBytes: blob.length,
      sha256: hash,
      encrypted: true,
      kind: 'manual',
      counts: countCollections(payload),
      verifiedAt: at + 4000,
    };
    versions.push(v);
    drive.seed(
      { id: `file-${id}`, parentId: FOLDER[p.appId], name: versionFileName(p.appId, at), kind: 'file', family: 'vault', sizeBytes: blob.length, modifiedAt: at, versionId: id },
      blob,
      hash,
    );
    events.push({
      id: `e-${id}`,
      at,
      source: p.appId,
      type: 'backup',
      result: 'success',
      durationMs: 2100 + ((i * 431) % 1800),
      sizeBytes: blob.length,
      integrity: 'verified',
      versionId: id,
      sha256: hash,
    });
  }

  // Un échec passé, résolu par la sauvegarde suivante.
  events.push({
    id: 'e-fail-1',
    at: now - 8 * DAY - 40 * 60_000,
    source: 'race-control',
    type: 'backup',
    result: 'failed',
    durationMs: 5400,
    integrity: 'not-checked',
    reason: 'Envoi interrompu — connexion perdue. Rien n’a été écrit dans Drive.',
    retry: { appId: 'race-control', type: 'backup' },
    resolved: true,
  });
  // Un contrôle d'intégrité global.
  events.push({
    id: 'e-verify-1',
    at: now - 3 * DAY,
    source: 'vault',
    type: 'verify',
    result: 'success',
    durationMs: 1800,
    integrity: 'verified',
  });

  // Fichiers annexes, pour l'explorateur.
  const extras: { parent: string; name: string; family: DriveItem['family']; text?: string; size?: number; ago: number }[] = [
    {
      parent: FOLDER['race-control'],
      name: 'contrat-integration.md',
      family: 'document',
      ago: 2 * DAY,
      text: '# Contrat d’intégration Race Control\n\nStatut : brouillon, non validé.\n\nTant que ce contrat n’est pas validé, Control Vault ne lit ni n’écrit directement dans Race Control. Les sauvegardes passent par un export JSON manuel.',
    },
    {
      parent: FOLDER['race-control'],
      name: 'export-manuel-septembre.json',
      family: 'json',
      ago: 12 * DAY,
      text: JSON.stringify(racePayload(27, now - 12 * DAY, 11), null, 2),
    },
    { parent: FOLDER['reconversion-control'], name: 'attestation-module-sql.pdf', family: 'document', size: 186_400, ago: 18 * DAY },
    { parent: FOLDER['reconversion-control'], name: 'capture-progression.png', family: 'image', size: 412_800, ago: 6 * DAY },
    {
      parent: FOLDER.archives,
      name: 'ancien-export-race-control.json',
      family: 'json',
      ago: 140 * DAY,
      text: JSON.stringify(racePayload(9, now - 140 * DAY, 3), null, 2),
    },
  ];
  for (const [i, x] of extras.entries()) {
    const bytes = x.text ? enc.encode(x.text) : new Uint8Array(x.size ?? 1024);
    drive.seed(
      { id: `extra-${i}`, parentId: x.parent, name: x.name, kind: 'file', family: x.family, sizeBytes: bytes.length, modifiedAt: now - x.ago },
      bytes,
      await sha256(bytes),
    );
  }

  events.sort((a, b) => b.at - a.at);
  return { versions, events };
}
