// Recette Phase T — chaque exécution repart d'un dossier de sortie vide (pas de mélange entre exécutions).
import { rmSync } from 'node:fs';
import { OUT } from './recorder';

export default async function setup() {
  rmSync(OUT, { recursive: true, force: true });
}
