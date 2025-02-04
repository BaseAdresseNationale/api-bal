import { keyBy, groupBy } from 'lodash';
import * as communes from '@etalab/decoupage-administratif/data/communes.json';
import * as departements from '@etalab/decoupage-administratif/data/departements.json';
import { CommuneCOG } from '../types/cog.type';

export enum CommuneTypeEnum {
  COMMUNE_ACTUELLE = 'commune-actuelle',
  ARRONDISSEMENT_MUNICIPAL = 'arrondissement-municipal',
  COMMUNE_DELEGUEE = 'commune-deleguee',
}

const filteredCommunes: CommuneCOG[] = (communes as Array<any>).filter((c) =>
  [
    CommuneTypeEnum.COMMUNE_ACTUELLE,
    CommuneTypeEnum.ARRONDISSEMENT_MUNICIPAL,
  ].includes(c.type),
);

const communesIndex: Record<string, CommuneCOG> = keyBy(
  filteredCommunes,
  'code',
);

const oldCommunes: CommuneCOG[] = (communes as Array<any>).filter((c) =>
  [CommuneTypeEnum.COMMUNE_DELEGUEE].includes(c.type),
);

const oldCommunesIndex: Record<string, CommuneCOG> = keyBy(oldCommunes, 'code');

const departementsIndex = keyBy(departements, 'code');

const communesByDepartementIndex = groupBy(communes, 'departement');

export function getCommunesByDepartement(codeDepartement) {
  return communesByDepartementIndex[codeDepartement] || [];
}

export function getOldCommune(codeCommune) {
  return oldCommunesIndex[codeCommune];
}

export function getCommune(codeCommune) {
  return communesIndex[codeCommune];
}

export function getCodesCommunes() {
  return (communes as CommuneCOG[]).map((c) => c.code);
}

export function getDepartement(codeDepartement) {
  return departementsIndex[codeDepartement];
}
