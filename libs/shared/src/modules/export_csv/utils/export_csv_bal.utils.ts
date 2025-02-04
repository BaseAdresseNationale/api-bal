import * as csvWriter from 'csv-write-stream';
import * as getStream from 'get-stream';
import * as intoStream from 'into-stream';
import { keyBy } from 'lodash';
import * as pumpify from 'pumpify';
import * as proj from '@etalab/project-legal';

import { Toponyme } from '@/shared/entities/toponyme.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { getCommune, getOldCommune } from '@/shared/utils/cog.utils';
import { roundCoordinate } from '@/shared/utils/coor.utils';
import { BaseLocale } from '@/shared/entities/base_locale.entity';

const DEFAULT_CODE_VOIE = 'xxxx';
const DEFAULT_NUMERO_TOPONYME = 99999;
const DEFAULT_SOURCE = 'commune';

type BanIdsType = {
  commune: string;
  toponyme: string;
  adresse?: string;
};

type RowType = {
  banIds: BanIdsType;
  codeCommune: string;
  communeDeleguee?: string;
  communeNomsAlt: Record<string, string>;
  codeVoie: string;
  numero: number;
  suffixe?: string;
  certifie?: boolean;
  nomVoie: string;
  nomVoieAlt: Record<string, string>;
  nomToponyme?: string;
  nomToponymeAlt?: Record<string, string>;
  parcelles: string[];
  position?: any;
  updatedAt: Date;
  commentNumero?: string;
  commentVoie?: string;
};

type CsvRowType = {
  id_ban_commune: string;
  id_ban_toponyme: string;
  id_ban_adresse: string;
  cle_interop: string;
  voie_nom: string;
  lieudit_complement_nom: string;
  numero: string;
  suffixe: string;
  certification_commune: string;
  commune_insee: string;
  commune_nom: string;
  commune_deleguee_insee: string;
  commune_deleguee_nom: string;
  position: string;
  long: string;
  lat: string;
  x: string;
  y: string;
  cad_parcelles: string;
  source: string;
  date_der_maj: string;
  commentaire_numero?: string;
  commentaire_voie?: string;
};

function formatCleInterop(
  codeCommune: string,
  codeVoie: string,
  numero: number,
  suffixe: string,
): string {
  const str = `${codeCommune}_${codeVoie}_${numero
    .toString()
    .padStart(5, '0')}`;
  if (!suffixe) {
    return str.toLowerCase();
  }

  return (str + '_' + suffixe).toLowerCase();
}

// Convertie "certifie" en booleen CSV (0 ou 1)
// Gère les valeurs undefined comme cela peut être le cas pour les toponyme
function toCsvBoolean(certifie: boolean): string {
  if (certifie === undefined || certifie === null) {
    return '';
  }

  return certifie ? '1' : '0';
}

function extractHeaders(csvRows: CsvRowType[]): string[] {
  const headers = new Set<string>();

  for (const row of csvRows) {
    for (const header of Object.keys(row)) {
      headers.add(header);
    }
  }

  return [...headers];
}

/* eslint camelcase: off */
function createRow(obj: RowType, withComment: boolean): CsvRowType {
  const row: CsvRowType = {
    cle_interop: formatCleInterop(
      obj.codeCommune,
      obj.codeVoie,
      obj.numero,
      obj.suffixe,
    ),
    id_ban_commune: obj.banIds.commune,
    id_ban_toponyme: obj.banIds.toponyme,
    id_ban_adresse: obj.banIds.adresse || '',
    voie_nom: obj.nomVoie,
    lieudit_complement_nom: obj.nomToponyme || '',
    numero: obj.numero.toString() || '',
    suffixe: obj.suffixe || '',
    certification_commune: toCsvBoolean(obj.certifie),
    commune_insee: obj.codeCommune,
    commune_nom: getCommune(obj.codeCommune).nom,
    commune_deleguee_insee: obj.communeDeleguee || null,
    commune_deleguee_nom: obj.communeDeleguee
      ? getOldCommune(obj.communeDeleguee).nom
      : null,
    position: '',
    long: '',
    lat: '',
    x: '',
    y: '',
    cad_parcelles: obj.parcelles ? obj.parcelles.join('|') : '',
    source: DEFAULT_SOURCE,
    date_der_maj: obj.updatedAt ? obj.updatedAt.toISOString().slice(0, 10) : '',
  };

  if (withComment) {
    row.commentaire_numero = obj.commentNumero;
    row.commentaire_voie = obj.commentVoie;
  }

  if (obj.communeNomsAlt) {
    Object.keys(obj.communeNomsAlt).forEach((o) => {
      row['commune_nom_' + o] = obj.communeNomsAlt[o];
    });
  }

  if (obj.nomVoieAlt) {
    Object.keys(obj.nomVoieAlt).forEach((o) => {
      row['voie_nom_' + o] = obj.nomVoieAlt[o];
    });
  }

  if (obj.nomToponymeAlt) {
    Object.keys(obj.nomToponymeAlt).forEach((o) => {
      row['lieudit_complement_nom_' + o] = obj.nomToponymeAlt[o];
    });
  }

  if (obj.position) {
    const coordsPosition = obj.position.point.coordinates;
    const projectedCoords = proj(coordsPosition);
    row.position = obj.position.type;
    row.source = obj.position.source || DEFAULT_SOURCE;
    row.long = roundCoordinate(coordsPosition[0], 6).toString();
    row.lat = roundCoordinate(coordsPosition[1], 6).toString();
    if (projectedCoords) {
      row.x = projectedCoords[0].toString();
      row.y = projectedCoords[1].toString();
    }
  }
  return row;
}

