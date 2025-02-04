import { Test, TestingModule } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { Client } from 'pg';
import {
  Global,
  INestApplication,
  Logger,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import axios from 'axios';
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

import { DetectOutdatedTask } from '../src/tasks/detect_outdated.task';
import {
  DetectConflictTask,
  KEY_DETECT_CONFLICT_PUBLISHED_SINCE,
} from '../src/tasks/detect_conflict.task';
import {
  Revision,
  StatusRevision,
} from '@/shared/modules/api_depot/types/revision.type';
import { add, sub } from 'date-fns';
import {
  Habilitation,
  StatusHabiliation,
} from '@/shared/modules/api_depot/types/habilitation.type';
import { SyncOutdatedTask } from '../src/tasks/sync_outdated.task';
import { ApiDepotModule } from '@/shared/modules/api_depot/api_depot.module';
import { PublicationModule } from '@/shared/modules/publication/publication.module';
import { MailerService } from '@nestjs-modules/mailer';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Point, Repository } from 'typeorm';
import { CacheModule } from '@/shared/modules/cache/cache.module';
import { Cache } from '@/shared/entities/cache.entity';

@Global()
@Module({
  providers: [
    {
      provide: MailerService,
      useValue: {
        sendMail: jest.fn(),
      },
    },
  ],
  exports: [MailerService],
})
class MailerModule {}

