// Parcours guidés : sauvegarde, restauration, contrôle d'intégrité.
// Chaque étape affichée correspond à une opération réellement exécutée.

import {
  BACKUP_STEPS,
  OperationError,
  previewRestore,
  queueBackup,
  reconnectGoogle,
  RESTORE_STEPS,
  runBackup,
  runRestore,
  store,
  verifyAll,
  versionsOf,
  type StepUpdate,
} from '../app';
import { appHealth, openFailures } from '../core/status';
import { formatBytes, formatDate, formatDateTime, formatDuration, formatRelative, plural, shortHash } from '../core/format';
import type { AppId, Version } from '../core/types';
import { h, replace, svg } from '../ui/dom';
import { icon } from '../ui/icons';
import { announce, openSheet, setFoot, toast, type SheetHandle } from '../ui/overlay';
import { HEALTH_LABEL, pill } from '../ui/parts';

// ─── Liste d'étapes ────────────────────────────────────────────────────────

export function stepList(labels: string[]) {
  const items = labels.map((label, i) => {
    const mark = h('span', { class: 'step-mark', 'aria-hidden': 'true' }, String(i + 1));
    const note = h('div', { class: 'step-note' });
    const bar = h('div', { class: 'bar indeterminate', hidden: true }, h('i'));
    const li = h('li', { class: 'step', dataset: { state: 'waiting' } }, mark, h('div', null, h('div', { class: 'step-label' }, label), note, bar));
    return { li, mark, note, bar };
  });
  const el = h('ol', { class: 'steps', 'aria-label': 'Étapes' }, items.map((x) => x.li));

  const update = (u: StepUpdate) => {
    const it = items[u.index];
    if (!it) return;
    it.li.dataset.state = u.state;
    if (u.state === 'running') {
      replace(it.mark, h('span', { class: 'spinner' }));
      it.li.setAttribute('aria-current', 'step');
      if (u.progress !== undefined) {
        it.bar.hidden = false;
        it.bar.classList.remove('indeterminate');
        it.bar.setAttribute('role', 'progressbar');
        it.bar.setAttribute('aria-valuenow', String(Math.round(u.progress * 100)));
        it.bar.setAttribute('aria-valuemin', '0');
        it.bar.setAttribute('aria-valuemax', '100');
        it.bar.setAttribute('aria-label', labels[u.index]);
        (it.bar.firstElementChild as HTMLElement).style.transform = `scaleX(${u.progress})`;
        it.note.textContent = `${Math.round(u.progress * 100)} %`;
      }
    } else {
      it.li.removeAttribute('aria-current');
      it.bar.hidden = true;
      replace(it.mark, u.state === 'done' ? icon('check') : u.state === 'failed' ? icon('x') : String(u.index + 1));
      if (u.state === 'failed' || u.state === 'done') announce(`${labels[u.index]} : ${u.state === 'done' ? 'terminé' : 'échec'}`);
    }
    if (u.state === 'failed') it.note.textContent = 'Interrompu à cette étape';
    else if (u.note !== undefined) it.note.textContent = u.note;
    else if (u.state === 'done' && u.progress === undefined) it.note.textContent = '';
  };
  return { el, update };
}

