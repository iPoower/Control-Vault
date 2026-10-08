// Google Picker : la seule façon, avec drive.file, de donner à Control Vault l'accès à des
// fichiers ou dossiers qui existaient avant lui. Rien n'est accessible sans ce choix explicite.

import { loadScript } from './google-auth';

export interface PickedDoc {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
}

interface PickerNS {
  ViewId: Record<string, string>;
  Feature: Record<string, string>;
  Action: { PICKED: string; CANCEL: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string; MIME_TYPE: string };
  DocsView: new (viewId?: string) => {
    setIncludeFolders(v: boolean): unknown;
    setSelectFolderEnabled(v: boolean): unknown;
    setParent(id: string): unknown;
    setMode(mode: string): unknown;
  };
  DocsViewMode?: { LIST: string; GRID: string };
  PickerBuilder: new () => Record<string, (...args: unknown[]) => unknown> & { build(): { setVisible(v: boolean): void } };
}

declare global {
  interface Window {
    gapi?: { load(name: string, cb: (() => void) | { callback: () => void; onerror?: () => void; timeout?: number; ontimeout?: () => void }): void };
  }
}

let pickerPromise: Promise<PickerNS> | null = null;

function loadPicker(): Promise<PickerNS> {
  pickerPromise ??= loadScript('https://apis.google.com/js/api.js').then(
    () =>
      new Promise<PickerNS>((resolve, reject) => {
        if (!window.gapi) return reject(new Error('Sélecteur Google indisponible.'));
        window.gapi.load('picker', {
          callback: () => {
            const ns = (window.google as unknown as { picker?: PickerNS })?.picker;
            if (ns) resolve(ns);
            else reject(new Error('Sélecteur Google indisponible.'));
          },
          onerror: () => reject(new Error('Le sélecteur Google n’a pas pu se charger.')),
          timeout: 15_000,
          ontimeout: () => reject(new Error('Le sélecteur Google met trop de temps à se charger.')),
        });
      }),
  );
  pickerPromise.catch(() => (pickerPromise = null));
  return pickerPromise;
}

export function preloadPicker() {
  loadPicker().catch(() => {});
}

/**
 * Ouvre le sélecteur. Résout la liste choisie, ou null si l'utilisateur annule.
 * Le jeton n'est passé qu'en mémoire au sélecteur, jamais conservé.
 */
export async function pickFromDrive(opts: { token: string; apiKey: string; appId: string; parentId?: string; title?: string }): Promise<PickedDoc[] | null> {
  const picker = await loadPicker();
  const view = new picker.DocsView(picker.ViewId.DOCS);
  view.setIncludeFolders(true);
  view.setSelectFolderEnabled(true);
  if (opts.parentId) view.setParent(opts.parentId);
  if (picker.DocsViewMode) view.setMode(picker.DocsViewMode.LIST);

  return new Promise((resolve) => {
    const builder = new picker.PickerBuilder();
    builder.addView(view);
    builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
    builder.setOAuthToken(opts.token);
    builder.setDeveloperKey(opts.apiKey);
    builder.setAppId(opts.appId);
    builder.setOrigin(window.location.origin);
    builder.setLocale('fr');
    if (opts.title) builder.setTitle(opts.title);
    builder.setCallback((data: Record<string, unknown>) => {
      const action = data[picker.Response.ACTION];
      if (action === picker.Action.PICKED) {
        const docs = (data[picker.Response.DOCUMENTS] as Record<string, string>[]) ?? [];
        resolve(
          docs
            .map((d) => ({ id: d[picker.Document.ID], name: d[picker.Document.NAME], mimeType: d[picker.Document.MIME_TYPE], isFolder: d[picker.Document.MIME_TYPE] === 'application/vnd.google-apps.folder' }))
            .filter((d) => /^[A-Za-z0-9_-]+$/.test(d.id)),
        );
      } else if (action === picker.Action.CANCEL) resolve(null);
    });
    builder.build().setVisible(true);
  });
}
