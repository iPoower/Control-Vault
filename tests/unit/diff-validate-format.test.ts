import { describe, expect, it } from 'vitest';
import { canonical, diffPayload } from '../../src/core/diff';
import { formatBytes, formatDay, formatDuration } from '../../src/core/format';
import { safeFileName, validateImport, validatePayload } from '../../src/core/validate';

describe('différences avant restauration', () => {
  const cur = { app: 'race-control', schema: 3, trajets: [{ id: 'a', km: 1 }, { id: 'b', km: 2 }, { id: 'c', km: 3 }], reglages: { x: 1 } };
  it('compte les éléments retirés, ajoutés et modifiés', () => {
    const target = { app: 'race-control', schema: 3, trajets: [{ id: 'a', km: 1 }, { id: 'b', km: 9 }, { id: 'd', km: 4 }], reglages: { x: 1 } };
    const d = diffPayload(cur, target);
    expect(d.collections[0]).toMatchObject({ key: 'trajets', removed: 1, added: 1, changed: 1, current: 3, target: 3 });
    expect(d.identical).toBe(false);
  });
  it('ordre des clés sans effet', () => {
    expect(canonical({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonical({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(diffPayload(cur, JSON.parse(JSON.stringify(cur))).identical).toBe(true);
  });
  it('réglages modifiés détectés', () => {
    expect(diffPayload(cur, { ...cur, reglages: { x: 2 } }).fields).toEqual(['reglages']);
  });
});

describe('contrôle des imports', () => {
  it('refuse une autre extension', () => {
    expect(validateImport('notes.txt', 10, '{}')).toEqual({ ok: false, error: 'Seuls les fichiers .json sont acceptés pour l’import.' });
  });
  it('refuse un fichier trop lourd', () => {
    const r = validateImport('gros.json', 11 * 1024 * 1024, '{}');
    expect(r.ok).toBe(false);
  });
  it('explique un JSON invalide', () => {
    const r = validateImport('casse.json', 5, '{"a":');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^JSON invalide/);
  });
  it('reconnaît l’application', () => {
    const r = validateImport('rc.json', 30, JSON.stringify({ app: 'race-control', schema: 3 }));
    expect(r).toMatchObject({ ok: true, appId: 'race-control' });
  });
  it('une sauvegarde exige le bon « app » et un « schema »', () => {
    expect(validatePayload({ app: 'reconversion-control', schema: 1 }, 'race-control').ok).toBe(false);
    expect(validatePayload({ app: 'race-control' }, 'race-control').ok).toBe(false);
    expect(validatePayload([], undefined).ok).toBe(false);
  });
  it('nettoie les noms de fichiers', () => {
    expect(safeFileName('../a/b:c*.json')).toBe('..-a-b-c-.json');
    expect(safeFileName('   ')).toBe('fichier');
  });
});

describe('formatage français', () => {
  it('tailles comme Google Drive', () => {
    expect(formatBytes(239.48 * 1024 ** 3)).toBe('239,5 Go');
    expect(formatBytes(5 * 1024 ** 4, 0)).toBe('5 To');
    expect(formatBytes(1536)).toBe('1,5 Ko');
    expect(formatBytes(1)).toBe('1 octet');
  });
  it('durées', () => {
    expect(formatDuration(2400)).toBe('2,4 s');
    expect(formatDuration(125_000)).toBe('2 min 5 s');
  });
  it('jours relatifs', () => {
    const now = new Date(2026, 9, 8, 12).getTime();
    expect(formatDay(now - 3600_000, now)).toBe("Aujourd'hui");
    expect(formatDay(now - 86_400_000, now)).toBe('Hier');
    expect(formatDay(new Date(2026, 9, 1, 9).getTime(), now)).toBe('Jeudi 1 octobre');
  });
});