export function seal() {
  return svg(
    'svg',
    { viewBox: '0 0 52 52', class: 'outcome-seal', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
    svg('circle', { cx: 26, cy: 26, r: 24, class: 'seal-ring' }),
    svg('path', { d: 'M16 27l7 7 13-14', class: 'seal-check' }),
  );
}

export function failureSeal() {
  const s = icon('alert');
  s.classList.add('outcome-seal');
  return s;
}

function busyGuard(): boolean {
  if (store.get().busy) {
    toast('Une opération est déjà en cours. Elle doit se terminer avant d’en lancer une autre.', { kind: 'info' });
    return false;
  }
  return true;
}

// ─── Sauvegarde ────────────────────────────────────────────────────────────

export function openBackup(appId: AppId) {
  if (!busyGuard()) return;
  const app = store.get().apps[appId];
  const sheet = openSheet({ title: `Sauvegarder ${app.name}` });
  const { online, google } = store.get().connectivity;

  if (!online || google !== 'connected') {
    const offline = !online;
    sheet.body.append(
      h(
        'div',
        { class: 'callout', dataset: { health: offline ? 'unknown' : 'failed' } },
        icon(offline ? 'offline' : 'alert'),
        h(
          'div',
          null,
          h('strong', null, offline ? 'Pas de connexion pour l’instant' : 'Session Google expirée'),
          h(
            'p',
            null,
            offline
              ? 'La sauvegarde ne peut pas être envoyée vers Drive. Tu peux la mettre en attente : elle sera proposée dès le retour du réseau.'
              : 'Reconnecte-toi pour envoyer la sauvegarde. Rien n’a été modifié.',
          ),
        ),
      ),
    );
    setFoot(
      sheet,
      h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'),
      offline
        ? h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: () => {
                queueBackup(appId);
                sheet.close();
                toast(`Sauvegarde de ${app.name} mise en attente`, { kind: 'info' });
              },
            },
            'Mettre en attente',
          )
        : h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: async () => {
                await reconnectGoogle();
                sheet.close();
                openBackup(appId);
              },
            },
            'Se reconnecter',
          ),
    );
    return;
  }

  runBackupInSheet(sheet, appId);
}

function runBackupInSheet(sheet: SheetHandle, appId: AppId) {
  const app = store.get().apps[appId];
  const steps = stepList(BACKUP_STEPS);
  const result = h('div', { 'aria-live': 'polite' });
  replace(sheet.body, h('p', { class: 'muted small', style: 'margin-bottom: var(--s3)' }, 'Chaque étape est contrôlée avant de passer à la suivante.'), steps.el, result);

  const ctrl = new AbortController();
  let finished = false;
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => ctrl.abort() }, 'Annuler');
  setFoot(sheet, cancel);
  sheet.onClose(() => {
    if (!finished) toast(`La sauvegarde de ${app.name} continue en arrière-plan.`, { kind: 'info' });
  });

  store.set({ busy: { kind: 'backup', appId } });
  runBackup(appId, (u) => {
    steps.update(u);
    // L'envoi ne s'annule plus une fois le fichier écrit : on retire le bouton à l'étape de contrôle.
    if (u.index >= 4) cancel.setAttribute('disabled', '');
  }, ctrl.signal)
    .then(({ version, durationMs }) => {
      finished = true;
      result.append(
        h(
          'div',
          { class: 'outcome', dataset: { health: 'verified' } },
          seal(),
          h(
            'div',
            null,
            h('h3', null, 'Sauvegarde terminée et vérifiée'),
            h(
              'dl',
              null,
              h('dt', null, 'Date'),
              h('dd', null, formatDateTime(version.createdAt)),
              h('dt', null, 'Taille'),
              h('dd', null, formatBytes(version.sizeBytes)),
              h('dt', null, 'Version'),
              h('dd', null, version.id),
              h('dt', null, 'Empreinte'),
              h('dd', { title: version.sha256 }, shortHash(version.sha256)),
              h('dt', null, 'Durée'),
              h('dd', null, formatDuration(durationMs)),
            ),
          ),
        ),
      );
      setFoot(sheet, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => sheet.close() }, 'Terminé'));
      if (!sheet.dialog.isConnected) toast(`${app.name} : sauvegarde terminée et vérifiée`, { kind: 'ok' });
      announce('Sauvegarde terminée et vérifiée');
    })
    .catch((e: OperationError) => {
      finished = true;
      result.append(
        h(
          'div',
          { class: 'outcome', dataset: { health: 'failed' } },
          failureSeal(),
          h('div', null, h('h3', null, e.message.split('.')[0]), h('p', { class: 'small muted' }, e.message.includes('.') ? e.message.slice(e.message.indexOf('.') + 1).trim() : '')),
        ),
      );
      setFoot(
        sheet,
        h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'),
        e.retryable &&
          h(
            'button',
            {
              class: 'btn btn-primary',
              type: 'button',
              onclick: () => {
                if (!store.get().connectivity.online) return toast('Toujours hors ligne. Réessaie au retour du réseau.', { kind: 'info' });
                runBackupInSheet(sheet, appId);
              },
            },
            icon('refresh'),
            'Réessayer',
          ),
      );
      if (!sheet.dialog.isConnected) toast(`${app.name} : ${e.message}`, { kind: 'bad', action: e.retryable ? { label: 'Réessayer', run: () => openBackup(appId) } : undefined });
    })
    .finally(() => store.set({ busy: null }));
}

