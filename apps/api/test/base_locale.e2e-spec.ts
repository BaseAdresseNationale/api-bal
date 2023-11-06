import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Connection, connect, Model, Types } from 'mongoose';
import { validate } from '@ban-team/validateur-bal';
import * as fs from 'fs';

import { Numero } from '@/shared/schemas/numero/numero.schema';
import { Voie } from '@/shared/schemas/voie/voie.schema';
import { Toponyme } from '@/shared/schemas/toponyme/toponyme.schema';
import { BaseLocale } from '@/shared/schemas/base_locale/base_locale.schema';
import { PositionTypeEnum } from '@/shared/schemas/position_type.enum';
import { Position } from '@/shared/schemas/position.schema';

import { BaseLocaleModule } from '@/modules/base_locale/base_locale.module';

import { UpdateBatchNumeroDto } from '@/modules/numeros/dto/update_batch_numero.dto';
import { DeleteBatchNumeroDto } from '@/modules/numeros/dto/delete_batch_numero.dto';

describe('BASE LOCAL MODULE', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let mongoConnection: Connection;
  let numeroModel: Model<Numero>;
  let voieModel: Model<Voie>;
  let balModel: Model<BaseLocale>;
  let toponymeModel: Model<Toponyme>;
  const token = 'xxxx';

  beforeAll(async () => {
    // INIT DB
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    mongoConnection = (await connect(uri)).connection;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(uri), BaseLocaleModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();

    // INIT MODEL
    numeroModel = app.get<Model<Numero>>(getModelToken(Numero.name));
    voieModel = app.get<Model<Voie>>(getModelToken(Voie.name));
    balModel = app.get<Model<BaseLocale>>(getModelToken(BaseLocale.name));
    toponymeModel = app.get<Model<Toponyme>>(getModelToken(Toponyme.name));
  });

  afterAll(async () => {
    await mongoConnection.dropDatabase();
    await mongoConnection.close();
    await mongod.stop();
    await app.close();
  });

  afterEach(async () => {
    await toponymeModel.deleteMany({});
    await voieModel.deleteMany({});
    await balModel.deleteMany({});
    await numeroModel.deleteMany({});
  });

  async function createBal(props: Partial<BaseLocale> = {}) {
    const balId = new Types.ObjectId();
    const bal: Partial<BaseLocale> = {
      _id: balId,
      token,
      ...props,
    };
    await balModel.create(bal);
    return balId;
  }

  async function createVoie(props: Partial<Voie> = {}) {
    const voieId = new Types.ObjectId();
    const voie: Partial<Voie> = {
      _id: voieId,
      ...props,
    };
    await voieModel.create(voie);
    return voieId;
  }

  async function createToponyme(props: Partial<Toponyme> = {}) {
    const toponymeId = new Types.ObjectId();
    const toponyme: Partial<Toponyme> = {
      _id: toponymeId,
      ...props,
    };
    await toponymeModel.create(toponyme);
    return toponymeId;
  }

  async function createNumero(props: Partial<Numero> = {}) {
    const numeroId = new Types.ObjectId();
    const numero: Partial<Numero> = {
      _id: numeroId,
      ...props,
    };
    await numeroModel.create(numero);
    return numeroId;
  }

  function createPositions(coordinates: number[] = [8, 42]): Position[] {
    return [
      {
        type: PositionTypeEnum.ICONNUE,
        source: 'ban',
        point: {
          type: 'Point',
          coordinates,
        },
      },
    ];
  }

  describe('PUT /bases-locales/numeros/batch', () => {
    it('Batch 200 numeros change voie', async () => {
      const balId = await createBal();
      const voieId1 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const toponymeId1 = await createToponyme({
        nom: 'allée',
        _bal: balId,
      });
      const toponymeId2 = await createToponyme({
        nom: 'allée',
        _bal: balId,
      });
      const voieId2 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const voieId3 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const numeroId1 = await createNumero({
        _bal: balId,
        voie: voieId1,
        numero: 99,
        positions: createPositions(),
        toponyme: toponymeId1,
      });
      const numeroId2 = await createNumero({
        _bal: balId,
        voie: voieId2,
        numero: 99,
        positions: createPositions(),
        toponyme: toponymeId2,
      });

      const updateBtach: UpdateBatchNumeroDto = {
        numerosIds: [numeroId1, numeroId2],
        changes: {
          voie: voieId3,
          toponyme: toponymeId2,
          positionType: PositionTypeEnum.DELIVRANCE_POSTALE,
          certifie: true,
          comment: 'coucou',
        },
      };

      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Token ${token}`)
        .expect(200);

      expect(response.body.modifiedCount).toEqual(2);
      expect(response.body.changes).toEqual({
        voie: voieId3.toString(),
        toponyme: toponymeId2.toString(),
        positionType: PositionTypeEnum.DELIVRANCE_POSTALE,
        certifie: true,
        comment: 'coucou',
      });

      const numero1After: Numero = await numeroModel.findOne({
        _id: numeroId1,
      });
      expect(numero1After._updated).toBeDefined();
      expect(numero1After.voie).toEqual(voieId3);
      expect(numero1After.positions[0].type).toEqual(
        PositionTypeEnum.DELIVRANCE_POSTALE,
      );
      expect(numero1After.certifie).toBeTruthy();
      expect(numero1After.comment).toEqual('coucou');

      const numero2After: Numero = await numeroModel.findOne({
        _id: numeroId2,
      });
      expect(numero2After._updated).toBeDefined();
      expect(numero2After.voie).toEqual(voieId3);
      expect(numero2After.positions[0].type).toEqual(
        PositionTypeEnum.DELIVRANCE_POSTALE,
      );
      expect(numero2After.certifie).toBeTruthy();
      expect(numero2After.comment).toEqual('coucou');

      const voie1After: Voie = await voieModel.findOne({ _id: voieId1 });
      expect(voie1After._updated).toBeDefined();
      expect(voie1After.centroid).toBeNull();
      expect(voie1After.centroidTiles).toBeNull();

      const voie2After: Voie = await voieModel.findOne({ _id: voieId2 });
      expect(voie2After._updated).toBeDefined();
      expect(voie2After.centroid).toBeNull();
      expect(voie2After.centroidTiles).toBeNull();

      const voie3After: Voie = await voieModel.findOne({ _id: voieId3 });
      expect(voie3After._updated).toBeDefined();
      expect(voie3After.centroid).not.toBeNull();
      expect(voie3After.centroidTiles).not.toBeNull();

      const toponymeAfter1: Toponyme = await toponymeModel.findOne({
        _id: toponymeId1,
      });
      expect(toponymeAfter1._updated).toBeDefined();

      const toponymeAfter2: Toponyme = await toponymeModel.findOne({
        _id: toponymeId2,
      });
      expect(toponymeAfter2._updated).toBeDefined();

      const balAfter: BaseLocale = await balModel.findOne({ _id: balId });
      expect(balAfter._updated).toBeDefined();
    });

    it('Batch 400 without numeroIds', async () => {
      const balId = await createBal();

      const updateBtach: UpdateBatchNumeroDto = {
        numerosIds: [],
        changes: {
          positionType: PositionTypeEnum.DELIVRANCE_POSTALE,
          certifie: true,
          comment: 'coucou',
        },
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Token ${token}`)
        .expect(400);
    });

    it('Batch 400 without changes', async () => {
      const balId = await createBal();
      const voieId = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const numeroId = await createNumero({
        _bal: balId,
        voie: voieId,
        numero: 99,
        positions: createPositions(),
      });
      const updateBtach: UpdateBatchNumeroDto = {
        numerosIds: [numeroId],
        changes: {},
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Token ${token}`)
        .expect(400);
    });

    it('Batch 404 numeros: Bad voie', async () => {
      const balId = await createBal();
      const voieId = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const numeroId = await createNumero({
        _bal: balId,
        voie: voieId,
        numero: 99,
        positions: createPositions(),
      });
      const updateBtach: UpdateBatchNumeroDto = {
        numerosIds: [numeroId],
        changes: {
          voie: new Types.ObjectId(),
        },
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Token ${token}`)
        .expect(404);
    });

    it('Batch 404 numeros: Bad toponyme', async () => {
      const balId = await createBal();
      const voieId = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const numeroId = await createNumero({
        _bal: balId,
        voie: voieId,
        numero: 99,
        positions: createPositions(),
      });
      const updateBtach: UpdateBatchNumeroDto = {
        numerosIds: [numeroId],
        changes: {
          toponyme: new Types.ObjectId(),
        },
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch`)
        .send(updateBtach)
        .set('authorization', `Token ${token}`)
        .expect(404);
    });
  });

  describe('PUT /bases-locales/numeros/batch/soft-delete', () => {
    it('Soft Delete 200', async () => {
      const balId = await createBal();
      const voieId1 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const toponymeId1 = await createToponyme({
        nom: 'allée',
        _bal: balId,
      });
      const toponymeId2 = await createToponyme({
        nom: 'allée',
        _bal: balId,
      });
      const voieId2 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const numeroId1 = await createNumero({
        _bal: balId,
        voie: voieId1,
        numero: 99,
        positions: createPositions(),
        toponyme: toponymeId1,
      });
      const numeroId2 = await createNumero({
        _bal: balId,
        voie: voieId2,
        numero: 99,
        positions: createPositions(),
        toponyme: toponymeId2,
      });

      const deleteBtach: DeleteBatchNumeroDto = {
        numerosIds: [numeroId1, numeroId2],
      };

      const response = await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch/soft-delete`)
        .send(deleteBtach)
        .set('authorization', `Token ${token}`)
        .expect(200);

      expect(response.body.modifiedCount).toEqual(2);
      const numero1After: Numero = await numeroModel.findOne({
        _id: numeroId1,
      });
      expect(numero1After._updated).toBeDefined();
      expect(numero1After._deleted).toBeDefined();

      const numero2After: Numero = await numeroModel.findOne({
        _id: numeroId2,
      });
      expect(numero2After._updated).toBeDefined();
      expect(numero2After._deleted).toBeDefined();

      const voie1After: Voie = await voieModel.findOne({ _id: voieId1 });
      expect(voie1After._updated).toBeDefined();
      expect(voie1After.centroid).toBeNull();
      expect(voie1After.centroidTiles).toBeNull();

      const voie2After: Voie = await voieModel.findOne({ _id: voieId2 });
      expect(voie2After._updated).toBeDefined();
      expect(voie2After.centroid).toBeNull();
      expect(voie2After.centroidTiles).toBeNull();

      const toponymeAfter1: Toponyme = await toponymeModel.findOne({
        _id: toponymeId1,
      });
      expect(toponymeAfter1._updated).toBeDefined();

      const toponymeAfter2: Toponyme = await toponymeModel.findOne({
        _id: toponymeId2,
      });
      expect(toponymeAfter2._updated).toBeDefined();

      const balAfter: BaseLocale = await balModel.findOne({ _id: balId });
      expect(balAfter._updated).toBeDefined();
    });

    it('Soft Delete 400: Bad request', async () => {
      const balId = await createBal();
      const deleteBtach: DeleteBatchNumeroDto = {
        numerosIds: [],
      };

      await request(app.getHttpServer())
        .put(`/bases-locales/${balId}/numeros/batch/soft-delete`)
        .send(deleteBtach)
        .set('authorization', `Token ${token}`)
        .expect(400);
    });
  });

  describe('DELETE /bases-locales/numeros/batch', () => {
    it('Delete 204', async () => {
      const balId = await createBal();
      const voieId1 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const toponymeId1 = await createToponyme({
        nom: 'allée',
        _bal: balId,
      });
      const toponymeId2 = await createToponyme({
        nom: 'allée',
        _bal: balId,
      });
      const voieId2 = await createVoie({ nom: 'rue de la paix', _bal: balId });
      const numeroId1 = await createNumero({
        _bal: balId,
        voie: voieId1,
        numero: 99,
        positions: createPositions(),
        toponyme: toponymeId1,
      });
      const numeroId2 = await createNumero({
        _bal: balId,
        voie: voieId2,
        numero: 99,
        positions: createPositions(),
        toponyme: toponymeId2,
      });

      const deleteBtach: DeleteBatchNumeroDto = {
        numerosIds: [numeroId1, numeroId2],
      };

      await request(app.getHttpServer())
        .delete(`/bases-locales/${balId}/numeros/batch/`)
        .send(deleteBtach)
        .set('authorization', `Token ${token}`)
        .expect(204);

      const numero1After: Numero = await numeroModel.findOne({
        _id: numeroId1,
      });
      expect(numero1After).toBeNull();

      const numero2After: Numero = await numeroModel.findOne({
        _id: numeroId2,
      });
      expect(numero2After).toBeNull();

      const voie1After: Voie = await voieModel.findOne({ _id: voieId1 });
      expect(voie1After._updated).toBeDefined();
      expect(voie1After.centroid).toBeNull();
      expect(voie1After.centroidTiles).toBeNull();

      const voie2After: Voie = await voieModel.findOne({ _id: voieId2 });
      expect(voie2After._updated).toBeDefined();
      expect(voie2After.centroid).toBeNull();
      expect(voie2After.centroidTiles).toBeNull();

      const toponymeAfter1: Toponyme = await toponymeModel.findOne({
        _id: toponymeId1,
      });
      expect(toponymeAfter1._updated).toBeDefined();

      const toponymeAfter2: Toponyme = await toponymeModel.findOne({
        _id: toponymeId2,
      });
      expect(toponymeAfter2._updated).toBeDefined();

      const balAfter: BaseLocale = await balModel.findOne({ _id: balId });
      expect(balAfter._updated).toBeDefined();
    });

    it('Delete 400: Bad request', async () => {
      const balId = await createBal();
      const deleteBtach: DeleteBatchNumeroDto = {
        numerosIds: [],
      };

      await request(app.getHttpServer())
        .delete(`/bases-locales/${balId}/numeros/batch`)
        .send(deleteBtach)
        .set('authorization', `Token ${token}`)
        .expect(400);
    });
  });

  describe('GET /bases-locales/csv', () => {
    it('Delete 204', async () => {
      const balId = await createBal();
      const voieId1 = await createVoie({
        nom: 'rue de la paix',
        commune: '91534',
        _bal: balId,
      });
      const voieId2 = await createVoie({
        nom: 'rue de paris',
        commune: '91534',
        _bal: balId,
      });
      const toponymeId1 = await createToponyme({
        nom: 'allée',
        commune: '91534',
        _bal: balId,
      });
      const numeroId1 = await createNumero({
        _bal: balId,
        voie: voieId1,
        numero: 1,
        suffixe: 'bis',
        positions: createPositions(),
        toponyme: toponymeId1,
        certifie: true,
        commune: '91534',
        _updated: new Date('2000-01-01'),
      });
      const numeroId2 = await createNumero({
        _bal: balId,
        voie: voieId2,
        numero: 1,
        suffixe: 'ter',
        positions: createPositions(),
        toponyme: toponymeId1,
        certifie: false,
        commune: '91534',
        _updated: new Date('2000-01-01'),
      });

      const deleteBtach: DeleteBatchNumeroDto = {
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

      //       console.log(response.text, response.body);
      //       const csvFile = `cle_interop;uid_adresse;voie_nom;lieudit_complement_nom;numero;suffixe;certification_commune;commune_insee;commune_nom;position;long;lat;x;y;cad_parcelles;source;date_der_maj
      // 91534_xxxx_00001_bis;;rue de la paix;allée;1;bis;1;91534;Saclay;inconnu;8;42;1114835.92;6113076.85;;ban;2000-01-01
      // 91534_xxxx_00001_ter;;rue de paris;allée;1;ter;0;91534;Saclay;inconnu;8;42;1114835.92;6113076.85;;ban;2000-01-01
      // 91534_xxxx_99999;;allée;;99999;;;91534;Saclay;;;;;;;commune;`;
      //       expect(response.text).toEqual(csvFile);
    });
  });

  // describe('GET /bases-locales/search', () => {
  //   it('Find 200', async () => {
  //     const balId1 = await createBal({
  //       token: 'coucou',
  //       emails: ['living@data.com'],
  //       commune: '55326',
  //     });

  //     const balId2 = await createBal({
  //       token: 'coucou',
  //       emails: ['fetching@data.com'],
  //       commune: '55500',
  //     });

  //     const response = await request(app.getHttpServer())
  //       .get(`/bases-locales/search?commune=55326&email=living@data.com`)
  //       .expect(200);

  //     expect(response.body.count).toEqual(1);
  //   });
  // });
  // test('Fetch Bases Locales by commune and email', async (t) => {
  //   const idBal1 = new mongo.ObjectId();
  //   const idBal2 = new mongo.ObjectId();

  //   await mongo.db.collection('bases_locales').insertOne({
  //     _id: idBal1,
  //     token: 'coucou',
  //     emails: ['living@data.com'],
  //     commune: '55326',
  //   });

  //   await mongo.db.collection('bases_locales').insertOne({
  //     _id: idBal2,
  //     token: 'coucou',
  //     emails: ['fetching@data.com'],
  //     commune: '55500',
  //   });

  //   const response = await request(getApp()).get(
  //     '/bases-locales/search?commune=55326&email=living@data.com',
  //   );

  //   t.is(response.status, 200);
  //   t.is(response.body.results.length, 1);
  //   t.is(response.body.results[0].email, undefined);
  //   t.is(response.body.results[0].commune, '55326');
  // });
});
