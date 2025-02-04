import { validate } from '@ban-team/validateur-bal';
import { normalize } from '@ban-team/adresses-util/lib/voies';
import { chain, compact, keyBy, min, max } from 'lodash';
import { v4 as uuid } from 'uuid';

import { beautifyUppercased, beautifyNomAlt } from './string.utils';

import { PositionTypeEnum } from '@/shared/entities/position.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import { Row } from '../types/validator.types';
import { ObjectId } from 'mongodb';
import { Logger } from '@/shared/utils/logger.utils';

export type FromCsvType = {
  isValid?: boolean;
  validationError?: string;
  accepted?: number;
  rejected?: number;
  communeNomsAlt?: Record<string, string>;
  voies?: Partial<Voie>[];
  numeros?: Partial<Numero>[];
  toponymes?: Partial<Toponyme>[];
};

export function extractIdBanAdresse({
  parsedValues,
  additionalValues,
}: Row): string | null {
  return (
    parsedValues?.id_ban_adresse ||
    additionalValues?.uid_adresse?.idBanAdresse ||
    null
  );
}

export function extractIdBanToponyme({
  parsedValues,
  additionalValues,
}: Row): string | null {
  return (
    parsedValues?.id_ban_toponyme ||
    additionalValues?.uid_adresse?.idBanToponyme ||
    null
  );
}

export function extractCodeCommune({
  parsedValues,
  additionalValues,
}: Row): string | null {
  return (
    parsedValues.commune_insee || additionalValues?.cle_interop?.codeCommune
  );
}

function extractPosition(row: any) {
  return {
    source: row.parsedValues.source || null,
    type: row.parsedValues.position || PositionTypeEnum.ENTREE,
    point: {
      type: 'Point',
      coordinates: [row.parsedValues.long, row.parsedValues.lat],
    },
  };
}

function extractPositions(rows: any) {
  return rows
    .filter((r) => r.parsedValues.long && r.parsedValues.lat)
    .map((r) => extractPosition(r));
}

function extractDate(row: any) {
  if (row.parsedValues.date_der_maj) {
    return new Date(row.parsedValues.date_der_maj);
  }
}

function extractData(rows: Row[]): {
  voies: Partial<Voie>[];
  numeros: Partial<Numero>[];
  toponymes: Partial<Toponyme>[];
} {
  const toponymes: Partial<Toponyme>[] = chain(rows)
    .filter((r) => r.parsedValues.numero === 99999)
    .groupBy((r) => normalize(r.parsedValues.voie_nom))
    .map((toponymeRows) => {
      const date = extractDate(toponymeRows[0]) || new Date();
      return {
        id: new ObjectId().toHexString(),
        banId: extractIdBanToponyme(toponymeRows[0]),
        nom: beautifyUppercased(toponymeRows[0].parsedValues.voie_nom),
        nomAlt: toponymeRows[0].localizedValues.voie_nom
          ? beautifyNomAlt(toponymeRows[0].localizedValues.voie_nom)
          : null,
        positions: extractPositions(toponymeRows),
        communeDeleguee:
          toponymeRows[0].rawValues.commune_deleguee_insee || null,
        createdAt: date,
        updatedAt: date,
      };
    })
    .value();

  const toponymesIndex = keyBy(toponymes, (t) => normalize(t.nom));

  const voies: Partial<Voie>[] = chain(rows)
    .filter((r) => r.parsedValues.numero !== 99999)
    .groupBy((r) => normalize(r.parsedValues.voie_nom))
    .map((voieRows) => {
      const dates = compact(voieRows.map((r) => r.parsedValues.date_der_maj));
      return {
        id: new ObjectId().toHexString(),
        banId: extractIdBanToponyme(voieRows[0]),
        nom: beautifyUppercased(voieRows[0].parsedValues.voie_nom),
        nomAlt: voieRows[0].localizedValues.voie_nom
          ? beautifyNomAlt(voieRows[0].localizedValues.voie_nom)
          : null,
        createdAt: dates.length > 0 ? new Date(min(dates)) : new Date(),
        updatedAt: dates.length > 0 ? new Date(max(dates)) : new Date(),
      };
    })
    .value();

  const voiesIndex = keyBy(voies, (v) => normalize(v.nom));

  const numeros: Partial<Numero>[] = chain(rows)
    .filter((r) => r.parsedValues.numero !== 99999)
    .groupBy(
      (r: Row) =>
        `${r.parsedValues.numero}@@@${r.parsedValues.suffixe}@@@${normalize(
          r.parsedValues.voie_nom,
        )}`,
    )
    .map((numeroRows: Row[]) => {
      const date = extractDate(numeroRows[0]) || new Date();

      const voieString = normalize(numeroRows[0].parsedValues.voie_nom);
      const toponymeString = numeroRows[0].parsedValues.lieudit_complement_nom
        ? normalize(numeroRows[0].parsedValues.lieudit_complement_nom)
        : null;
      const toponymeAlt = numeroRows[0].localizedValues.lieudit_complement_nom
        ? beautifyNomAlt(numeroRows[0].localizedValues.lieudit_complement_nom)
        : null;

      if (toponymeString && !(toponymeString in toponymesIndex)) {
        const toponyme: Partial<Toponyme> = {
          id: new ObjectId().toHexString(),
          banId: uuid(),
          nom: beautifyUppercased(
            numeroRows[0].parsedValues.lieudit_complement_nom,
          ),
          nomAlt: toponymeAlt,
          positions: [],
          parcelles: numeroRows[0].parsedValues.cad_parcelles,
          communeDeleguee:
            numeroRows[0].rawValues.commune_deleguee_insee || null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        toponymes.push(toponyme);
        toponymesIndex[toponymeString] = toponyme;
      }

      return {
        id: new ObjectId().toHexString(),
        banId: extractIdBanAdresse(numeroRows[0]),
        voieId: voiesIndex[voieString].id,
        toponymeId: toponymeString ? toponymesIndex[toponymeString].id : null,
        numero: numeroRows[0].parsedValues.numero,
        suffixe: numeroRows[0].parsedValues.suffixe || null,
        certifie: numeroRows[0].parsedValues.certification_commune,
        positions: extractPositions(numeroRows),
        parcelles: numeroRows[0].parsedValues.cad_parcelles,
        communeDeleguee: numeroRows[0].parsedValues.commune_deleguee_insee,
        createdAt: date,
        updatedAt: date,
      };
    })
    .value();

  return { voies, numeros, toponymes };
}

export async function extractFromCsv(
  file: Buffer,
  codeCommune: string,
): Promise<FromCsvType> {
  try {
    const {
      rows,
      parseOk,
    }: {
      rows: Row[];
      parseOk: boolean;
    } = await validate(file, { profile: '1.4-relax' });

    if (!parseOk) {
      return { isValid: false };
    }

    const accepted: Row[] = rows.filter(({ isValid }) => isValid);
    const rejected: Row[] = rows.filter(({ isValid }) => !isValid);

    const communesData = extractData(
      accepted.filter((r) => extractCodeCommune(r) === codeCommune),
    );

    const communeNomsAlt =
      rows.find((row) => row.localizedValues?.commune_nom)?.localizedValues
        ?.commune_nom || null;

    return {
      isValid: true,
      accepted: accepted.length,
      rejected: rejected.length,
      communeNomsAlt,
      voies: communesData.voies,
      numeros: communesData.numeros,
      toponymes: communesData.toponymes,
    };
  } catch (error) {
    Logger.error(
      `Impossible d'extraire la BAL sur CSV`,
      error,
      extractFromCsv.name,
    );
    return { isValid: false, validationError: error.message };
  }
}
