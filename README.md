# MediSocial

Application web mêlant **Facebook** (fil d'actualité, likes, commentaires, messagerie privée) et **Doctolib** (annuaire de médecins, créneaux horaires, prise et gestion de rendez-vous).

## Lancer

```bash
npm start
```

Puis ouvrir http://127.0.0.1:3000

Aucune dépendance externe : Node.js 22+ (SQLite intégré via `node:sqlite`).

## Comptes de démo (mot de passe : `password123`)

| Rôle    | Email                 |
|---------|-----------------------|
| Patient | julie@medisocial.fr   |
| Médecin | sophie@medisocial.fr  |

Autres comptes : `karim@`, `claire@`, `thomas@`, `amelie@` (médecins), `marc@`, `lea@` (patients), tous en `@medisocial.fr`.

## Fonctionnalités

- **Authentification** : inscription patient ou médecin, sessions par cookie HttpOnly, mots de passe hachés (scrypt).
- **Fil d'actualité** : publications, likes, commentaires, recherche de médecins directement depuis le fil.
- **Messagerie privée** : conversations 1-to-1, rafraîchissement automatique (polling 3 s), indicateur de messages non lus.
- **Annuaire médecins** : recherche par nom, spécialité et ville, fiche avec bio et créneaux disponibles.
- **Rendez-vous** :
  - Patient : choisit un créneau libre, indique un motif → demande « en attente ».
  - Médecin : confirme ou annule les demandes, ajoute ses propres créneaux.
  - L'annulation libère automatiquement le créneau.
- **Profil** : modification du nom, ville, bio, spécialité (médecins).

## Structure

```
medisocial/
├── server.js        # Serveur HTTP + API REST (aucune dépendance)
├── db.js            # Schéma SQLite + données de démo
├── public/
│   ├── index.html
│   ├── style.css    # Style type Facebook (bleu) + accents Doctolib (vert)
│   └── app.js       # Application monopage (SPA)
└── data/            # Base SQLite (créée au premier lancement)
```