// ─── Choix de l'application ────────────────────────────────────────────────

export function openBackupPicker() {
  const s = store.get();
  const sheet = openSheet({ title: 'Que veux-tu sauvegarder ?' });
  const failures = openFailures(s.events);
  const rows = (Object.keys(s.apps) as AppId[]).map((id) => {
    const app = s.apps[id];
    const last = versionsOf(id).find((v) => v.verifiedAt);
    const health = appHealth({ id, name: app.name, lastVerifiedAt: last?.verifiedAt, freshnessDays: app.freshnessDays }, Date.now(), failures.some((f) => f.source === id), s.queue.some((q) => q.appId === id));
    return h(
      'button',
      {
        class: 'row',
        type: 'button',
        onclick: () => {
          sheet.close();
          setTimeout(() => openBackup(id), 180);
        },
      },
      h('span', { class: 'glyph', dataset: { health } }, icon('backup')),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title', style: 'display:block' }, app.name), h('span', { class: 'row-sub', style: 'display:block' }, last ? `Dernière : ${formatRelative(last.createdAt)}` : 'Jamais sauvegardée')),
      h('span', { class: 'row-end' }, pill(health), icon('chevron')),
    );
  });
  sheet.body.append(h('div', { class: 'rows panel', style: 'overflow:hidden' }, rows));
}

// ─── Restauration ──────────────────────────────────────────────────────────

