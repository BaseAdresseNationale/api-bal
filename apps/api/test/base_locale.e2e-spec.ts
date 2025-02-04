import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { v4 as uuid } from 'uuid';
import { ObjectId } from 'mongodb';

import { Numero } from '@/shared/entities/numero.entity';
import { Voie, TypeNumerotationEnum } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import {
  BaseLocale,
  StatusBaseLocalEnum,
} from '@/shared/entities/base_locale.entity';
import { Position, PositionTypeEnum } from '@/shared/entities/position.entity';

import { BaseLocaleModule } from '@/modules/base_locale/base_locale.module';
import { UpdateBatchNumeroDTO } from '@/modules/numeros/dto/update_batch_numero.dto';
import { DeleteBatchNumeroDTO } from '@/modules/numeros/dto/delete_batch_numero.dto';
import { CreateVoieDTO } from '@/modules/voie/dto/create_voie.dto';
import { CreateToponymeDTO } from '@/modules/toponyme/dto/create_toponyme.dto';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Point, Repository } from 'typeorm';

const BAN_API_URL = 'BAN_API_URL';
process.env.BAN_API_URL = BAN_API_URL;

const baseLocaleAdminProperties = ['token', 'emails'];
const baseLocalePublicProperties = [
  'id',
  'banId',
  'nom',
  'communeNomsAlt',
  'commune',
  'nbNumeros',
  'nbNumerosCertifies',
  'isAllCertified',
  'status',
  'updatedAt',
  'createdAt',
  'deletedAt',
  'habilitationId',
  'sync',
];

