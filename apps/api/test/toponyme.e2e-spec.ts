import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { Point, Repository } from 'typeorm';
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

import { ToponymeModule } from '@/modules/toponyme/toponyme.module';
import { UpdateToponymeDTO } from '@/modules/toponyme/dto/update_toponyme.dto';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';

describe('TOPONYME MODULE', () => {
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
        ToponymeModule,
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

  describe('GET /toponymes/numeros', () => {
    it('Return 200 numero without comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, { nom: 'allée' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
        toponymeId,
      });
      await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
        toponymeId,
      });

      const response = await request(app.getHttpServer())
        .get(`/toponymes/${toponymeId}/numeros`)
        .expect(200);

      expect(response.body.length).toEqual(2);
      expect(response.body[0].numero).toEqual(1);
      expect(response.body[1].numero).toEqual(1);
      expect(response.body[0].comment).toBeNull();
      expect(response.body[1].comment).toBeNull();
      expect(response.body[0].voie.id).toEqual(voieId);
      expect(response.body[1].voie.id).toEqual(voieId);
    });

    it('Return 200 numero with comment', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, { nom: 'allée' });
      const voieId = await createVoie(balId, { nom: 'rue de la paix' });
      await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
        toponymeId,
      });
      await createNumero(balId, voieId, {
        numero: 1,
        comment: 'coucou',
        toponymeId,
      });

      const response = await request(app.getHttpServer())
        .get(`/toponymes/${toponymeId}/numeros`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.length).toEqual(2);
      expect(response.body[0].numero).toEqual(1);
      expect(response.body[1].numero).toEqual(1);
      expect(response.body[0].comment).toEqual('coucou');
      expect(response.body[1].comment).toEqual('coucou');
      expect(response.body[0].voie.id).toEqual(voieId.toString());
      expect(response.body[1].voie.id).toEqual(voieId.toString());
    });
  });

  describe('PUT /toponymes', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });
      const changes: UpdateToponymeDTO = {
        nom: 'coucou',
        nomAlt: null,
        parcelles: ['12345000AA0002', '12345000AA0005'],
        positions: [createPositions()],
        communeDeleguee: '08294',
      };

      const response = await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}`)
        .send(changes)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toEqual(toponymeId);
      expect(response.body.balId).toEqual(balId);
      expect(response.body.nom).toEqual('coucou');
      expect(response.body.communeDeleguee).toEqual('08294');
      expect(response.body.parcelles).toEqual([
        '12345000AA0002',
        '12345000AA0005',
      ]);
      expect(response.body.positions).toBeDefined();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 400 bad communeDeleguee', async () => {
      const balId = await createBal({ nom: 'bal', commune: '08053' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });
      const changes: UpdateToponymeDTO = {
        nom: 'coucou',
        nomAlt: null,
        communeDeleguee: '91400',
        parcelles: ['12345000AA0002', '12345000AA0005'],
        positions: [createPositions()],
      };

      await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}`)
        .send(changes)
        .set('authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });

      const changes: UpdateToponymeDTO = {
        nom: 'coucou',
        nomAlt: null,
        parcelles: ['12345000AA0002', '12345000AA0005'],
        positions: [createPositions()],
      };

      await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}`)
        .send(changes)
        .expect(403);

      const toponyme = await toponymeRepository.findOneBy({ id: toponymeId });
      expect(toponyme.nom).toEqual('rue de la paix');
      expect(toponyme.parcelles).toBeNull();
      expect(toponyme.positions).toEqual([]);

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('PUT /soft-delete', () => {
    it('Return 204', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });
      const voidId = await createVoie(balId, {
        nom: 'rue de la paix',
      });
      const numeroId = await createNumero(balId, voidId, {
        numero: 1,
        toponymeId: toponymeId,
      });

      await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}/soft-delete`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const toponyme = await toponymeRepository.findOne({
        where: { id: toponymeId },
        withDeleted: true,
      });
      expect(toponyme.deletedAt).not.toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());

      const numero = await numeroRepository.findOneBy({ id: numeroId });
      expect(numero.toponymeId).toBeNull();
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
        deletedAt: null,
      });
      await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}/soft-delete`)
        .expect(403);

      const toponyme = await toponymeRepository.findOneBy({ id: toponymeId });
      expect(toponyme.deletedAt).toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('PUT /restore', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });
      const response = await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}/restore`)
        .set('authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.deletedAt).toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });
      const response = await request(app.getHttpServer())
        .put(`/toponymes/${toponymeId}/restore`)
        .expect(403);

      expect(response.body.deletedAt).not.toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });

  describe('DELETE /toponymes', () => {
    it('Return 200', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });
      await request(app.getHttpServer())
        .delete(`/toponymes/${toponymeId}`)
        .set('authorization', `Bearer ${token}`)
        .expect(204);

      const voie = await toponymeRepository.findOneBy({ id: toponymeId });
      expect(voie).toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).not.toEqual(updatedAt.toISOString());
    });

    it('Return 403', async () => {
      const balId = await createBal({ nom: 'bal', commune: '91400' });
      const toponymeId = await createToponyme(balId, {
        nom: 'rue de la paix',
      });

      await request(app.getHttpServer())
        .delete(`/toponymes/${toponymeId}`)
        .expect(403);

      const toponyme = await toponymeRepository.findOneBy({ id: toponymeId });
      expect(toponyme).not.toBeNull();

      const bal = await balRepository.findOneBy({ id: balId });
      expect(bal.updatedAt.toISOString()).toEqual(updatedAt.toISOString());
    });
  });
});