export function openRestore(versionId: string) {
  if (!busyGuard()) return;
  const s = store.get();
  const version = s.versions.find((v) => v.id === versionId);
  if (!version) return toast('Version introuvable.', { kind: 'bad' });
  const app = s.apps[version.appId];
  const sheet = openSheet({ title: `Restaurer ${app.name}`, wide: true });

  if (!s.connectivity.online || s.connectivity.google !== 'connected') {
    sheet.body.append(
      h('div', { class: 'callout', dataset: { health: 'unknown' } }, icon('offline'), h('div', null, h('strong', null, 'Restauration indisponible'), h('p', null, 'Il faut une connexion à Drive pour lire et vérifier la version. Rien n’a été modifié.'))),
    );
    setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'));
    return;
  }

  replace(
    sheet.body,
    h('p', { class: 'muted' }, 'Lecture de la version et contrôle de son empreinte…'),
    h('div', { class: 'skeleton', style: 'margin-top: var(--s4)' }, [0, 1, 2].map(() => h('div', { class: 'sk-row', style: 'padding:0' }, h('div', { class: 'sk box' }), h('div', null, h('div', { class: 'sk w60' }), h('div', { class: 'sk w40' })), h('div', { class: 'sk' })))),
  );
  setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Annuler'));

  const ctrl = new AbortController();
  sheet.onClose(() => ctrl.abort());

  previewRestore(versionId, ctrl.signal)
    .then((p) => {
      const current = versionsOf(version.appId)[0];
      const col = (title: string, date: string, counts: Record<string, number>, extra?: HTMLElement) =>
        h(
          'div',
          { class: 'compare-col' },
          h('div', { class: 'compare-title' }, title, extra),
          h('div', { class: 'compare-date num' }, date),
          h(
            'dl',
            { class: 'kv' },
            Object.entries(counts).map(([k, n]) => [h('dt', null, app.collections[k]?.many ?? k), h('dd', null, String(n))]),
          ),
        );

      const changes = (p.diff?.collections ?? [])
        .flatMap((c) => {
          const lbl = app.collections[c.key] ?? { one: c.key, many: c.key };
          const out: HTMLElement[] = [];
          if (c.removed) out.push(h('li', { dataset: { health: lbl.critical ? 'failed' : 'stale' } }, icon('x'), `${plural(c.removed, lbl.one, lbl.many)} retiré${c.removed > 1 ? 's' : ''}`));
          if (c.added) out.push(h('li', { dataset: { health: 'pending' } }, icon('plus'), `${plural(c.added, lbl.one, lbl.many)} ajouté${c.added > 1 ? 's' : ''}`));
          if (c.changed) out.push(h('li', { dataset: { health: 'unknown' } }, icon('refresh'), `${plural(c.changed, lbl.one, lbl.many)} modifié${c.changed > 1 ? 's' : ''}`));
          return out;
        })
        .concat((p.diff?.fields ?? []).filter((f) => f !== 'revision').map((f) => h('li', { dataset: { health: 'unknown' } }, icon('refresh'), `Réglage « ${f} » différent`)));

      const ack = h('input', { type: 'checkbox', class: 'check', id: 'restore-ack' });
      const go = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, icon('restore'), 'Restaurer cette version');
      ack.addEventListener('change', () => (go.disabled = !ack.checked || !!p.diff?.identical));

      replace(
        sheet.body,
        h(
          'div',
          { class: 'compare' },
          col('État actuel', current ? `Dernière sauvegarde ${formatDateTime(current.createdAt)}` : 'Aucune sauvegarde', p.current.counts),
          h('div', { class: 'compare-arrow', 'aria-hidden': 'true' }, icon('chevron')),
          col('Version sélectionnée', `${formatDateTime(version.createdAt)} — ${version.id}`, version.counts, pill('verified', 'Empreinte vérifiée')),
        ),
        h('h3', { class: 'section-title' }, 'Ce qui changera'),
        p.diff?.identical
          ? h('p', { class: 'muted' }, 'Cette version est identique à l’état actuel. Il n’y a rien à restaurer.')
          : h('ul', { class: 'changes' }, changes),
        p.losses.length
          ? h(
              'div',
              { class: 'callout', dataset: { health: 'failed' }, style: 'margin-top: var(--s4)' },
              icon('alert'),
              h(
                'div',
                null,
                h('strong', null, `${p.losses.map((l) => plural(l.count, ...splitLabel(app, l.key))).join(', ')} disparaîtraient de l’état actuel.`),
                h('p', null, 'Ce sont des données importantes. Elles resteront récupérables dans la copie de sécurité créée juste avant la restauration.'),
              ),
            )
          : null,
        h(
          'div',
          { class: 'callout', dataset: { health: 'pending' }, style: 'margin-top: var(--s3)' },
          icon('shield'),
          h(
            'div',
            null,
            h('strong', null, 'Avant toute modification'),
            h('p', null, 'Une copie de sécurité de l’état actuel est créée et vérifiée. Si une étape échoue, les données actuelles restent intactes.'),
          ),
        ),
        h('p', { class: 'faint small', style: 'margin-top: var(--s3)' }, `Démonstration : seule la copie de ${app.name} détenue par le coffre est modifiée. L’application elle-même n’est jamais touchée sans contrat d’intégration validé.`),
        !p.diff?.identical &&
          h(
            'label',
            { class: 'ack', for: 'restore-ack' },
            ack,
            h('span', null, `Je remplace l’état actuel par la version du ${formatDate(version.createdAt)}.`),
          ),
      );
      setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Annuler'), go);
      go.addEventListener('click', () => runRestoreInSheet(sheet, version));
    })
    .catch((e: OperationError) => {
      if (ctrl.signal.aborted) return;
      replace(
        sheet.body,
        h('div', { class: 'callout', dataset: { health: 'failed' } }, icon('alert'), h('div', null, h('strong', null, 'Prévisualisation impossible'), h('p', null, `${e.message} Rien n’a été modifié.`))),
      );
    });
}

function splitLabel(app: { collections: Record<string, { one: string; many: string }> }, key: string): [string, string] {
  const l = app.collections[key];
  return [l?.one ?? key, l?.many ?? key];
}