describe('BASE LOCAL MODULE', () => {
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

  async function createToponyme(balId: string, props: Partial<Toponyme> = {}) {
    const payload: Partial<Toponyme> = {
      balId,
      banId: uuid(),
      createdAt,
      updatedAt,
      ...props,
    };
    const entityToInsert = toponymeRepository.create(payload);
    const result = await toponymeRepository.save(entityToInsert);
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

  describe('PUT /bases-locales/numeros/batch', () => {
    it('Batch 200 numeros change voie', async () => {
      const balId = await createBal({ nom: 'bal', commune: '08053' });
      const voieId1 = await createVoie(balId, { nom: 'rue de la paix' });
      const toponymeId1 = await createToponyme(balId, {
        nom: 'allée',
      });
      const toponymeId2 = await createToponyme(balId, {
        nom: 'allée',
      });
      const voieId2 = await createVoie(balId, { nom: 'rue de la paix' });
      const voieId3 = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId1 = await createNumero(balId, voieId1, {
        numero: 99,
        toponymeId: toponymeId1,
        positions: [createPositions()],
        communeDeleguee: '08294',
      });
      const numeroId2 = await createNumero(balId, voieId2, {
        numero: 99,
        toponymeId: toponymeId2,
        positions: [createPositions()],
        communeDeleguee: '08294',
      });
      const updateBtach: UpdateBatchNumeroDTO = {
        numerosIds: [numeroId1, numeroId2],
        changes: {
          voieId: voieId3,
          toponymeId: toponymeId2,
          positionType: PositionTypeEnum.DELIVRANCE_POSTALE,
          certifie: true,
          comment: 'coucou',
          communeDeleguee: '08053',
        },
      };
      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.modifiedCount).toEqual(2);
      expect(response.body.changes).toEqual({
        voieId: voieId3.toString(),
        toponymeId: toponymeId2.toString(),
        positionType: PositionTypeEnum.DELIVRANCE_POSTALE,
        certifie: true,
        comment: 'coucou',
        communeDeleguee: '08053',
      });

      const numero1After: Numero = await numeroRepository.findOneBy({
        id: numeroId1,
      });
      expect(numero1After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(numero1After.voieId).toEqual(voieId3);
      expect(numero1After.positions[0].type).toEqual(
        PositionTypeEnum.DELIVRANCE_POSTALE,
      );
      expect(numero1After.certifie).toBeTruthy();
      expect(numero1After.comment).toEqual('coucou');
      expect(numero1After.communeDeleguee).toEqual('08053');

      const numero2After: Numero = await numeroRepository.findOneBy({
        id: numeroId2,
      });
      expect(numero2After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(numero2After.voieId).toEqual(voieId3);
      expect(numero2After.positions[0].type).toEqual(
        PositionTypeEnum.DELIVRANCE_POSTALE,
      );
      expect(numero2After.certifie).toBeTruthy();
      expect(numero2After.comment).toEqual('coucou');
      expect(numero2After.communeDeleguee).toEqual('08053');

      const voie1After: Voie = await voieRepository.findOneBy({ id: voieId1 });
      expect(voie1After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie1After.centroid).toBeNull();

      const voie2After: Voie = await voieRepository.findOneBy({ id: voieId2 });
      expect(voie2After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie2After.centroid).toBeNull();

      const voie3After: Voie = await voieRepository.findOneBy({ id: voieId3 });
      expect(voie3After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie3After.centroid).not.toBeNull();

      const toponymeAfter1: Toponyme = await toponymeRepository.findOneBy({
        id: toponymeId1,
      });
      expect(toponymeAfter1.updatedAt).not.toEqual(updatedAt.toISOString());

      const toponymeAfter2: Toponyme = await toponymeRepository.findOneBy({
        id: toponymeId2,
      });
      expect(toponymeAfter2.updatedAt).not.toEqual(updatedAt.toISOString());

      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(balAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });

    it('PUT /bases-locales/numeros/certify-all', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        positions: [createPositions()],
        certifie: false,
      });

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/certify-all`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const numeroAfter: Numero = await numeroRepository.findOneBy({
        id: numeroId,
      });
      expect(numeroAfter.certifie).toBeTruthy();
    });

    it('Batch 400 without changes', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        positions: [createPositions()],
      });
      const updateBtach: UpdateBatchNumeroDTO = {
        numerosIds: [numeroId],
        changes: {},
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('Batch 404 numeros: Bad voie', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        positions: [createPositions()],
      });
      const updateBtach: UpdateBatchNumeroDTO = {
        numerosIds: [numeroId],
        changes: {
          voieId: new ObjectId().toHexString(),
        },
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('Batch 404 numeros: Bad toponyme', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        positions: [createPositions()],
      });
      const updateBtach: UpdateBatchNumeroDTO = {
        numerosIds: [numeroId],
        changes: {
          toponymeId: new ObjectId().toHexString(),
        },
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PUT /bases-locales/numeros/batch/soft-delete', () => {
    it('Soft Delete 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId1 = await createVoie(balId, { nom: 'rue de la paix' });
      const toponymeId1 = await createToponyme(balId, {
        nom: 'allée',
      });
      const toponymeId2 = await createToponyme(balId, {
        nom: 'allée',
      });
      const voieId2 = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId1 = await createNumero(balId, voieId1, {
        numero: 99,
        positions: [createPositions()],
        toponymeId: toponymeId1,
      });
      const numeroId2 = await createNumero(balId, voieId2, {
        numero: 99,
        positions: [createPositions()],
        toponymeId: toponymeId2,
      });
      const deleteBtach: DeleteBatchNumeroDTO = {
        numerosIds: [numeroId1, numeroId2],
      };
      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch/soft-delete`)
        .send(deleteBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(204);
      const numero1After: Numero = await numeroRepository.findOne({
        where: { id: numeroId1 },
        withDeleted: true,
      });
      expect(numero1After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(numero1After.deletedAt).toBeDefined();
      const numero2After: Numero = await numeroRepository.findOne({
        where: { id: numeroId2 },
        withDeleted: true,
      });
      expect(numero2After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(numero2After.deletedAt).toBeDefined();
      const voie1After: Voie = await voieRepository.findOneBy({ id: voieId1 });
      expect(voie1After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie1After.centroid).toBeNull();
      const voie2After: Voie = await voieRepository.findOneBy({ id: voieId2 });
      expect(voie2After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie2After.centroid).toBeNull();
      const toponymeAfter1: Toponyme = await toponymeRepository.findOneBy({
        id: toponymeId1,
      });
      expect(toponymeAfter1.updatedAt).not.toEqual(updatedAt.toISOString());
      const toponymeAfter2: Toponyme = await toponymeRepository.findOneBy({
        id: toponymeId2,
      });
      expect(toponymeAfter2.updatedAt).not.toEqual(updatedAt.toISOString());
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(balAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });

    it('Soft Delete 400: Bad request', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const deleteBtach: DeleteBatchNumeroDTO = {
        numerosIds: [],
      };
      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch/soft-delete`)
        .send(deleteBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('DELETE /bases-locales/numeros/batch', () => {
    it('Delete 204', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId1 = await createVoie(balId, { nom: 'rue de la paix' });
      const toponymeId1 = await createToponyme(balId, {
        nom: 'allée',
      });
      const toponymeId2 = await createToponyme(balId, {
        nom: 'allée',
      });
      const voieId2 = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId1 = await createNumero(balId, voieId1, {
        numero: 99,
        positions: [createPositions()],
        toponymeId: toponymeId1,
      });
      const numeroId2 = await createNumero(balId, voieId2, {
        numero: 99,
        positions: [createPositions()],
        toponymeId: toponymeId2,
      });

      const deleteBtach: DeleteBatchNumeroDTO = {
        numerosIds: [numeroId1, numeroId2],
      };

      await request(app.getHttpServer())
        .delete(`/bases-locales/${balId}/numeros/batch/`)
        .send(deleteBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const numero1After: Numero = await numeroRepository.findOneBy({
        id: numeroId1,
      });
      expect(numero1After).toBeNull();

      const numero2After: Numero = await numeroRepository.findOneBy({
        id: numeroId2,
      });
      expect(numero2After).toBeNull();

      const voie1After: Voie = await voieRepository.findOneBy({ id: voieId1 });
      expect(voie1After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie1After.centroid).toBeNull();

      const voie2After: Voie = await voieRepository.findOneBy({ id: voieId2 });
      expect(voie2After.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie2After.centroid).toBeNull();

      const toponymeAfter1: Toponyme = await toponymeRepository.findOneBy({
        id: toponymeId1,
      });
      expect(toponymeAfter1.updatedAt).not.toEqual(updatedAt.toISOString());

      const toponymeAfter2: Toponyme = await toponymeRepository.findOneBy({
        id: toponymeId2,
      });
      expect(toponymeAfter2.updatedAt).not.toEqual(updatedAt.toISOString());

      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(balAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });

    it('Delete 400: Bad request', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const deleteBtach: DeleteBatchNumeroDTO = {
        numerosIds: [],
      };

      await request(app.getHttpServer())
        .delete(`/bases-locales/${balId}/numeros/batch`)
        .send(deleteBtach)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });
  });

  describe('GET /bases-locales/csv', () => {
    it('GET CSV 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '08053' });
      const { banId: communeUuid } = await balRepository.findOneBy({
        id: balId,
      });
      const voieId1 = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const { banId: voieUuid1 } = await voieRepository.findOneBy({
        id: voieId1,
      });
      const voieId2 = await createVoie(balId, {
        nom: 'rue de paris',
      });
      const { banId: voieUuid2 } = await voieRepository.findOneBy({
        id: voieId2,
      });
      const toponymeId1 = await createToponyme(balId, {
        nom: 'allée',
        communeDeleguee: '08294',
      });
      const { banId: toponymeUuid1 } = await toponymeRepository.findOneBy({
        id: toponymeId1,
      });
      const numeroId1 = await createNumero(balId, voieId1, {
        numero: 1,
        suffixe: 'bis',
        positions: [createPositions()],
        toponymeId: toponymeId1,
        certifie: true,
        communeDeleguee: '08053',
      });
      const { banId: numeroUuid1 } = await numeroRepository.findOneBy({
        id: numeroId1,
      });
      const numeroId2 = await createNumero(balId, voieId2, {
        numero: 1,
        suffixe: 'ter',
        positions: [createPositions()],
        toponymeId: toponymeId1,
        certifie: false,
        communeDeleguee: '08294',
      });
      const { banId: numeroUuid2 } = await numeroRepository.findOneBy({
        id: numeroId2,
      });
      const deleteBtach: DeleteBatchNumeroDTO = {
        numerosIds: [numeroId1, numeroId2],
      };
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/csv`)
        .send(deleteBtach)
        .set('token', token)
        .expect(200);
      expect(response.headers['content-disposition']).toEqual(
        'attachment; filename="bal.csv"',
      );
      expect(response.headers['content-type']).toEqual(
        'text/csv; charset=utf-8',
      );
      const csvFile = `cle_interop;id_ban_commune;id_ban_toponyme;id_ban_adresse;voie_nom;lieudit_complement_nom;numero;suffixe;certification_commune;commune_insee;commune_nom;commune_deleguee_insee;commune_deleguee_nom;position;long;lat;x;y;cad_parcelles;source;date_der_maj
    08053_xxxx_00001_bis;${communeUuid};${voieUuid1};${numeroUuid1};rue de la paix;allée;1;bis;1;08053;Bazeilles;08053;Bazeilles;entrée;8;42;1114835.92;6113076.85;;ban;2000-01-02
    08053_xxxx_00001_ter;${communeUuid};${voieUuid2};${numeroUuid2};rue de paris;allée;1;ter;0;08053;Bazeilles;08294;La Moncelle;entrée;8;42;1114835.92;6113076.85;;ban;2000-01-02
    08053_xxxx_99999;${communeUuid};${toponymeUuid1};;allée;;99999;;;08053;Bazeilles;08294;La Moncelle;;;;;;;commune;2000-01-02`;
      expect(response.text.replace(/\s/g, '')).toEqual(
        csvFile.replace(/\s/g, ''),
      );
    });
  });

  describe('GET /bases-locales/${balId}/voies/csv', () => {
    it('GET 200 CSV', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91534' });
      const voieId1 = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const voieId2 = await createVoie(balId, {
        nom: 'rue de paris',
      });
      const numeroId1 = await createNumero(balId, voieId1, {
        numero: 1,
        suffixe: 'bis',
        positions: [createPositions()],
        certifie: true,
        updatedAt: new Date('2000-01-01'),
      });
      const numeroId2 = await createNumero(balId, voieId2, {
        numero: 1,
        suffixe: 'ter',
        positions: [createPositions()],
        certifie: false,
        updatedAt: new Date('2000-01-01'),
      });
      const deleteBtach: DeleteBatchNumeroDTO = {
        numerosIds: [numeroId1, numeroId2],
      };
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/voies/csv`)
        .send(deleteBtach)
        .set('token', token)
        .expect(200);
      expect(response.headers['content-disposition']).toEqual(
        'attachment; filename="liste-des-voies.csv"',
      );
      expect(response.headers['content-type']).toEqual(
        'text/csv; charset=utf-8',
      );
      const csvFile = `type;nom;nombre_de_numeros;numeros
    voie;rue de la paix;1;1bis
    voie;rue de paris;1;1ter`;
      expect(response.text.replace(/\s/g, '')).toEqual(
        csvFile.replace(/\s/g, ''),
      );
    });
  });

  describe('GET /bases-locales/search', () => {
    it('Search 200', async () => {
      const balId1 = await createBal({
        nom: 'bal',
        token: 'coucou',
        emails: ['living@data.com'],
        commune: '55326',
      });

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/search?commune=55326&email=living@data.com`)
        .expect(200);

      const results = {
        id: balId1.toString(),
        nom: 'bal',
        commune: '55326',
        nbNumeros: 0,
        nbNumerosCertifies: 0,
        isAllCertified: false,
        status: StatusBaseLocalEnum.DRAFT,
        sync: null,
        habilitationId: null,
        createdAt: createdAt.toISOString(),
        updatedAt: updatedAt.toISOString(),
        deletedAt: null,
      };

      expect(response.body.count).toEqual(1);
      expect(response.body.offset).toEqual(0);
      expect(response.body.limit).toEqual(20);
      expect(response.body.results).toMatchObject([results]);
    });
  });

  describe('POST /bases-locales', () => {
    it('Create 200', async () => {
      const createBALDTO = {
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      };

      const resBan = {
        response: [
          {
            id: uuid(),
          },
        ],
      };

      axiosMock
        .onGet(`${BAN_API_URL}/api/district/cog/27115`)
        .reply(200, resBan);

      const response = await request(app.getHttpServer())
        .post(`/bases-locales`)
        .send(createBALDTO)
        .expect(200);

      expect(response.body).toMatchObject({
        nom: 'foo',
        emails: ['me@domain.co'],
        status: 'draft',
        commune: '27115',
        deletedAt: null,
      });
    });

    it('Create a BaseLocale with invalid payload 400', async () => {
      const createBALDTO = {};
      const response = await request(app.getHttpServer())
        .post(`/bases-locales`)
        .send(createBALDTO)
        .expect(400);

      expect(response.body).toEqual({
        error: 'Bad Request',
        message: [
          'nom should not be empty',
          'each value in emails must be an email',
          'emails should not be empty',
          "Le champ commune : undefined n'est pas valide",
        ],
        statusCode: 400,
      });
    });

    it('Create a BaseLocale with invalid commune 400', async () => {
      const createBALDTO = {
        nom: 'foo',
        emails: ['me@domain.co'],
        commune: '00000',
      };
      const response = await request(app.getHttpServer())
        .post(`/bases-locales`)
        .send(createBALDTO)
        .expect(400);

      expect(response.body).toEqual({
        error: 'Bad Request',
        message: ["Le champ commune : 00000 n'est pas valide"],
        statusCode: 400,
      });
    });
  });

  describe('GET /bases-locales/:id', () => {
    it('Get 200 with admin token', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        Object.keys(response.body).sort((a, b) => a.localeCompare(b)),
      ).toEqual(
        [...baseLocaleAdminProperties, ...baseLocalePublicProperties].sort(
          (a, b) => a.localeCompare(b),
        ),
      );
    });
    it('Get 200 without admin token', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}`)
        .expect(200);
      expect(
        Object.keys(response.body).sort((a, b) => a.localeCompare(b)),
      ).toEqual(baseLocalePublicProperties.sort((a, b) => a.localeCompare(b)));
    });
    it('Get 404 with invalid ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/5f7b3b7b5d6e4a0017d0d0d0`)
        .expect(404);
      expect(response.body).toEqual({
        message: 'BaseLocale 5f7b3b7b5d6e4a0017d0d0d0 not found',
        statusCode: 404,
      });
    });
    it('Count numeros & certified numeros', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });
      const voidId = await createVoie(balId, {
        nom: 'rue',
      });
      await createNumero(balId, voidId, {
        numero: 1,
        certifie: true,
      });
      await createNumero(balId, voidId, {
        numero: 2,
        certifie: false,
      });
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}`)
        .expect(200);
      expect(response.body.nbNumeros).toEqual(2);
      expect(response.body.nbNumerosCertifies).toEqual(1);
      expect(response.body.isAllCertified).toEqual(false);
    });
    it('Count numeros & certified numeros / all certified', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });
      const voidId = await createVoie(balId, {
        nom: 'rue',
      });
      await createNumero(balId, voidId, {
        numero: 1,
        certifie: true,
      });
      await createNumero(balId, voidId, {
        numero: 2,
        certifie: true,
      });
      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}`)
        .expect(200);
      expect(response.body.nbNumeros).toEqual(2);
      expect(response.body.nbNumerosCertifies).toEqual(2);
      expect(response.body.isAllCertified).toEqual(true);
    });
  });

  describe('PUT /bases-locales/:id', () => {
    it('Update 200 with admin token', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const updateBALDTO = {
        nom: 'bar',
        commune: '27115',
        emails: ['me@domain.co', 'metoo@domain.co'],
      };

      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}`)
        .set('authorization', `Bearer ${token}`)
        .send(updateBALDTO)
        .expect(200);

      expect(response.body.nom).toEqual('bar');
      expect(response.body.emails).toEqual(['me@domain.co', 'metoo@domain.co']);
    });

    it('Update 403 without admin token', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const updateBALDTO = {
        nom: 'bar',
        commune: '27115',
        emails: ['me@domain.co', 'metoo@domain.co'],
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}`)
        .send(updateBALDTO)
        .expect(403);
    });

    it('Update 400 invalid payload', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const updateBALDTO = {
        nom: '',
        emails: [],
      };

      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}`)
        .set('authorization', `Bearer ${token}`)
        .send(updateBALDTO)
        .expect(400);

      expect(response.body).toEqual({
        error: 'Bad Request',
        message: ['nom should not be empty', 'emails should not be empty'],
        statusCode: 400,
      });
    });

    it('Update 412 modify a demo base locale', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
        status: StatusBaseLocalEnum.DEMO,
      });

      const updateBALDTO = {
        status: StatusBaseLocalEnum.PUBLISHED,
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}`)
        .set('authorization', `Bearer ${token}`)
        .send(updateBALDTO)
        .expect(412);
    });
  });

  describe('PUT /bases-locales/:id/transform-to-draft', () => {
    it('Transform to draft 200', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: [],
        status: StatusBaseLocalEnum.DEMO,
      });

      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/transform-to-draft`)
        .set('authorization', `Bearer ${token}`)
        .send({ nom: 'bar', email: 'me@mail.co' })
        .expect(200);

      expect(response.body).toMatchObject({
        nom: 'bar',
        emails: ['me@mail.co'],
        status: 'draft',
      });
    });

    it('Transform to draft 412', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
        status: StatusBaseLocalEnum.DRAFT,
      });

      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/transform-to-draft`)
        .set('authorization', `Bearer ${token}`)
        .send({ nom: 'bar', email: 'me@mail.co' })
        .expect(412);

      expect(response.body).toEqual({
        message:
          'La Base Adresse Locale n’est pas une Base Adresse Locale de démonstration.',
        statusCode: 412,
      });
    });
  });

  describe('DELETE /bases-locales/:id', () => {
    it('Delete demo BAL with admin token (hard delete) 204', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
        status: StatusBaseLocalEnum.DEMO,
      });

      await request(app.getHttpServer())
        .delete(`/bases-locales/${balId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const baseLocale = await balRepository.findOneBy({ id: balId });

      expect(baseLocale).toBeNull();
    });

    it('Delete BAL without admin token 403', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      await request(app.getHttpServer())
        .delete(`/bases-locales/${balId}`)
        .expect(403);
    });
  });

  describe('GET /bases-locales/:id/:token/recovery', () => {
    it('Restore deleted BAL', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
        deletedAt: new Date(),
      });

      await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/${token}/recovery`)
        .expect(307);

      const baseLocale = await balRepository.findOneBy({ id: balId });

      expect(baseLocale.deletedAt).toBeNull();
    });

    it('Restore deleted BAL / invalid token', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
        deletedAt: new Date(),
      });

      await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/blabla/recovery`)
        .expect(403);
    });
  });

  describe('POST /bases-locales/recovery', () => {
    it('Renew token / dele', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
        deletedAt: new Date(),
      });

      const body = {
        id: balId,
        email: 'me@domain.co',
      };

      await request(app.getHttpServer())
        .post(`/bases-locales/recovery`)
        .send(body)
        .expect(204);
    });

    it('Renew token / invalid balId', async () => {
      const body = {
        id: '42',
        email: 'me@domain.co',
      };

      await request(app.getHttpServer())
        .post(`/bases-locales/recovery`)
        .send(body)
        .expect(400);
    });
  });

  describe('GET /bases-locales/:id/parcelles', () => {
    it('GET all assigned parcelles', async () => {
      const balId = await createBal({
        nom: 'bal',
        commune: '27115',
        emails: ['me@domain.co'],
        deletedAt: new Date(),
      });
      const voieId = await createVoie(balId, { nom: 'rue de hou' });
      await createNumero(balId, voieId, {
        numero: 1,
        parcelles: ['12345000AA0002'],
      });

      await createToponyme(balId, {
        nom: 'lieu dit',
        parcelles: ['12345000AA0002', '12345000AA0005'],
      });

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/parcelles`)
        .expect(200);

      expect(response.body).toEqual(['12345000AA0002', '12345000AA0005']);
    });
  });

  describe('GET /:baseLocaleId/voies', () => {
    it('GET default not deleted', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });

      createNumero(balId, voieId, {
        numero: 1,
      });

      createNumero(balId, voieId, {
        numero: 1,
        certifie: true,
      });

      createNumero(balId, voieId, {
        numero: 1,
        deletedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/voies`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toEqual(voieId);
      expect(response.body[0].nbNumeros).toEqual(2);
      expect(response.body[0].nbNumerosCertifies).toEqual(1);
      expect(response.body[0].isAllCertified).toBeFalsy();
      expect(response.body[0].commentedNumeros).toBeNull();
    });
  });

  describe('POST /:baseLocaleId/voies', () => {
    it('POST 201', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const voie: CreateVoieDTO = {
        nom: 'rue de la paix',
        nomAlt: null,
        trace: null,
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
      };

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/voies`)
        .set('authorization', `Bearer ${token}`)
        .send(voie)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.nom).toEqual('rue de la paix');
      expect(response.body.nomAlt).toBeNull();
      expect(response.body.trace).toBeNull();
      expect(response.body.typeNumerotation).toEqual(
        TypeNumerotationEnum.NUMERIQUE,
      );
      expect(response.body.centroid).toBeNull();
      expect(response.body.deletedAt).toBeNull();
      expect(response.body.updatedAt).toBeDefined();
      expect(response.body.createdAt).toBeDefined();
    });

    it('POST 403', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const voie: CreateVoieDTO = {
        nom: 'rue de la paix',
        nomAlt: null,
        trace: null,
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
      };

      await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/voies`)
        .send(voie)
        .expect(403);
    });
  });

  describe('GET /:baseLocaleId/toponymes', () => {
    it('GET default not deleted', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });

      await createToponyme(balId, {
        nom: 'rue de paris',
        deletedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/toponymes`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toEqual(toponymeId.toString());
    });
  });

  describe('POST /:baseLocaleId/toponymes', () => {
    it('POST 201', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const toponyme: CreateToponymeDTO = {
        nom: 'rue de la paix',
        nomAlt: null,
      };

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/toponymes`)
        .set('authorization', `Bearer ${token}`)
        .send(toponyme)
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.nom).toEqual('rue de la paix');
      expect(response.body.nomAlt).toBeNull();
      expect(response.body.positions).toEqual([]);
      expect(response.body.positions).toEqual([]);
    });

    it('POST 403', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });

      const toponyme: CreateToponymeDTO = {
        nom: 'rue de la paix',
        nomAlt: null,
      };

      await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/toponymes`)
        .send(toponyme)
        .expect(403);
    });
  });

  describe('GET /:baseLocaleId/all/deleted', () => {
    it('GET 200 voie deleted', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: new Date(),
      });
      await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
        deletedAt: new Date(),
      });
      await createToponyme(balId, {
        nom: 'rue de la paix',
      });

      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        deletedAt: new Date(),
      });

      await createNumero(balId, voieId, {
        numero: 1,
      });

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/all/deleted`)
        .expect(200);

      expect(response.body.toponymes).toHaveLength(1);
      expect(response.body.toponymes[0].id).toEqual(toponymeId);
      expect(response.body.voies).toHaveLength(1);
      expect(response.body.voies[0].id).toEqual(voieId.toString());
      expect(response.body.voies[0].numeros).toHaveLength(1);
      expect(response.body.voies[0].numeros[0].id).toEqual(numeroId);
    });

    it('GET 200 voie not deleted', async () => {
      const balId = await createBal({
        nom: 'foo',
        commune: '27115',
        emails: ['me@domain.co'],
      });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
        deletedAt: new Date(),
      });
      await createToponyme(balId, {
        nom: 'rue de la paix',
      });

      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        deletedAt: new Date(),
      });

      await createNumero(balId, voieId, {
        numero: 1,
      });

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/all/deleted`)
        .expect(200);

      expect(response.body.toponymes).toHaveLength(1);
      expect(response.body.toponymes[0].id).toEqual(toponymeId);
      expect(response.body.voies).toHaveLength(1);
      expect(response.body.voies[0].id).toEqual(voieId.toString());
      expect(response.body.voies[0].numeros).toHaveLength(1);
      expect(response.body.voies[0].numeros[0].id).toEqual(numeroId);
    });
  });
});
