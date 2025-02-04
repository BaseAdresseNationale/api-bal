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
import { Voie } from '@/shared/entities/voie.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import {
  BaseLocale,
  StatusBaseLocalEnum,
} from '@/shared/entities/base_locale.entity';
import { Position, PositionTypeEnum } from '@/shared/entities/position.entity';

import { NumeroModule } from '@/modules/numeros/numero.module';
import { UpdateNumeroDTO } from '@/modules/numeros/dto/update_numero.dto';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

describe('NUMERO', () => {
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
        NumeroModule,
        MailerModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    // INIT MODEL
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

  describe('GET /numero', () => {
    it('Return 200 numero', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const response = await request(app.getHttpServer())
        .get(`/numeros/${numeroId}`)
        .expect(200);
      expect(response.body.id).toEqual(numeroId);
      expect(response.body.balId).toEqual(balId);
      expect(response.body.numero).toEqual(99);
      expect(response.body.voieId).toEqual(voieId);
      expect(response.body.parcelles).toBeNull();
      expect(response.body.positions).toEqual([]);
    });

    it('Return 200 numero without comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        comment: 'coucou',
      });

      const response = await request(app.getHttpServer())
        .get(`/numeros/${numeroId}`)
        .expect(200);
      expect(response.body.comment).toEqual(null);
    });

    it('Return 200 numero with comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        comment: 'coucou',
      });

      const response = await request(app.getHttpServer())
        .get(`/numeros/${numeroId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.comment).toEqual('coucou');
    });

    it('Return 404', async () => {
      const numeroId = new ObjectId();
      await request(app.getHttpServer())
        .get(`/numeros/${numeroId}`)
        .expect(404);
    });
  });

  describe('PUT /numero', () => {
    it('Update 200 numero', async () => {
      const balId = await createBal({ nom: 'bal', commune: '08053' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const updatedNumero: UpdateNumeroDTO = {
        numero: 100,
        communeDeleguee: '08294',
      };

      const response = await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toEqual(numeroId);
      expect(response.body.balId).toEqual(balId);
      expect(response.body.numero).toEqual(100);
      expect(response.body.voieId).toEqual(voieId);
      expect(response.body.parcelles).toBeNull();
      expect(response.body.positions).toEqual([]);
      expect(response.body.communeDeleguee).toEqual('08294');

      const voieDbAfter = await voieRepository.findOneBy({ id: voieId });
      const balDbAfter = await balRepository.findOneBy({ id: balId });
      expect(voieDbAfter.updatedAt.toISOString()).not.toEqual(
        updatedAt.toISOString(),
      );
      expect(balDbAfter.updatedAt.toISOString()).not.toEqual(
        updatedAt.toISOString(),
      );
    });

    it('Update 404 Numero Not Found', async () => {
      const updatedNumero: UpdateNumeroDTO = {
        numero: 100,
      };

      const numeroId = new ObjectId();
      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('Update 404 Voie Not Found', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const updatedNumero: UpdateNumeroDTO = {
        voieId: new ObjectId().toHexString(),
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('Update 404 Toponyme Not Found', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const updatedNumero: UpdateNumeroDTO = {
        toponymeId: new ObjectId().toHexString(),
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('Update 403 Forbiden', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const updatedNumero: UpdateNumeroDTO = {
        numero: 100,
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .expect(403);

      const voieDbAfter = await voieRepository.findOneBy({ id: voieId });
      const balDbAfter = await balRepository.findOneBy({ id: balId });
      expect(voieDbAfter.updatedAt.toISOString()).toEqual(
        updatedAt.toISOString(),
      );
      expect(balDbAfter.updatedAt.toISOString()).toEqual(
        updatedAt.toISOString(),
      );
    });

    it('Update 200 check field updatedAt of voie and bal', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const voieDbBefore = await voieRepository.findOneBy({ id: voieId });
      const balDbBefore = await balRepository.findOneBy({ id: balId });

      const updatedNumero: UpdateNumeroDTO = {
        numero: 100,
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const voieDbAfter = await voieRepository.findOneBy({ id: voieId });
      const balDbAfter = await balRepository.findOneBy({ id: balId });
      expect(voieDbBefore.updatedAt.toISOString()).not.toEqual(
        voieDbAfter.updatedAt.toISOString(),
      );
      expect(balDbBefore.updatedAt.toISOString()).not.toEqual(
        balDbAfter.updatedAt.toISOString(),
      );
    });

    it('Update 200 check field updatedAt is UPDATE', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const updatedNumero: UpdateNumeroDTO = {
        numero: 100,
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const numeroDbAfter = await numeroRepository.findOneBy({ id: numeroId });
      const voieDbAfter = await voieRepository.findOneBy({ id: voieId });
      const balDbAfter = await balRepository.findOneBy({ id: balId });

      expect(numeroDbAfter.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voieDbAfter.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(balDbAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });

    it('Update 200 check field tiles Numero is UPDATE and centroid, centroidTiles voie is UPDATE', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      const voieDbBefore = await voieRepository.findOneBy({ id: voieId });

      const updatedNumero: UpdateNumeroDTO = {
        positions: [
          {
            id: new ObjectId().toHexString(),
            type: PositionTypeEnum.BATIMENT,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [9, 42],
            },
          },
        ],
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const voieDbAfter = await voieRepository.findOneBy({ id: voieId });
      expect(voieDbBefore.centroid).not.toEqual(voieDbAfter.centroid);
    });

    it('Update 200 replace voie', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId1 = await createVoie(balId, { nom: 'rue de la paix' });
      const voieId2 = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId1, {
        numero: 99,
        positions: [
          {
            id: new ObjectId().toHexString(),
            type: PositionTypeEnum.ENTREE,
            source: 'ban',
            point: {
              type: 'Point',
              coordinates: [8, 42],
            },
          },
        ],
      });

      const updatedNumero: UpdateNumeroDTO = {
        voieId: voieId2,
      };

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}`)
        .send(updatedNumero)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      const voie1DbAfter: Voie = await voieRepository.findOneBy({
        id: voieId1,
      });
      const voie2DbAfter: Voie = await voieRepository.findOneBy({
        id: voieId2,
      });
      expect(voie1DbAfter.centroid).toBe(null);
      expect(voie2DbAfter.centroid).not.toBe(null);

      expect(voie1DbAfter.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(voie2DbAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });
  });

  describe('DELETE /numero', () => {
    it('Delete 204 numero', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      await request(app.getHttpServer())
        .delete(`/numeros/${numeroId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const numeroDeleted: Numero = await numeroRepository.findOneBy({
        id: numeroId,
      });

      expect(numeroDeleted).toBe(null);
      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(balAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });

    it('Delete 404 NOT FOUND', async () => {
      const numeroId = new ObjectId();
      await request(app.getHttpServer())
        .delete(`/numeros/${numeroId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('Delete 403 FORBIDEN', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      await request(app.getHttpServer())
        .delete(`/numeros/${numeroId}`)
        .expect(403);

      const numeroDeleted: Numero = await numeroRepository.findOneBy({
        id: numeroId,
      });

      expect(numeroDeleted).not.toBe(null);
      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt.toISOString()).toEqual(
        updatedAt.toISOString(),
      );
      expect(balAfter.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('SOFT DELETE /numero', () => {
    it('Soft Delete 200 numero', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
      });

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}/soft-delete`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const numeroDeleted: Numero = await numeroRepository.findOneBy({
        id: numeroId,
      });
      expect(numeroDeleted).toBeNull();

      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt).not.toEqual(updatedAt.toISOString());
      expect(balAfter.updatedAt).not.toEqual(updatedAt.toISOString());
    });

    it('Soft Delete 404 NOT FOUND', async () => {
      const numeroId = new ObjectId();
      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}/soft-delete`)
        .set('authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('Soft Delete 403 FORBIDEN', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      const numeroId = await createNumero(balId, voieId, {
        numero: 99,
        deletedAt: null,
      });

      await request(app.getHttpServer())
        .put(`/numeros/${numeroId}/soft-delete`)
        .expect(403);

      const numeroDeleted: Numero = await numeroRepository.findOneBy({
        id: numeroId,
      });
      expect(numeroDeleted.deletedAt).toBe(null);
      const voieAfter: Voie = await voieRepository.findOneBy({ id: voieId });
      const balAfter: BaseLocale = await balRepository.findOneBy({ id: balId });
      expect(voieAfter.updatedAt.toISOString()).toEqual(
        updatedAt.toISOString(),
      );
      expect(balAfter.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });
});
