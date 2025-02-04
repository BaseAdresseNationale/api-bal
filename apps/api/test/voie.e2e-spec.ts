import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { ObjectId } from 'mongodb';
import { v4 as uuid } from 'uuid';

import { Numero } from '@/shared/entities/numero.entity';
import { Voie, TypeNumerotationEnum } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import {
  BaseLocale,
  StatusBaseLocalEnum,
} from '@/shared/entities/base_locale.entity';
import { Position, PositionTypeEnum } from '@/shared/entities/position.entity';

import { VoieModule } from '@/modules/voie/voie.module';
import { CreateNumeroDTO } from '@/modules/numeros/dto/create_numero.dto';
import { UpdateVoieDTO } from '@/modules/voie/dto/update_voie.dto';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { Repository } from 'typeorm';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';

describe('VOIE MODULE', () => {
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
        VoieModule,
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

  describe('GET /voies/numeros', () => {
    it('Return 200 numero without comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId1 = await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
      });

      const response = await request(app.getHttpServer())
        .get(`/voies/${voieId}/numeros`)
        .expect(200);
      expect(response.body.length).toEqual(1);
      expect(response.body[0].id).toEqual(numeroId1.toString());
      expect(response.body[0].comment).toEqual(null);
    });

    it('Return 200 numeronot deleted', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
      });

      await createNumero(balId, voieId, {
        numero: 2,
        comment: 'coucou',
        deletedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .get(`/voies/${voieId}/numeros`)
        .expect(200);
      expect(response.body).toHaveLength(1);
    });

    it('Return 200 numero with comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const numeroId1 = await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
      });

      const response = await request(app.getHttpServer())
        .get(`/voies/${voieId}/numeros`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.length).toEqual(1);
      expect(response.body[0].id).toEqual(numeroId1.toString());
      expect(response.body[0].comment).toEqual('coucou');
    });
  });

  describe('POST /voies/numeros', () => {
    it('Create 201 numero', async () => {
      const balId = await createBal({ nom: 'bal', commune: '08053' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const createdNumero: CreateNumeroDTO = {
        numero: 1,
        positions: [
          {
            type: PositionTypeEnum.ENTREE,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [8, 42],
            },
          },
        ],
        communeDeleguee: '08294',
      };

      const response = await request(app.getHttpServer())
        .post(`/voies/${voieId}/numeros`)
        .send(createdNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(201);
      expect(response.body.numero).toEqual(1);
      expect(response.body.balId).toEqual(balId);
      expect(response.body.voieId).toEqual(voieId.toString());
      expect(response.body.parcelles).toEqual([]);
      expect(response.body.positions).not.toBeNull();
      expect(response.body.tiles).not.toBeNull();
      expect(response.body.suffixe).toEqual(null);
      expect(response.body.toponymeId).toEqual(null);
      expect(response.body.comment).toEqual(null);
      expect(response.body.certifie).toEqual(false);
      expect(response.body.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(response.body.createdAt).not.toEqual(createdAt.toISOString());
      expect(response.body.deletedAt).toEqual(null);
      expect(response.body.communeDeleguee).toEqual('08294');

      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt.toISOString()).not.toEqual(
        updatedAt.toISOString(),
      );
      expect(balAfter.updatedAt.toISOString()).not.toEqual(
        updatedAt.toISOString(),
      );
    });

    it('Create 201 numero with meta', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const createdNumero: CreateNumeroDTO = {
        numero: 1,
        suffixe: 'bis',
        parcelles: ['97613000AS0120'],
        comment: 'coucou',
        certifie: true,
        positions: [
          {
            type: PositionTypeEnum.ENTREE,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [8, 42],
            },
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post(`/voies/${voieId}/numeros`)
        .send(createdNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(201);

      expect(response.body.numero).toEqual(1);
      expect(response.body.balId).toEqual(balId.toString());
      expect(response.body.voieId).toEqual(voieId.toString());
      expect(response.body.parcelles).toEqual(['97613000AS0120']);
      expect(response.body.positions).not.toBeNull();
      expect(response.body.tiles).not.toBeNull();
      expect(response.body.suffixe).toEqual('bis');
      expect(response.body.toponymeId).toEqual(null);
      expect(response.body.comment).toEqual('coucou');
      expect(response.body.certifie).toEqual(true);
      expect(response.body.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(response.body.createdAt).not.toEqual(createdAt.toISOString());
      expect(response.body.deletedAt).toEqual(null);

      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt.toISOString()).not.toEqual(
        updatedAt.toISOString(),
      );
      expect(balAfter.updatedAt.toISOString()).not.toEqual(
        updatedAt.toISOString(),
      );
    });

    it('Create 404 voie is deleted', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: new Date(),
      });
      const createdNumero: CreateNumeroDTO = {
        numero: 1,
        positions: [
          {
            type: PositionTypeEnum.ENTREE,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [8, 42],
            },
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post(`/voies/${voieId}/numeros`)
        .send(createdNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 404,
          message: 'Voie is archived',
        }),
      );

      const voieAfter: Voie = await voieRepository.findOne({
        where: { id: voieId },
        withDeleted: true,
      });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt.toISOString()).toEqual(
        updatedAt.toISOString(),
      );
      expect(balAfter.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });

    it('Create 404 toponyme not exist', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const createdNumero: CreateNumeroDTO = {
        numero: 1,
        toponymeId: new ObjectId().toHexString(),
        positions: [
          {
            type: PositionTypeEnum.ENTREE,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [8, 42],
            },
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post(`/voies/${voieId}/numeros`)
        .send(createdNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(404);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 404,
          message: 'Toponyme not found',
        }),
      );

      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt.toISOString()).toEqual(
        updatedAt.toISOString(),
      );
      expect(balAfter.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });

    it('Create 404 bad payload', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const createdNumero: CreateNumeroDTO = {
        numero: 1,
      };

      const response = await request(app.getHttpServer())
        .post(`/voies/${voieId}/numeros`)
        .send(createdNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.text).toEqual(
        JSON.stringify({
          message: ['positions should not be empty'],
          error: 'Bad Request',
          statusCode: 400,
        }),
      );
    });

    it('Create 404 bad payload', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const createdNumero: CreateNumeroDTO = {
        positions: [
          {
            type: PositionTypeEnum.ENTREE,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [8, 42],
            },
          },
        ],
      };

      const response = await request(app.getHttpServer())
        .post(`/voies/${voieId}/numeros`)
        .send(createdNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.text).toEqual(
        JSON.stringify({
          message: ["Le champ numero : undefined n'est pas valide"],
          error: 'Bad Request',
          statusCode: 400,
        }),
      );
    });
  });

  describe('PUT /voies/:voieId/convert-to-toponyme', () => {
    it('Return 200 numero without comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      await request(app.getHttpServer())
        .put(`/voies/${voieId}/convert-to-toponyme`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const toponyme: Toponyme = await toponymeRepository.findOneBy({
        nom: 'rue de la paix',
      });
      expect(toponyme).toBeDefined();
    });

    it('Return 200 numero without comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de paris' });
      await createNumero(balId, voieId, {
        numero: 1,
      });

      const response = await request(app.getHttpServer())
        .put(`/voies/${voieId}/convert-to-toponyme`)
        .set('authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.text).toEqual(
        JSON.stringify({
          statusCode: 400,
          message: `Voie ${voieId} has numero(s)`,
        }),
      );

      const toponyme: Toponyme = await toponymeRepository.findOneBy({
        nom: 'rue de paris',
      });
      expect(toponyme).toBeNull();
    });
  });

  describe('GET /voies', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const response = await request(app.getHttpServer())
        .get(`/voies/${voieId}`)
        .expect(200);
      expect(response.body.id).toEqual(voieId);
      expect(response.body.balId).toEqual(balId);
      expect(response.body.nom).toEqual('rue de la paix');
    });

    it('Return 404', async () => {
      await request(app.getHttpServer())
        .get(`/voies/${new ObjectId()}`)
        .expect(404);
    });
  });

  describe('PUT /voies', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const changes: UpdateVoieDTO = {
        nom: 'coucou',
        nomAlt: null,
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
        trace: {
          type: 'LineString',
          coordinates: [
            [48, 2],
            [49, 1],
          ],
        },
      };

      const response = await request(app.getHttpServer())
        .put(`/voies/${voieId}`)
        .send(changes)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.id).toEqual(voieId);
      expect(response.body.balId).toEqual(balId);
      expect(response.body.nom).toEqual('coucou');
      expect(response.body.typeNumerotation).toEqual(
        TypeNumerotationEnum.NUMERIQUE,
      );
      expect(response.body.trace).toEqual(changes.trace);

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 200 trace empty', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const changes: UpdateVoieDTO = {
        nom: 'coucou',
        nomAlt: null,
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
        trace: null,
      };

      const response = await request(app.getHttpServer())
        .put(`/voies/${voieId}`)
        .send(changes)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.id).toEqual(voieId.toString());
      expect(response.body.balId).toEqual(balId.toString());
      expect(response.body.nom).toEqual('coucou');
      expect(response.body.typeNumerotation).toEqual(
        TypeNumerotationEnum.NUMERIQUE,
      );
      expect(response.body.trace).toEqual(null);

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        trace: null,
      });
      const changes: UpdateVoieDTO = {
        nom: 'coucou',
        nomAlt: null,
        typeNumerotation: TypeNumerotationEnum.NUMERIQUE,
        trace: {
          type: 'LineString',
          coordinates: [
            [48, 2],
            [49, 1],
          ],
        },
      };

      await request(app.getHttpServer())
        .put(`/voies/${voieId}`)
        .send(changes)
        .expect(403);

      const voie = await voieRepository.findOneBy({ id: voieId });
      expect(voie.nom).toEqual('rue de la paix');
      expect(voie.trace).toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('PUT /soft-delete', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: null,
      });
      await request(app.getHttpServer())
        .put(`/voies/${voieId}/soft-delete`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: null,
      });
      await request(app.getHttpServer())
        .put(`/voies/${voieId}/soft-delete`)
        .expect(403);

      const voie = await voieRepository.findOneBy({ id: voieId });
      expect(voie.deletedAt).toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('PUT /restore', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: updatedAt,
      });
      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        deletedAt: updatedAt,
      });
      const response = await request(app.getHttpServer())
        .put(`/voies/${voieId}/restore`)
        .send({ numerosIds: [numeroId] })
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.deletedAt).toBeNull();

      const numero = await numeroRepository.findOneBy({ id: numeroId });

      expect(numero.deletedAt).toEqual(null);

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: updatedAt,
      });
      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        deletedAt: updatedAt,
      });
      await request(app.getHttpServer())
        .put(`/voies/${voieId}/restore`)
        .send({ numeroIds: [numeroId] })
        .expect(403);

      const voie = await voieRepository.findOne({
        where: { id: voieId },
        withDeleted: true,
      });
      expect(voie.deletedAt).not.toBeNull();

      const numero = await numeroRepository.findOne({
        where: { id: numeroId },
        withDeleted: true,
      });

      expect(numero.deletedAt).not.toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('DELETE /voies', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: updatedAt,
      });
      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        deletedAt: updatedAt,
      });
      await request(app.getHttpServer())
        .delete(`/voies/${voieId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const voie = await voieRepository.findOneBy({ id: voieId });
      expect(voie).toBeNull();

      const numero = await numeroRepository.findOneBy({ id: numeroId });
      expect(numero).toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, {
        nom: 'rue de la paix',
        deletedAt: updatedAt,
      });
      const numeroId = await createNumero(balId, voieId, {
        numero: 1,
        deletedAt: updatedAt,
      });

      await request(app.getHttpServer())
        .put(`/voies/${voieId}/restore`)
        .send({ numeroIds: [numeroId] })
        .expect(403);

      const voie = await voieRepository.findOne({
        where: { id: voieId },
        withDeleted: true,
      });
      expect(voie).not.toBeNull();

      const numero = await numeroRepository.findOne({
        where: { id: numeroId },
        withDeleted: true,
      });
      expect(numero).not.toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });
});
