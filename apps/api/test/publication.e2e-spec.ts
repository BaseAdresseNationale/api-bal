import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ObjectId } from 'mongodb';
import axios from 'axios';
import { add, sub } from 'date-fns';
import MockAdapter from 'axios-mock-adapter';
import { v4 as uuid } from 'uuid';

import { Numero } from '@/shared/entities/numero.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import {
  BaseLocale,
  StatusBaseLocalEnum,
  StatusSyncEnum,
} from '@/shared/entities/base_locale.entity';
import { Position, PositionTypeEnum } from '@/shared/entities/position.entity';
import {
  Habilitation,
  StatusHabiliation,
} from '@/shared/modules/api_depot/types/habilitation.type';
import {
  Revision,
  StatusRevision,
} from '@/shared/modules/api_depot/types/revision.type';

import { BaseLocaleModule } from '@/modules/base_locale/base_locale.module';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Point, Repository } from 'typeorm';

describe('PUBLICATION MODULE', () => {
  let app: INestApplication;
  // DB
  let postgresContainer: StartedPostgreSqlContainer;
  let postgresClient: Client;
  let numeroRepository: Repository<Numero>;
  let voieRepository: Repository<Voie>;
  let balRepository: Repository<BaseLocale>;
  let toponymeRepository: Repository<Toponyme>;
  // VAR
  const token = 'xxxx';
  const createdAt = new Date('2000-01-01');
  const updatedAt = new Date('2000-01-02');
  // AXIOS
  const axiosMock = new MockAdapter(axios);

  beforeAll(async () => {
    // INIT DB
    postgresContainer = await new PostgreSqlContainer(
      'postgis/postgis:12-3.0',
    ).start();
    postgresClient = new Client({
      host: postgresContainer.getHost(),
      port: postgresContainer.getPort(),
      database: postgresContainer.getDatabase(),
      user: postgresContainer.getUsername(),
      password: postgresContainer.getPassword(),
    });
    await postgresClient.connect();
    // INIT MODULE
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: postgresContainer.getHost(),
          port: postgresContainer.getPort(),
          username: postgresContainer.getUsername(),
          password: postgresContainer.getPassword(),
          database: postgresContainer.getDatabase(),
          synchronize: true,
          entities: [BaseLocale, Voie, Numero, Toponyme, Position],
        }),
        BaseLocaleModule,
        MailerModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    // INIT REPOSITORY
    numeroRepository = app.get(getRepositoryToken(Numero));
    voieRepository = app.get(getRepositoryToken(Voie));
    balRepository = app.get(getRepositoryToken(BaseLocale));
    toponymeRepository = app.get(getRepositoryToken(Toponyme));
  });

  afterAll(async () => {
    await postgresClient.end();
    await postgresContainer.stop();
    await app.close();
  });

  afterEach(async () => {
    axiosMock.reset();
    await numeroRepository.delete({});
    await voieRepository.delete({});
    await balRepository.delete({});
    await toponymeRepository.delete({});
  });

  async function createBal(props: Partial<BaseLocale> = {}) {
    const payload: Partial<BaseLocale> = {
      banId: uuid(),
      createdAt,
      updatedAt,
      status: props.status ?? StatusBaseLocalEnum.DRAFT,
      token,
      ...props,
    };
    const entityToInsert = balRepository.create(payload);
    const result = await balRepository.save(entityToInsert);
    return result.id;
  }

  async function createVoie(balId: string, props: Partial<Voie> = {}) {
    const payload: Partial<Voie> = {
      balId,
      banId: uuid(),
      createdAt,
      updatedAt,
      ...props,
    };
    const entityToInsert = voieRepository.create(payload);
    const result = await voieRepository.save(entityToInsert);
    return result.id;
  }

  async function createNumero(
    balId: string,
    voieId: string,
    props: Partial<Numero> = {},
  ) {
    const payload: Partial<Numero> = {
      balId,
      banId: uuid(),
      voieId,
      createdAt,
      updatedAt,
      ...props,
    };
    const entityToInsert = numeroRepository.create(payload);
    const result = await numeroRepository.save(entityToInsert);
    return result.id;
  }

  function createPositions(coordinates: number[] = [8, 42]): Position {
    const id = new ObjectId().toHexString();
    const point: Point = {
      type: 'Point',
      coordinates,
    };
    return {
      id,
      type: PositionTypeEnum.ENTREE,
      source: 'ban',
      point,
    } as Position;
  }

  describe('POST /bases-locales/sync/exec', () => {
    it('Publish 200 DRAFT', async () => {
      const commune = '08053';
      const habilitationId = new ObjectId().toHexString();
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId: habilitationId,
        status: StatusBaseLocalEnum.DRAFT,
        emails: ['test@test.fr'],
      });
      const { banId: communeUuid } = await balRepository.findOneBy({
        id: balId,
      });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const { banId: voieUuid } = await voieRepository.findOneBy({
        id: voieId,
      });
      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        suffixe: 'bis',
        positions: [createPositions()],
        certifie: true,
        updatedAt: new Date('2000-01-01'),
        communeDeleguee: '08294',
      });
      const { banId: numeroUuid } = await numeroRepository.findOneBy({
        id: numeroId,
      });
      // MOCK AXIOS
      const habilitation: Habilitation = {
        _id: habilitationId,
        status: StatusHabiliation.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      const revisionId = new ObjectId().toHexString();
      const revision: Revision = {
        _id: revisionId,
        codeCommune: commune,
        status: StatusRevision.PENDING,
        ready: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        current: false,
        validation: {
          valid: true,
        },
      };
      axiosMock.onPost(`/communes/${commune}/revisions`).reply(200, revision);

      axiosMock.onPost(`/revisions/${revisionId}/compute`).reply(200, revision);

      const csvFile = `cle_interop;id_ban_commune;id_ban_toponyme;id_ban_adresse;voie_nom;lieudit_complement_nom;numero;suffixe;certification_commune;commune_insee;commune_nom;commune_deleguee_insee;commune_deleguee_nom;position;long;lat;x;y;cad_parcelles;source;date_der_maj
      08053_xxxx_00001_bis;${communeUuid};${voieUuid};${numeroUuid};rue de la paix;;1;bis;1;08053;Bazeilles;08294;La Moncelle;entrée;8;42;1114835.92;6113076.85;;ban;2000-01-01`;
      axiosMock
        .onPut(`/revisions/${revisionId}/files/bal`)
        .reply(({ data }) => {
          expect(data.replace(/\s/g, '')).toEqual(csvFile.replace(/\s/g, ''));
          return [200, null];
        });

      const publishedRevision: Revision = {
        _id: revisionId,
        codeCommune: commune,
        status: StatusRevision.PUBLISHED,
        ready: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        current: true,
        validation: {
          valid: true,
        },
      };
      axiosMock.onPost(`/revisions/${revisionId}/publish`).reply(({ data }) => {
        expect(JSON.parse(data).habilitationId).toEqual(habilitationId);
        return [200, publishedRevision];
      });

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const syncExpected = {
        status: StatusSyncEnum.SYNCED,
        isPaused: false,
        lastUploadedRevisionId: revisionId,
      };

      expect(response.body.id).toEqual(balId);
      expect(response.body.commune).toEqual(commune);
      expect(response.body.status).toEqual(StatusBaseLocalEnum.PUBLISHED);
      expect(response.body.sync).toMatchObject(syncExpected);
      expect(response.body.sync.currentUpdated).toBeDefined();
    });

    it('Publish 200 OUTDATED', async () => {
      const commune = '91534';
      const habilitationId = new ObjectId().toHexString();
      // REVSION
      const revisionId = new ObjectId().toHexString();
      const revision: Revision = {
        _id: revisionId,
        codeCommune: commune,
        status: StatusRevision.PENDING,
        ready: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        current: false,
        validation: {
          valid: true,
        },
        files: [
          {
            type: 'bal',
            hash: '',
          },
        ],
      };

      // BAL
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId,
        status: StatusBaseLocalEnum.PUBLISHED,
        emails: ['test@test.fr'],
        sync: {
          status: StatusSyncEnum.OUTDATED,
          lastUploadedRevisionId: revisionId,
        },
      });
      const { banId: communeUuid } = await balRepository.findOneBy({
        id: balId,
      });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const { banId: toponymeUuid } = await voieRepository.findOneBy({
        id: voieId,
      });
      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        suffixe: 'bis',
        positions: [createPositions()],
        certifie: true,
        updatedAt: new Date('2000-01-01'),
      });
      const { banId: numeroUuid } = await numeroRepository.findOneBy({
        id: numeroId,
      });

      // MOCK AXIOS
      axiosMock
        .onGet(`/communes/${commune}/current-revision`)
        .reply(200, revision);

      const habilitation: Habilitation = {
        _id: habilitationId,
        status: StatusHabiliation.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      axiosMock.onPost(`/communes/${commune}/revisions`).reply(200, revision);

      axiosMock.onPost(`/revisions/${revisionId}/compute`).reply(200, revision);

      const csvFile = `cle_interop;id_ban_commune;id_ban_toponyme;id_ban_adresse;voie_nom;lieudit_complement_nom;numero;suffixe;certification_commune;commune_insee;commune_nom;commune_deleguee_insee;commune_deleguee_nom;position;long;lat;x;y;cad_parcelles;source;date_der_maj
      91534_xxxx_00001_bis;${communeUuid};${toponymeUuid};${numeroUuid};rue de la paix;;1;bis;1;91534;Saclay;;;entrée;8;42;1114835.92;6113076.85;;ban;2000-01-01`;
      axiosMock
        .onPut(`/revisions/${revisionId}/files/bal`)
        .reply(({ data }) => {
          expect(data.replace(/\s/g, '')).toEqual(csvFile.replace(/\s/g, ''));
          return [200, null];
        });

      const publishedRevision: Revision = {
        _id: revisionId,
        codeCommune: commune,
        status: StatusRevision.PUBLISHED,
        ready: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        current: true,
        validation: {
          valid: true,
        },
      };
      axiosMock.onPost(`/revisions/${revisionId}/publish`).reply(({ data }) => {
        expect(JSON.parse(data).habilitationId).toEqual(habilitationId);
        return [200, publishedRevision];
      });

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const syncExpected = {
        status: StatusSyncEnum.SYNCED,
        isPaused: false,
        lastUploadedRevisionId: revisionId,
      };

      expect(response.body.id).toEqual(balId);
      expect(response.body.commune).toEqual(commune);
      expect(response.body.status).toEqual(StatusBaseLocalEnum.PUBLISHED);
      expect(response.body.sync).toMatchObject(syncExpected);
      expect(response.body.sync.currentUpdated).toBeDefined();
    });

    it('Publish 200 OUTDATED same hash', async () => {
      const commune = '91534';
      const habilitationId = new ObjectId().toHexString();
      // REVSION
      const revisionId = new ObjectId().toHexString();
      const revision: Revision = {
        _id: revisionId,
        codeCommune: commune,
        status: StatusRevision.PENDING,
        ready: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        current: false,
        validation: {
          valid: true,
        },
        files: [
          {
            type: 'bal',
            hash: '37925d84890a965635aa5f119efade4fb2dc02331039a80c57497a9bb21ea82b',
          },
        ],
      };

      // BAL
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId,
        banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
        status: StatusBaseLocalEnum.PUBLISHED,
        emails: ['test@test.fr'],
        sync: {
          status: StatusSyncEnum.OUTDATED,
          lastUploadedRevisionId: revisionId,
        },
      });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        banId: '26734c2d-2a14-4eeb-ac5b-1be055c0a5ae',
      });
      await createNumero(balId, voieId, {
        numero: 1,
        suffixe: 'bis',
        banId: '2da3bb47-1a10-495a-8c29-6b8d0e79f9af',
        positions: [createPositions()],
        certifie: true,
        updatedAt: new Date('2000-01-01'),
      });

      // MOCK AXIOS
      axiosMock
        .onGet(`/communes/${commune}/current-revision`)
        .reply(200, revision);

      const habilitation: Habilitation = {
        _id: habilitationId,
        status: StatusHabiliation.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);
      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const syncExpected = {
        status: StatusSyncEnum.SYNCED,
        isPaused: false,
        lastUploadedRevisionId: revisionId,
      };

      expect(response.body.id).toEqual(balId);
      expect(response.body.commune).toEqual(commune);
      expect(response.body.status).toEqual(StatusBaseLocalEnum.PUBLISHED);
      expect(response.body.sync).toMatchObject(syncExpected);
      expect(response.body.sync.currentUpdated).toBeDefined();
    });

    it('Publish 412 status DEMO', async () => {
      const commune = '91534';
      const habilitationId = new ObjectId().toHexString();
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId,
        status: StatusBaseLocalEnum.DEMO,
        emails: ['test@test.fr'],
      });

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 412,
          message:
            'La synchronisation pas possibles pour les Bases Adresses Locales de démo',
        }),
      );
    });

    it('Publish 412 no habilitation', async () => {
      const commune = '91534';
      const balId = await createBal({
        nom: 'bal',
        commune,
        status: StatusBaseLocalEnum.DRAFT,
        emails: ['test@test.fr'],
      });

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 412,
          message: 'Aucune habilitation rattachée à cette Base Adresse Locale',
        }),
      );
    });

    it('Publish 412 habilitation PENDING', async () => {
      const commune = '91534';
      const habilitationId = new ObjectId().toHexString();
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId,
        status: StatusBaseLocalEnum.DRAFT,
        emails: ['test@test.fr'],
      });

      // MOCK AXIOS
      const habilitation: Habilitation = {
        _id: habilitationId,
        status: StatusHabiliation.PENDING,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 412,
          message: 'L’habilitation rattachée n’est pas une habilitation valide',
        }),
      );
    });

    it('Publish 412 habilitation expired', async () => {
      const commune = '91534';
      const habilitationId = new ObjectId().toHexString();
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId,
        status: StatusBaseLocalEnum.DRAFT,
        emails: ['test@test.fr'],
      });

      // MOCK AXIOS
      const habilitation: Habilitation = {
        _id: habilitationId,
        status: StatusHabiliation.ACCEPTED,
        expiresAt: sub(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 412,
          message: 'L’habilitation rattachée a expiré',
        }),
      );
    });

    it('Publish 412 no numero', async () => {
      const commune = '91534';
      const habilitationId = new ObjectId().toHexString();
      const balId = await createBal({
        nom: 'bal',
        commune,
        habilitationId,
        status: StatusBaseLocalEnum.DRAFT,
        emails: ['test@test.fr'],
      });

      // MOCK AXIOS
      const habilitation: Habilitation = {
        _id: habilitationId,
        status: StatusHabiliation.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      // SEND REQUEST
      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/sync/exec`)
        .set('authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 412,
          message: 'La base locale ne possède aucune adresse',
        }),
      );
    });
  });
});
