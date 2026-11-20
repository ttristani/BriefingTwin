# Briefing prévol Twinjet

Web app pour iPad (PWA) : on choisit la rotation, l'horaire et la date, et l'appli affiche un briefing météo et NOTAM avec un statut vert, orange ou rouge pour chaque terrain (départ, destination, dégagements).

> Aide à la décision uniquement. Elle ne remplace pas le dossier météo officiel, et la décision reste au commandant de bord.

## Fonctionnement

- **`data/programme.json`** : le programme Winter 2026 (5 rotations, 24 vols, dégagements), repris des fiches briefing.
- **`data/minima.json`** : les pistes (QFU) et les approches de chaque terrain. Tant qu'un terrain n'a pas ses approches, l'appli suppose un **ILS CAT I avec DA/H 200 ft et RVR 550 m** sur chaque QFU, et l'indique.
- **`.github/workflows/collecte.yml`** : toutes les 30 minutes, GitHub Actions récupère les METAR et TAF (aviationweather.gov) et les NOTAM (FAA NOTAM Search), puis les enregistre dans `data/wx.json`.
- **L'appli** (`index.html`, `app.js`, `engine.js`) :
  - lit `data/wx.json`, et récupère aussi les METAR et TAF en direct quand c'est possible ;
  - calcule les créneaux : départ de STD à STD + 1 h, destination à ETA ± 1 h, dégagements de ETA à ETA + 2 h ;
  - retient le pire cas en prenant en compte tous les TEMPO et PROB ;
  - applique les minima Air OPS (AMC6 CAT.OP.MPA.182, schéma de base) et les limites de vent réglables ;
  - filtre les NOTAM par sujet et par période.
- **Bouton PDF / Imprimer** : passe par l'impression de l'iPad (Partager → Enregistrer dans Fichiers, au format A5).

## Mise en place (une seule fois)

1. Créer un dépôt **public** `briefing-twinjet` sur GitHub et y déposer tous les fichiers. GitHub Pages est gratuit pour les dépôts publics.
2. **Settings → Pages** : dans Source, choisir « Deploy from a branch », puis la branche `main`, dossier `/ (root)`.
3. **Settings → Actions → General** : dans Workflow permissions, choisir « Read and write permissions ».
4. **Actions → Collecte météo et NOTAM → Run workflow**, pour une première collecte immédiate.
5. Sur l'iPad, ouvrir `https://<ton-compte>.github.io/briefing-twinjet/` dans Safari, puis Partager → **Sur l'écran d'accueil**.

## Mettre à jour

- **Minima** : modifier `data/minima.json` directement sur GitHub (icône crayon). Exemple pour une approche :
  `{"nom": "ILS Z 23", "qfu": 233, "type": "B", "dh": 200, "rvr": 550}`
  - type `B` : 3D avec DH < 250 ft ;
  - type `A` : 2D, ou 3D avec DH ≥ 250 ft ;
  - type `C` : circling (dh = MDH, rvr = VIS).
- **Programme** : modifier `data/programme.json` au changement de saison. Jours : 0 = dimanche, 1 = lundi … 6 = samedi.
- **Limites de vent** : bouton ⚙︎ dans l'appli (enregistré sur l'iPad).

## Limites connues

- Les NOTAM viennent de la base FAA : **pas de NOTAM de FIR ni d'en-route**, et il peut en manquer.
- Les QFU de `minima.json` sont approximatifs : à vérifier dans l'AIP.
- Les horaires ATS des terrains ne sont pas contrôlés.
- Les tâches planifiées de GitHub Actions peuvent être retardées de quelques minutes. GitHub peut aussi les suspendre après une longue période sans activité dans le dépôt : il suffit alors de les réactiver dans l'onglet Actions.
