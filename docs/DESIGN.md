# Design system — Control Vault

**Calme, contrôle, confiance.** L'interface doit répondre en moins de cinq secondes de lecture à trois questions : où sont mes données, sont-elles protégées, que puis-je faire.

## Direction

- **Encre d'ardoise + laiton.** Un fond bleu-ardoise profond plutôt qu'un noir neutre ; le laiton rappelle le métal d'un coffre. Il est réservé à la marque et à l'action principale — jamais à un état.
- **L'élément mémorable : le cadran.** Au centre de l'accueil, une graduation de coffre entoure quatre arcs : Drive, Supabase, Race Control, Reconversion Control. Chaque arc ne prend une couleur qu'à partir d'un état réellement vérifié. Le chiffre central (« 3 / 4 sources vérifiées ») se lit d'un coup d'œil.
- **Le reste est discret.** Pas de dégradés, pas de verre dépoli décoratif (seules les barres de navigation floutent le contenu qui défile), pas d'ombres sur les panneaux en sombre.

## Couleurs

| Rôle | Sombre | Clair | Usage |
|---|---|---|---|
| Fond | `#121920` | `#EDF0F3` | Page |
| Surface | `#1B252F` | `#FFFFFF` | Panneaux, feuilles |
| Texte | `#E8EEF3` | `#13202B` | Contenu |
| Laiton | `#CFB074` | `#8C6922` | Marque, action principale |
| Vérifié | `#5DC4A2` | `#106A49` | Empreinte contrôlée, connexion confirmée |
| À rafraîchir | `#E5B05A` | `#7E5108` | Donnée trop ancienne, point à surveiller |
| Échec | `#EE786C` | `#A8302A` | Opération échouée, session expirée |
| En cours / en attente | `#7DB1E3` | `#225C93` | File d'attente, opération active |
| Non vérifié | `#93A2B0` | `#505F6B` | Hors ligne, jamais contacté |

Les couleurs d'état passent par une variable unique `--hc`, posée par `data-health`. Tous les couples texte/fond respectent WCAG 2.2 AA (vérifié par axe-core en CI, dans les deux thèmes).

## Typographie

**Instrument Sans**, variable en graisse et en largeur, auto-hébergée. Une seule famille : la largeur variable donne la personnalité (titres et chiffres légèrement condensés, `font-stretch: 80–94 %`), le corps reste à 100 %. Chiffres tabulaires partout où l'on compare des valeurs.

| Niveau | Taille | Graisse |
|---|---|---|
| Titre d'écran | 34 px | 620, condensé 92 % |
| Section | 24 px | 600 |
| Sous-section | 19 px | 600 |
| Corps | 16 px (15 px bureau) | 400 |
| Secondaire | 14 px | 400–560 |
| Légende | 12,5 px | 450–600 |

Les champs de saisie restent à 16 px : en dessous, Safari zoome automatiquement.

## Formes et espacements

- Base 4 px : 4, 8, 12, 16, 20, 24, 32, 40, 48.
- Rayons hiérarchisés : 6 (puces, champs), 10 (boutons, lignes), 14 (panneaux), 22 (feuilles). Plus l'objet est grand, plus il est arrondi.
- Cibles tactiles ≥ 44 × 44 px.

## Mouvement

- Une seule animation d'ouverture : les arcs du cadran se dessinent.
- Le reste répond à une action : feuille qui monte, coche qui se trace, liste qui apparaît à l'ouverture d'un dossier.
- 120 à 320 ms, opacité et translation uniquement. Aucune animation ne bloque une interaction.
- `prefers-reduced-motion` et le réglage « Animations réduites » ramènent tout à 1 ms.

## Composants

| Composant | Rôle |
|---|---|
| Cadran | État global par source |
| Pastille d'état | Un état système, toujours accompagné d'un texte |
| Ligne | Unité de liste : glyphe, titre, détail, action |
| Feuille | Dialogue natif : feuille du bas sur mobile, fenêtre centrée sur bureau ; fermeture par bouton, Échap, fond, glissement |
| Liste d'étapes | Progression réelle d'une opération, étape par étape |
| Encart | Conséquence ou risque à lire avant d'agir |
| Bandeau | Situation qui concerne tout l'écran : hors ligne, session expirée, opération en cours |
| Recherche rapide | Ctrl/Cmd + K : actions, écrans, fichiers, versions |

## Écriture

- Tutoiement, phrases courtes, verbes d'action. Un bouton dit ce qu'il fait ; le message de fin reprend le même verbe (« Sauvegarder » → « Sauvegarde terminée et vérifiée »).
- Une erreur dit ce qui s'est passé, ce qui n'a pas été touché, et quoi faire : « Envoi interrompu — connexion perdue. Rien n'a été écrit dans Drive. » + « Réessayer ».
- Jamais « Protégé » ou « Synchronisé » sans preuve.

## Grille de revue d'un écran

Compréhensible immédiatement ? Action principale évidente ? Un élément retirable sans perte ? Erreurs explicites ? Agréable à 320 px ? Inspire confiance ? Si une réponse est non, l'écran est retravaillé avant fusion.