describe('TASK MODULE', () => {
  let app: INestApplication;
  // DB
  let postgresContainer: StartedPostgreSqlContainer;
  let postgresClient: Client;
  let numeroRepository: Repository<Numero>;
  let voieRepository: Repository<Voie>;
  let balRepository: Repository<BaseLocale>;
  let toponymeRepository: Repository<Toponyme>;
  let cacheRepository: Repository<Cache>;
  // SERVICE
  let detectOutdated: DetectOutdatedTask;
  let detectConflict: DetectConflictTask;
  let syncOutdatedTask: SyncOutdatedTask;
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
          entities: [BaseLocale, Voie, Numero, Toponyme, Position, Cache],
        }),
        TypeOrmModule.forFeature([BaseLocale]),
        ApiDepotModule,
        PublicationModule,
        MailerModule,
        CacheModule,
      ],
      providers: [
        DetectOutdatedTask,
        DetectConflictTask,
        SyncOutdatedTask,
        Logger,
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
    cacheRepository = app.get(getRepositoryToken(Cache));
    // INIT TASK
    detectOutdated = app.get<DetectOutdatedTask>(DetectOutdatedTask);
    detectConflict = app.get<DetectConflictTask>(DetectConflictTask);
    syncOutdatedTask = app.get<SyncOutdatedTask>(SyncOutdatedTask);
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
    axiosMock.reset();
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

  it('detectOutdated', async () => {
    const balId = await createBal({
      nom: 'bal',
      commune: '91534',
      sync: {
        status: StatusSyncEnum.SYNCED,
        lastUploadedRevisionId: new ObjectId().toHexString(),
        currentUpdated: new Date('2000-01-01'),
      },
      status: StatusBaseLocalEnum.PUBLISHED,
    });

    await detectOutdated.run();

    const resultBal = await balRepository.findOneBy({ id: balId });

    expect(resultBal.sync.status).toEqual(StatusSyncEnum.OUTDATED);
    expect(resultBal.sync.currentUpdated).toBe(null);
  });

  it('detectConflict', async () => {
    const commune = '97354';
    const date = new Date('2000-01-01');
    await cacheRepository.save({
      key: KEY_DETECT_CONFLICT_PUBLISHED_SINCE,
      value: date.toISOString(),
    });

    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId,
      codeCommune: commune,
      ready: true,
      current: true,
      updatedAt: new Date('2000-01-01'),
      createdAt: new Date('2000-01-01'),
    };

    axiosMock
      .onGet(`/current-revisions?publishedSince=${date.toISOString()}`)
      .reply(200, [revision]);

    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    const balId1 = await createBal({
      nom: 'bal',
      sync: {
        status: StatusSyncEnum.SYNCED,
        lastUploadedRevisionId: revisionId,
      },
      commune,
      status: StatusBaseLocalEnum.PUBLISHED,
    });

    const balId2 = await createBal({
      nom: 'bal',
      commune,
      sync: {
        status: StatusSyncEnum.SYNCED,
        lastUploadedRevisionId: new ObjectId().toHexString(),
      },
      status: StatusBaseLocalEnum.PUBLISHED,
    });

    await detectConflict.run();

    const cachedDate = await cacheRepository.findOne({
      where: { key: KEY_DETECT_CONFLICT_PUBLISHED_SINCE },
    });

    expect(date.toISOString()).not.toEqual(cachedDate);

    const bal1After = await balRepository.findOneBy({ id: balId1 });
    const bal2After = await balRepository.findOneBy({ id: balId2 });

    expect(bal1After.status).toEqual(StatusBaseLocalEnum.PUBLISHED);
    expect(bal1After.sync.status).toEqual(StatusSyncEnum.SYNCED);

    expect(bal2After.status).toEqual(StatusBaseLocalEnum.REPLACED);
    expect(bal2After.sync.status).toEqual(StatusSyncEnum.CONFLICT);
  });

  it('syncOutdated', async () => {
    const commune = '91534';
    const habilitationId = new ObjectId().toHexString();
    // REVSION
    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId,
      codeCommune: commune,
      status: StatusRevision.PUBLISHED,
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
    const date = sub(new Date(), { hours: 3 });
    // BAL
    const balId = await createBal({
      banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
      nom: 'bal',
      commune,
      habilitationId,
      status: StatusBaseLocalEnum.PUBLISHED,
      emails: ['test@test.fr'],
      sync: {
        status: StatusSyncEnum.OUTDATED,
        lastUploadedRevisionId: revisionId,
        isPaused: false,
        currentUpdated: null,
      },
      updatedAt: date,
    });
    const voieId = await createVoie(balId, {
      nom: 'rue de la paix',
      banId: '26734c2d-2a14-4eeb-ac5b-1be055c0a5ae',
    });
    await createNumero(balId, voieId, {
      numero: 1,
      banId: '2da3bb47-1a10-495a-8c29-6b8d0e79f9af',
      suffixe: 'bis',
      positions: [createPositions()],
      certifie: true,
      updatedAt: new Date('2000-01-01'),
    });

    // MOCK AXIOS
    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    const habilitation: Habilitation = {
      _id: habilitationId.toString(),
      status: StatusHabiliation.ACCEPTED,
      expiresAt: add(new Date(), { months: 1 }),
      codeCommune: commune,
      emailCommune: 'test@test.fr',
    };
    axiosMock.onGet(`habilitations/${habilitationId}`).reply(200, habilitation);

    axiosMock.onPost(`/communes/${commune}/revisions`).reply(200, revision);

    axiosMock.onPost(`/revisions/${revisionId}/compute`).reply(200, revision);

    const csvFile = `cle_interop;id_ban_commune;id_ban_toponyme;id_ban_adresse;voie_nom;lieudit_complement_nom;numero;suffixe;certification_commune;commune_insee;commune_nom;commune_deleguee_insee;commune_deleguee_nom;position;long;lat;x;y;cad_parcelles;source;date_der_maj
  91534_xxxx_00001_bis;52c4de09-6b82-45eb-8ed7-b212607282f7;26734c2d-2a14-4eeb-ac5b-1be055c0a5ae;2da3bb47-1a10-495a-8c29-6b8d0e79f9af;rue de la paix;;1;bis;1;91534;Saclay;;;entrée;8;42;1114835.92;6113076.85;;ban;2000-01-01`;
    axiosMock.onPut(`/revisions/${revisionId}/files/bal`).reply(({ data }) => {
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
      expect(JSON.parse(data).habilitationId).toEqual(
        habilitationId.toString(),
      );
      return [200, publishedRevision];
    });

    await syncOutdatedTask.run();

    const balResult = await balRepository.findOneBy({ id: balId });

    expect(balResult.status).toEqual(StatusBaseLocalEnum.PUBLISHED);
    expect(balResult.sync.currentUpdated).toBeDefined();
    expect(balResult.sync.status).toEqual(StatusSyncEnum.SYNCED);
    expect(balResult.sync.isPaused).toEqual(false);
    expect(balResult.sync.lastUploadedRevisionId).toEqual(revisionId);
  });

  it('syncOutdated same hash', async () => {
    const commune = '91534';
    const habilitationId = new ObjectId().toHexString();
    // REVSION
    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId.toString(),
      codeCommune: commune,
      status: StatusRevision.PUBLISHED,
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
          hash: '5387136992a3d0ca40c53dc14c21fda9a4ca566b18bd6c45df7aa852774b4c8a',
        },
      ],
    };

    // BAL
    const balId = await createBal({
      nom: 'bal',
      banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
      commune,
      habilitationId,
      status: StatusBaseLocalEnum.PUBLISHED,
      emails: ['test@test.fr'],
      sync: {
        status: StatusSyncEnum.OUTDATED,
        lastUploadedRevisionId: revisionId,
        isPaused: false,
        currentUpdated: null,
      },
    });
    const voieId = await createVoie(balId, {
      nom: 'rue de la paix',
      banId: '26734c2d-2a14-4eeb-ac5b-1be055c0a5ae',
    });
    await createNumero(balId, voieId, {
      numero: 1,
      banId: '2da3bb47-1a10-495a-8c29-6b8d0e79f9af',
      suffixe: 'bis',
      positions: [createPositions()],
      certifie: true,
    });

    // MOCK AXIOS
    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    const habilitation: Habilitation = {
      _id: habilitationId.toString(),
      status: StatusHabiliation.ACCEPTED,
      expiresAt: add(new Date(), { months: 1 }),
      codeCommune: commune,
      emailCommune: 'test@test.fr',
    };
    axiosMock.onGet(`habilitations/${habilitationId}`).reply(200, habilitation);

    await syncOutdatedTask.run();

    const balResult = await balRepository.findOneBy({ id: balId });
    expect(balResult.status).toEqual(StatusBaseLocalEnum.PUBLISHED);
    expect(balResult.sync.currentUpdated).toBeDefined();
    expect(balResult.sync.status).toEqual(StatusSyncEnum.SYNCED);
    expect(balResult.sync.isPaused).toEqual(false);
    expect(balResult.sync.lastUploadedRevisionId).toEqual(revisionId);
  });

  it('syncOutdated 412 no habilitation', async () => {
    const commune = '91534';
    // REVSION
    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId.toString(),
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
      banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
      commune,
      status: StatusBaseLocalEnum.PUBLISHED,
      emails: ['test@test.fr'],
      sync: {
        status: StatusSyncEnum.OUTDATED,
        lastUploadedRevisionId: revisionId,
      },
    });

    // MOCK AXIOS
    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    await syncOutdatedTask.run();

    const resultBal = await balRepository.findOneBy({ id: balId });
    expect(resultBal.sync.status).toEqual(StatusSyncEnum.OUTDATED);
    expect(resultBal.sync.lastUploadedRevisionId).toEqual(revisionId);
  });

  it('syncOutdated 412 habilitation PENDING', async () => {
    const commune = '91534';
    // REVSION
    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId.toString(),
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

    const habilitationId = new ObjectId().toHexString();
    // BAL
    const balId = await createBal({
      nom: 'bal',
      banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
      commune,
      habilitationId,
      status: StatusBaseLocalEnum.PUBLISHED,
      emails: ['test@test.fr'],
      sync: {
        status: StatusSyncEnum.OUTDATED,
        lastUploadedRevisionId: revisionId,
      },
    });

    // MOCK AXIOS
    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    const habilitation: Habilitation = {
      _id: habilitationId.toString(),
      status: StatusHabiliation.PENDING,
      expiresAt: add(new Date(), { months: 1 }),
      codeCommune: commune,
      emailCommune: 'test@test.fr',
    };
    axiosMock.onGet(`habilitations/${habilitationId}`).reply(200, habilitation);

    await syncOutdatedTask.run();

    const resultBal = await balRepository.findOneBy({ id: balId });
    expect(resultBal.sync.status).toEqual(StatusSyncEnum.OUTDATED);
    expect(resultBal.sync.lastUploadedRevisionId).toEqual(revisionId);
  });

  it('syncOutdated 412 habilitation expired', async () => {
    const commune = '91534';
    // REVSION
    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId.toString(),
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

    const habilitationId = new ObjectId().toHexString();
    // BAL
    const balId = await createBal({
      nom: 'bal',
      banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
      commune,
      habilitationId,
      status: StatusBaseLocalEnum.PUBLISHED,
      emails: ['test@test.fr'],
      sync: {
        status: StatusSyncEnum.OUTDATED,
        lastUploadedRevisionId: revisionId,
      },
    });

    // MOCK AXIOS
    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    const habilitation: Habilitation = {
      _id: habilitationId.toString(),
      status: StatusHabiliation.ACCEPTED,
      expiresAt: sub(new Date(), { months: 1 }),
      codeCommune: commune,
      emailCommune: 'test@test.fr',
    };
    axiosMock.onGet(`habilitations/${habilitationId}`).reply(200, habilitation);

    await syncOutdatedTask.run();

    const resultBal = await balRepository.findOneBy({ id: balId });
    expect(resultBal.sync.status).toEqual(StatusSyncEnum.OUTDATED);
    expect(resultBal.sync.lastUploadedRevisionId).toEqual(revisionId);
  });

  it('syncOutdated 412 no numero', async () => {
    const commune = '91534';
    // REVSION
    const revisionId = new ObjectId().toHexString();
    const revision: Revision = {
      _id: revisionId.toString(),
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

    const habilitationId = new ObjectId().toHexString();
    // BAL
    const balId = await createBal({
      nom: 'bal',
      banId: '52c4de09-6b82-45eb-8ed7-b212607282f7',
      commune,
      habilitationId,
      status: StatusBaseLocalEnum.PUBLISHED,
      emails: ['test@test.fr'],
      sync: {
        status: StatusSyncEnum.OUTDATED,
        lastUploadedRevisionId: revisionId,
      },
    });

    // MOCK AXIOS
    axiosMock
      .onGet(`/communes/${commune}/current-revision`)
      .reply(200, revision);

    const habilitation: Habilitation = {
      _id: habilitationId.toString(),
      status: StatusHabiliation.ACCEPTED,
      expiresAt: add(new Date(), { months: 1 }),
      codeCommune: commune,
      emailCommune: 'test@test.fr',
    };
    axiosMock.onGet(`habilitations/${habilitationId}`).reply(200, habilitation);

    await syncOutdatedTask.run();

    const resultBal = await balRepository.findOneBy({ id: balId });
    expect(resultBal.sync.status).toEqual(StatusSyncEnum.OUTDATED);
    expect(resultBal.sync.lastUploadedRevisionId).toEqual(revisionId);
  });
});
