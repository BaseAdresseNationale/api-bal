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
import { Position } from '@/shared/entities/position.entity';

import { HabilitationModule } from '@/modules/base_locale/sub_modules/habilitation/habilitation.module';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import {
  Habilitation,
  StatusHabilitationEnum,
} from '@/shared/modules/api_depot/api-depot.types';
import { add } from 'date-fns';
import { MailerModule } from '@/shared/test/mailer.module.test';
import { Repository } from 'typeorm';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';

describe('HABILITATION MODULE', () => {
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
        HabilitationModule,
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

  describe('GET /bases-locales/:id/habilitation', () => {
    it('expect 200 with admin token', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.PUBLISHED,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/habilitation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(JSON.stringify(response.body)).toEqual(
        JSON.stringify(habilitation),
      );
    });

    it('expect 403 without admin token', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.PUBLISHED,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/habilitation`)
        .expect(403);
    });

    it('expect 404 with admin token', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.PUBLISHED,
        habilitationId,
      });
      const responseBody = {
        code: 404,
        message: 'L’identifiant de l’habilitation demandé n’existe pas',
      };
      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(404, responseBody);

      const response = await request(app.getHttpServer())
        .get(`/bases-locales/${balId}/habilitation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(502);

      const responseExpected = {
        statusCode: 502,
        message: 'L’identifiant de l’habilitation demandé n’existe pas',
      };

      expect(response.body).toEqual(responseExpected);
    });
  });

  describe('POST /bases-locales/:id/habilitation', () => {
    it('expect 201 Create habilitation', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };
      axiosMock
        .onPost(`communes/${commune}/habilitations`)
        .reply(201, habilitation);

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(JSON.stringify(response.body)).toEqual(
        JSON.stringify(habilitation),
      );

      const updatedBAL = await balRepository.findOneBy({ id: balId });
      expect(updatedBAL.habilitationId).toBe(habilitation.id);
    });

    it('expect 412 BAL already has habilitation', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };

      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation`)
        .set('Authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.body).toEqual({
        statusCode: 412,
        message: 'Cette Base Adresse Locale possède déjà une habilitation',
      });
    });
  });

  describe('POST /bases-locales/:id/habilitation/email/send-pin-code', () => {
    it('expect 200', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.PENDING,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };

      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      axiosMock
        .onPost(
          `habilitations/${habilitationId}/authentication/email/send-pin-code`,
        )
        .reply(200, {
          code: 200,
          message: 'OK',
        });

      await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation/email/send-pin-code`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('expect 412 no pending habilitation', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.ACCEPTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };

      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation/email/send-pin-code`)
        .set('Authorization', `Bearer ${token}`)
        .expect(412);

      expect(response.body).toEqual({
        statusCode: 412,
        message: 'Aucune demande d’habilitation en attente',
      });
    });
  });

  describe('POST /bases-locales/:id/habilitation/email/validate-pin-code', () => {
    it('expect 200', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.PENDING,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };

      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      axiosMock
        .onPost(
          `habilitations/${habilitationId}/authentication/email/validate-pin-code`,
        )
        .reply(200);

      await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation/email/validate-pin-code`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })
        .expect(200);
    });

    it('expect 200 incorrect PIN code', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.PENDING,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };

      const apiDepotResponse = {
        message: 'Code non valide, 9 tentatives restantes',
        statusCode: 412,
      };

      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      axiosMock
        .onPost(
          `habilitations/${habilitationId}/authentication/email/validate-pin-code`,
        )
        .reply(412, apiDepotResponse);

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation/email/validate-pin-code`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })
        .expect(502);

      expect(response.body).toEqual({
        statusCode: 502,
        message: 'Code non valide, 9 tentatives restantes',
      });
    });

    it('expect 412 no pending habilitation', async () => {
      const habilitationId = new ObjectId().toHexString();
      const commune = '91534';
      const balId = await createBal({
        nom: 'BAL de test',
        commune,
        emails: ['test@test.fr'],
        token,
        status: StatusBaseLocalEnum.DRAFT,
        habilitationId,
      });

      const habilitation: Habilitation = {
        id: habilitationId,
        status: StatusHabilitationEnum.REJECTED,
        expiresAt: add(new Date(), { months: 1 }),
        codeCommune: commune,
        emailCommune: 'test@test.fr',
      };

      axiosMock
        .onGet(`habilitations/${habilitationId}`)
        .reply(200, habilitation);

      const response = await request(app.getHttpServer())
        .post(`/bases-locales/${balId}/habilitation/email/validate-pin-code`)
        .set('Authorization', `Bearer ${token}`)
        .send({ code: '123456' })
        .expect(412);

      expect(response.body).toEqual({
        statusCode: 412,
        message: 'Aucune demande d’habilitation en attente',
      });
    });
  });
});
