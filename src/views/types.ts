import type { State } from '../core/store';

export interface ViewContext {
  params: Record<string, string>;
  /** Mémoire propre à la route : filtres, tri, recherche — conservée entre deux visites. */
  memory: Record<string, unknown>;
  /** Premier affichage de l'application (pour l'unique animation d'ouverture). */
  firstPaint: boolean;
  navigate(hash: string): void;
}

export interface View {
  el: HTMLElement;
  title: string;
  update?(s: State, changed: Set<keyof State>): void;
  destroy?(): void;
}