export async function exportBalToCsv(
  baseLocale: BaseLocale,
  voies: Voie[],
  toponymes: Toponyme[],
  numeros: Numero[],
  withComment: boolean,
): Promise<string> {
  const voiesIndex: Record<string, Voie> = keyBy(voies, 'id');
  const rows: RowType[] = [];
  numeros.forEach((n) => {
    const v: Voie = voiesIndex[n.voieId];

    let toponyme: Toponyme = null;

    if (n.toponymeId) {
      toponyme = toponymes.find(({ id }) => id == n.toponymeId);

      if (!toponyme) {
        throw new Error(
          `Toponyme ${n.toponyme} introuvable dans la base de données`,
        );
      }
    }

    if (n.positions && n.positions.length > 0) {
      n.positions.forEach((p) => {
        rows.push({
          codeCommune: baseLocale.commune,
          communeDeleguee: n.communeDeleguee,
          banIds: {
            commune: baseLocale.banId,
            toponyme: v.banId,
            adresse: n.banId,
          },
          communeNomsAlt: baseLocale.communeNomsAlt,
          codeVoie: DEFAULT_CODE_VOIE,
          numero: n.numero,
          suffixe: n.suffixe,
          certifie: n.certifie || false,
          updatedAt: n.updatedAt,
          nomVoie: v.nom,
          nomVoieAlt: v.nomAlt || null,
          nomToponyme: toponyme?.nom || null,
          nomToponymeAlt: toponyme?.nomAlt || null,
          parcelles: n.parcelles,
          position: p,
          commentNumero: n.comment,
          commentVoie: v.comment,
        });
      });
    }
  });

  toponymes.forEach((t) => {
    if (t.positions.length > 0) {
      t.positions.forEach((p) => {
        rows.push({
          codeCommune: baseLocale.commune,
          communeDeleguee: t.communeDeleguee,
          banIds: {
            commune: baseLocale.banId,
            toponyme: t.banId,
          },
          communeNomsAlt: baseLocale.communeNomsAlt,
          codeVoie: DEFAULT_CODE_VOIE,
          numero: DEFAULT_NUMERO_TOPONYME,
          updatedAt: t.updatedAt,
          nomVoie: t.nom,
          nomVoieAlt: t.nomAlt || null,
          parcelles: t.parcelles,
          position: p,
        });
      });
    } else {
      rows.push({
        banIds: {
          commune: baseLocale.banId,
          toponyme: t.banId,
        },
        codeCommune: baseLocale.commune,
        communeDeleguee: t.communeDeleguee,
        communeNomsAlt: baseLocale.communeNomsAlt,
        codeVoie: DEFAULT_CODE_VOIE,
        numero: DEFAULT_NUMERO_TOPONYME,
        updatedAt: t.updatedAt,
        nomVoie: t.nom,
        nomVoieAlt: t.nomAlt || null,
        parcelles: t.parcelles,
      });
    }
  });
  const csvRows: CsvRowType[] = rows.map((row) => createRow(row, withComment));
  const headers: string[] = extractHeaders(csvRows);

  return getStream(
    pumpify.obj(
      intoStream.object(csvRows),
      csvWriter({ separator: ';', newline: '\r\n', headers }),
    ),
  );
}
