# NOESIS 3.1 — références CI immuables — 23 octobre 2026

## Problème et périmètre

Le pipeline utilisait des tags mobiles d'actions, y compris lors des publications.
Un déplacement amont peut ainsi changer le code exécuté sans modification du dépôt.
Ce correctif sensible est préparé pour revue humaine ; il ne doit pas être fusionné
automatiquement. Aucun réglage GitHub/Cloudflare, secret, OAuth ou fichier utilisateur
n'est modifié. Les conditions, permissions, environnements et gates de publication
restent inchangés.

Les SHA ci-dessous sont ceux résolus dans les logs du [pipeline réussi 39928831251](https://github.com/iPoower/Control-Vault/actions/runs/39928831251),
comparés le 23/10/2026 aux références des dépôts officiels `actions/*`.
Aucune montée de version d'action n'est effectuée.

| Action | Référence figée |
|---|---|
| actions/checkout v4 | `11d5960a326750d5838078e36cf38b85af677262` |
| actions/setup-node v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| actions/upload-artifact v4 | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| actions/download-artifact v4 | `d3f86a106a0bac45b974a628896c90dbdf5c8093` |
| actions/deploy-pages v4 | `d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e` |

Épingler seulement `upload-pages-artifact` ne suffit pas : son [action composite v3](https://github.com/actions/upload-pages-artifact/blob/56afc609e74202658d3ffba0e8f6dda462b719fa/action.yml)
appelle `upload-artifact@v4`. L'archive Linux est donc préparée directement avec GNU tar,
puis envoyée par l'uploader figé : même nom `github-pages`, fichier `artifact.tar`,
liens déréférencés, fichiers cachés inclus hors métadonnées Git, rétention d'artefact CI
d'un jour. Cette rétention concerne uniquement l'artefact de publication GitHub Actions,
pas des sauvegardes personnelles ; elle conserve la valeur par défaut précédente.

## Vérification et limites

Les tests `workflow-provenance.test.ts` refusent les références mobiles et la réintroduction
du composite. Ils exécutent le vrai conditionnement sur des fichiers fictifs, comparent
les octets extraits (HTML, version/configuration, assets et fichier caché) et contrôlent
le déréférencement d'un lien ainsi que l'exclusion de `.git`/`.github`.
Ils échouent avant le correctif. Les invariants existants du pipeline restent requis.

La PR ne publie rien : les jobs de déploiement exigent toujours un push sur main après
la vérification complète. Une CI de PR verte ne démontre pas à elle seule le déploiement
du nouvel assemblage Pages. La recette de publication restera à effectuer après GO humain.

Le runner, l'image Playwright et le lancement npx de Wrangler restent des dépendances de
confiance à examiner séparément. Ce correctif ne prétend pas verrouiller toute la chaîne
transitive npm ni empêcher une compromission du compte administrateur.

Retour arrière : PR relue et CI complète, vers un état connu ; ne pas réintroduire
silencieusement des tags mobiles. Un retour de code ne restaure aucune donnée.
Référence : [GitHub, usage sécurisé des actions](https://docs.github.com/en/actions/reference/security/secure-use), consultée le 23/10/2026.