function runRestoreInSheet(sheet: SheetHandle, version: Version) {
  const app = store.get().apps[version.appId];
  const steps = stepList(RESTORE_STEPS);
  const result = h('div', { 'aria-live': 'polite' });
  replace(sheet.body, steps.el, result);
  setFoot(sheet);
  sheet.onClose(() => {
    if (store.get().busy?.kind === 'restore') toast(`La restauration de ${app.name} continue en arrière-plan.`, { kind: 'info' });
  });
  store.set({ busy: { kind: 'restore', appId: version.appId } });
  runRestore(version.id, steps.update)
    .then(({ safetyVersionId }) => {
      result.append(
        h(
          'div',
          { class: 'outcome', dataset: { health: 'verified' } },
          seal(),
          h(
            'div',
            null,
            h('h3', null, 'Restauration terminée'),
            h(
              'dl',
              null,
              h('dt', null, 'Version appliquée'),
              h('dd', null, `${version.id} du ${formatDateTime(version.createdAt)}`),
              h('dt', null, 'Copie de sécurité'),
              h('dd', null, safetyVersionId),
            ),
          ),
        ),
      );
      setFoot(sheet, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => sheet.close() }, 'Terminé'));
      if (!sheet.dialog.isConnected) toast(`${app.name} : restauration terminée`, { kind: 'ok' });
      announce('Restauration terminée');
    })
    .catch((e: OperationError) => {
      result.append(
        h(
          'div',
          { class: 'outcome', dataset: { health: 'failed' } },
          failureSeal(),
          h('div', null, h('h3', null, 'Restauration interrompue'), h('p', { class: 'small' }, e.message), h('p', { class: 'small muted' }, 'Les données actuelles n’ont pas été modifiées.')),
        ),
      );
      setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'));
      if (!sheet.dialog.isConnected) toast(`${app.name} : restauration interrompue, rien n’a été modifié`, { kind: 'bad' });
    })
    .finally(() => store.set({ busy: null }));
}

// ─── Contrôle d'intégrité ──────────────────────────────────────────────────

export function openVerifyAll() {
  if (!busyGuard()) return;
  const sheet = openSheet({ title: 'Vérifier toutes les sauvegardes' });
  const total = store.get().versions.length;
  const bar = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0', 'aria-label': 'Fichiers vérifiés' }, h('i', { style: 'transform: scaleX(0)' }));
  const label = h('p', { class: 'num', style: 'margin-top: var(--s2)' }, `0 sur ${total}`);
  const result = h('div', { 'aria-live': 'polite' });
  sheet.body.append(h('p', { class: 'muted', style: 'margin-bottom: var(--s4)' }, 'Chaque fichier est relu dans Drive et son empreinte SHA-256 comparée à celle enregistrée lors de la sauvegarde.'), bar, label, result);
  const ctrl = new AbortController();
  setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => ctrl.abort() }, 'Annuler'));
  sheet.onClose(() => ctrl.abort());
  store.set({ busy: { kind: 'verify' } });
  verifyAll((done, t) => {
    (bar.firstElementChild as HTMLElement).style.transform = `scaleX(${done / t})`;
    bar.setAttribute('aria-valuenow', String(done));
    label.textContent = `${done} sur ${t}`;
  }, ctrl.signal)
    .then(({ total: t, mismatches }) => {
      result.append(
        mismatches
          ? h('div', { class: 'outcome', dataset: { health: 'failed' } }, failureSeal(), h('div', null, h('h3', null, `${mismatches} fichier(s) altéré(s)`), h('p', { class: 'small muted' }, 'Ces versions ne seront plus proposées à la restauration.')))
          : h('div', { class: 'outcome', dataset: { health: 'verified' } }, seal(), h('div', null, h('h3', null, `${plural(t, 'fichier vérifié', 'fichiers vérifiés')}`), h('p', { class: 'small muted' }, 'Toutes les empreintes correspondent.'))),
      );
      setFoot(sheet, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => sheet.close() }, 'Terminé'));
    })
    .catch(() => {
      if (sheet.dialog.isConnected) {
        result.append(h('p', { class: 'muted' }, 'Contrôle annulé. Aucune donnée n’a été modifiée.'));
        setFoot(sheet, h('button', { class: 'btn', type: 'button', onclick: () => sheet.close() }, 'Fermer'));
      }
    })
    .finally(() => store.set({ busy: null }));
}

export { HEALTH_LABEL };
