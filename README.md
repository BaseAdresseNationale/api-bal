# Mes Adresses API

Mes adresses api est un dispositif logiciel composé de deux application

- API: permettant la gestion de bases d’adresses à l’échelon local coupler avec [Mes adresses](https://github.com/BaseAdresseNationale/mes-adresses)
- CRON: permettant le deploiement continue des BALs de mes-adresses-api vers [Api de depot](https://github.com/BaseAdresseNationale/api-depot)

## Documentation

https://adresse-data-gouv-fr.gitbook.io/bal/mes-adresses

## Pré-requis

- [Node.js](https://nodejs.org) 18+
- [yarn](https://www.yarnpkg.com)
- [PostgresSQL](https://www.postgresql.org/)
- [Redis](https://redis.io/fr/)

## Utilisation

### Installation

Installation des dépendances Node.js

```
yarn
```

Créer les variables d'environnement

```bash
cp .env.sample .env
```

On pourra ensuite éditer les variables d'environnement dans le fichier `.env` si nécessaire.

### Développement

Lancer l'api de développement :

```
$ yarn dev:api
```

Lancer le cron de développement :

```
$ yarn dev:cron
```

### Production

Créer une version de production :

```
$ yarn build
```

Démarrer l'api (port 3000 par défaut) :

```
$ yarn start:api
```

Démarrer le cron :

```
$ yarn start:cron
```

### Mise a jour

Mettre a jour les liste des communes (code insee) qui ont un cadastre

```
yarn update-cadastre
```

### Test

Rapport des tests (jest) :

```
$ yarn test
```

### Linter

Rapport du linter (eslint) :

```
$ yarn lint
```

## Configuration

Cette application utilise des variables d'environnement pour sa configuration.
Elles peuvent être définies classiquement ou en créant un fichier `.env` sur la base du modèle `.env.sample`.

| Nom de la variable        | Description                                                                 |
| ------------------------- | --------------------------------------------------------------------------- |
| `POSTGRES_URL`            | Url de connection a la db postgres                                          |
| `REDIS_URL`               | Url de connection a la db redis                                             |
| `PORT`                    | Port à utiliser pour l'API                                                  |
| `SHOW_EMAILS`             | Indique si les courriels doivent être affichés dans les logs (`YES`)        |
| `API_URL`                 | URL de base de l’API                                                        |
| `API_DEPOT_URL`           | URL de l'api-depot                                                          |
| `API_DEPOT_CLIENT_ID`     | Id du client de l'api-depot                                                 |
| `API_DEPOT_CLIENT_SECRET` | Token du client de l'api-depot                                              |
| `EDITOR_URL_PATTERN`      | Pattern permettant de construire l'URL vers l'édition d'une BAL             |
| ---                       | ---                                                                         |
| `SMTP_HOST`               | Nom d'hôte du serveur SMTP                                                  |
| `SMTP_PORT`               | Port du serveur SMTP                                                        |
| `SMTP_USER`               | Nom d'utilisateur pour se connecter au serveur SMTP                         |
| `SMTP_PASS`               | Mot de passe pour se connecter au serveur SMTP                              |
| `SMTP_SECURE`             | Indique si le serveur SMTP nécessite une connexion sécurisée (`YES`)        |
| `SMTP_FROM`               | Adresse à utiliser en tant qu'expéditeur des emails                         |
| `SMTP_BCC`                | Adresse(s) en copie cachée à utiliser pour tous les envois de notifications |

Toutes ces variables ont des valeurs par défaut que vous trouverez dans le fichier `.env.sample`.

## Gouvernance

Ce outil a été conçu à l'initiative d'Etalab. Il est depuis 2020 piloté conjointement par Etalab et l'ANCT.

## Licence

MIT
