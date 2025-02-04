import {
  Injectable,
  HttpStatus,
  HttpException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeleteResult,
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsSelect,
  FindOptionsWhere,
  In,
  Point,
  Repository,
  UpdateResult,
  Polygon,
} from 'typeorm';
import { v4 as uuid } from 'uuid';
import { pick, chunk } from 'lodash';
import { ObjectId } from 'mongodb';

import { Numero } from '@/shared/entities/numero.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { normalizeSuffixe } from '@/shared/utils/numero.utils';
import { Position } from '@/shared/entities/position.entity';

import { UpdateNumeroDTO } from '@/modules/numeros/dto/update_numero.dto';
import { CreateNumeroDTO } from '@/modules/numeros/dto/create_numero.dto';
import { UpdateBatchNumeroDTO } from '@/modules/numeros/dto/update_batch_numero.dto';
import { DeleteBatchNumeroDTO } from '@/modules/numeros/dto/delete_batch_numero.dto';
import { VoieService } from '@/modules/voie/voie.service';
import { ToponymeService } from '@/modules/toponyme/toponyme.service';
import { BaseLocaleService } from '@/modules/base_locale/base_locale.service';
import { BatchNumeroResponseDTO } from './dto/batch_numero_response.dto';

@Injectable()
export class NumeroService {
  constructor(
    @InjectRepository(Numero)
    private numerosRepository: Repository<Numero>,
    @InjectRepository(Position)
    private positionsRepository: Repository<Position>,
    @Inject(forwardRef(() => VoieService))
    private voieService: VoieService,
    @Inject(forwardRef(() => ToponymeService))
    private toponymeService: ToponymeService,
    @Inject(forwardRef(() => BaseLocaleService))
    private baseLocaleService: BaseLocaleService,
  ) {}

  async findOneOrFail(numeroId: string): Promise<Numero> {
    // Créer le filtre where et lance la requète postgres
    const where: FindOptionsWhere<Numero> = {
      id: numeroId,
    };
    const numero = await this.numerosRepository.findOne({
      where,
      withDeleted: true,
    });
    // Si len numero n'existe pas, on throw une erreur
    if (!numero) {
      throw new HttpException(
        `Numero ${numeroId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }
    return numero;
  }

  async findMany(
    where: FindOptionsWhere<Numero>,
    select?: FindOptionsSelect<Numero>,
    order?: FindOptionsOrder<Numero>,
    relations?: FindOptionsRelations<Numero>,
    withDeleted?: boolean,
  ): Promise<Numero[]> {
    // Get les numeros en fonction du where, select, order et des relations
    return this.numerosRepository.find({
      where,
      ...(select && { select }),
      ...(order && { order }),
      ...(relations && { relations }),
      ...(withDeleted && { withDeleted }),
    });
  }

  async countBalNumeroAndCertifie(balId: string): Promise<{
    nbNumeros: string;
    nbNumerosCertifies: string;
  }> {
    const query = this.numerosRepository
      .createQueryBuilder()
      .select('count(id)', 'nbNumeros')
      .addSelect(
        'count(CASE WHEN certifie THEN true END)',
        'nbNumerosCertifies',
      )
      .where('bal_id = :balId', { balId });
    return query.getRawOne();
  }

  async findManyWithDeleted(
    where: FindOptionsWhere<Numero>,
  ): Promise<Numero[]> {
    // Get les numeros en fonction du where archivé ou non
    return this.numerosRepository.find({
      where,
      withDeleted: true,
    });
  }

  async findDistinct(
    where: FindOptionsWhere<Numero>,
    field: string,
  ): Promise<string[]> {
    // Get la liste distinct du field dans l'enssemble where
    const res = await this.numerosRepository
      .createQueryBuilder()
      .select(field)
      .distinctOn([field])
      .where(where)
      .withDeleted()
      .getRawMany();
    return res.map((raw) => raw[field]);
  }

  async findDistinctParcelles(balId: string): Promise<string[]> {
    const res: any[] = await this.numerosRepository.query(
      `SELECT ARRAY_AGG(distinct elem) 
        FROM (select unnest(parcelles) as elem, bal_id, deleted_at from numeros) s 
        WHERE bal_id = '${balId}' AND deleted_at IS null`,
    );
    return res[0]?.array_agg || [];
  }

  async findManyWherePositionInBBox(
    balId: string,
    bbox: number[],
  ): Promise<Numero[]> {
    // Requète postgis qui permet de récupèré les voie dont le centroid est dans la bbox
    const query = this.numerosRepository
      .createQueryBuilder('numeros')
      .leftJoinAndSelect('numeros.positions', 'positions')
      .where('numeros.balId = :balId', { balId })
      .andWhere(
        'positions.point @ ST_MakeEnvelope(:xmin, :ymin, :xmax, :ymax, 4326)',
        {
          xmin: bbox[0],
          ymin: bbox[1],
          xmax: bbox[2],
          ymax: bbox[3],
        },
      );
    return query.getMany();
  }

  async findManyWherePositionInPolygon(
    balId: string,
    polygon: number[][],
  ): Promise<Numero[]> {
    const linestring: string = polygon
      .map((arr) => `${arr[0]} ${arr[1]}`)
      .join(',');
    // Requète postgis qui permet de récupèré les numeros dans un polygon simple
    const query = this.numerosRepository
      .createQueryBuilder('numeros')
      .leftJoinAndSelect('numeros.positions', 'positions')
      .where('numeros.balId = :balId', { balId })
      .andWhere(
        `ST_Contains(ST_Polygon('LINESTRING(${linestring})'::geometry, 4326), positions.point)`,
      );
    return query.getMany();
  }

  public async count(where: FindOptionsWhere<Numero>): Promise<number> {
    return this.numerosRepository.count({ where });
  }

  public async updateMany(
    where: FindOptionsWhere<Numero>,
    update: Partial<Numero>,
  ): Promise<any> {
    return this.numerosRepository.update(where, update);
  }

  async importMany(
    baseLocale: BaseLocale,
    rawNumeros: Partial<Numero>[],
  ): Promise<void> {
    const validRawNumeros: Partial<Numero>[] = rawNumeros.filter(
      ({ voieId, numero }) => Boolean(voieId && numero),
    );
    // On transforme les raw en numeros
    const numeros = validRawNumeros
      // On garde seulement les numeros qui ont une voie et un numero
      .map((rawNumero) => ({
        id: rawNumero.id,
        balId: baseLocale.id,
        banId: rawNumero.banId || uuid(),
        numero: rawNumero.numero,
        comment: rawNumero.comment,
        toponymeId: rawNumero.toponymeId,
        voieId: rawNumero.voieId,
        ...(rawNumero.suffixe && {
          suffixe: normalizeSuffixe(rawNumero.suffixe),
        }),
        parcelles: rawNumero.parcelles || [],
        certifie: rawNumero.certifie || false,
        communeDeleguee: rawNumero.communeDeleguee,
        ...(rawNumero.updatedAt && { updatedAt: rawNumero.updatedAt }),
        ...(rawNumero.createdAt && { createdAt: rawNumero.createdAt }),
      }));
    // On ne retourne rien si il n'y a pas de numeros a insert
    if (numeros.length === 0) {
      return;
    }
    // On insert les numeros 500 par 500
    for (const numerosChunk of chunk(numeros, 500)) {
      await this.numerosRepository
        .createQueryBuilder()
        .insert()
        .into(Numero)
        .values(numerosChunk)
        .execute();
    }
    // On créer les positions
    const positions: Partial<Position>[] = [];
    for (const rawNumero of validRawNumeros) {
      let rank = 0;
      for (const { source, type, point } of rawNumero.positions) {
        positions.push({
          id: new ObjectId().toHexString(),
          numeroId: rawNumero.id,
          source,
          type,
          point,
          rank,
        });
        rank++;
      }
    }
    // On insert les positions 500 par 500
    for (const positionsChunk of chunk(positions, 500)) {
      await this.numerosRepository
        .createQueryBuilder()
        .insert()
        .into(Position)
        .values(positionsChunk)
        .execute();
    }
  }

  public async create(
    voie: Voie,
    createNumeroDto: CreateNumeroDTO,
  ): Promise<Numero> {
    // On vérifie que la voie ne soit pas archivé
    if (voie.deletedAt) {
      throw new HttpException('Voie is archived', HttpStatus.NOT_FOUND);
    }
    // Si il y a un toponyme, on vérifie qu'il existe
    if (
      createNumeroDto.toponymeId &&
      !(await this.toponymeService.isToponymeExist(createNumeroDto.toponymeId))
    ) {
      throw new HttpException('Toponyme not found', HttpStatus.NOT_FOUND);
    }
    // On créer l'object numéro
    const numero: Partial<Numero> = {
      balId: voie.balId,
      banId: uuid(),
      voieId: voie.id,
      numero: createNumeroDto.numero,
      suffixe: createNumeroDto.suffixe
        ? normalizeSuffixe(createNumeroDto.suffixe)
        : null,
      toponymeId: createNumeroDto.toponymeId || null,
      positions: createNumeroDto.positions || [],
      comment: createNumeroDto.comment || null,
      parcelles: createNumeroDto.parcelles || [],
      certifie: createNumeroDto.certifie || false,
      communeDeleguee: createNumeroDto.communeDeleguee || null,
    };
    // Créer l'entité typeorm
    const entityToSave: Numero = this.numerosRepository.create(numero);
    // On insert l'object dans postgres
    const numeroCreated: Numero =
      await this.numerosRepository.save(entityToSave);
    // On calcule le centroid de la voie
    await this.voieService.calcCentroidAndBbox(voie.id);
    // On met a jour le updatedAt de la Bal
    await this.baseLocaleService.touch(numero.balId);
    return numeroCreated;
  }

  public async update(
    numero: Numero,
    updateNumeroDto: UpdateNumeroDTO,
  ): Promise<Numero> {
    // Si il y a un changement de voie, on vérifie que cette derniere existe
    if (
      updateNumeroDto.voieId &&
      !(await this.voieService.isVoieExist(updateNumeroDto.voieId))
    ) {
      throw new HttpException('Voie not found', HttpStatus.NOT_FOUND);
    }
    // Si il y a un changement de toponyme, on vérifie que ce dernier existe
    if (
      updateNumeroDto.toponymeId &&
      !(await this.toponymeService.isToponymeExist(updateNumeroDto.toponymeId))
    ) {
      throw new HttpException('Toponyme not found', HttpStatus.NOT_FOUND);
    }
    // On normalize le suffix
    if (updateNumeroDto.suffixe) {
      updateNumeroDto.suffixe = normalizeSuffixe(updateNumeroDto.suffixe);
    }
    // On update le numéro dans postgres
    const numeroToSave: Numero = this.numerosRepository.create({
      id: numero.id,
      ...updateNumeroDto,
      updatedAt: new Date(),
    });

    await this.numerosRepository.save(numeroToSave);
    const numeroUpdated: Numero = await this.numerosRepository.findOneBy({
      id: numero.id,
    });
    // Si le numero a été modifié
    if (updateNumeroDto.voieId) {
      // On recalcule le centroid de l'ancienne et la nouvelle voie si le numero a changé de voie
      await this.voieService.calcCentroidAndBbox(numero.voieId);
      await this.voieService.calcCentroidAndBbox(numeroUpdated.voieId);
    } else if (updateNumeroDto.positions) {
      // On recalcule le centroid de la voie si les positions du numeros on changé
      await this.voieService.calcCentroidAndBbox(numero.voieId);
    }
    // On met a jour le updatedAt de la voie
    await this.voieService.touch(numero.voieId);
    // On met a jour le updatedAt de la BAL
    await this.baseLocaleService.touch(numero.balId);

    return numeroUpdated;
  }

  public async delete(numero: Numero): Promise<void> {
    // On créer le where et on lance la requète
    const where: FindOptionsWhere<Numero> = {
      id: numero.id,
    };
    const { affected }: DeleteResult =
      await this.numerosRepository.delete(where);
    // Si le numero a été suprimé
    if (affected > 0) {
      // On met a jour le updatedAt de la bal, la voie et le toponyme
      await this.touch(numero);
    }
  }

  public async deleteMany(where: FindOptionsWhere<Numero>) {
    // On supprime les numero
    await this.numerosRepository.delete(where);
  }

  public async softDelete(numero: Numero): Promise<void> {
    // On créer le where et on lance la requète
    const { affected }: UpdateResult = await this.numerosRepository.softDelete({
      id: numero.id,
    });
    // Si le numero a été suprimé
    if (affected > 0) {
      // On recalcule le centroid de la voie du numéro
      await this.voieService.calcCentroidAndBbox(numero.voieId);
      // On met a jour le updatedAt de la bal, la voie et le toponyme
      await this.touch(numero);
    }
  }

  public async softDeleteByVoie(voieId: string): Promise<void> {
    await this.numerosRepository.softDelete({
      voieId,
    });
  }

  public async restore(where: FindOptionsWhere<Numero>): Promise<void> {
    await this.numerosRepository.restore(where);
  }

  public async toggleCertifieNumeros(
    baseLocale: BaseLocale,
    certifie: boolean,
  ): Promise<void> {
    const numeros = await this.findMany({
      balId: baseLocale.id,
      certifie: !certifie,
    });
    const numerosIds = numeros.map((n) => n.id);
    await this.numerosRepository.update({ id: In(numerosIds) }, { certifie });
    await this.baseLocaleService.touch(baseLocale.id);
  }

  public async updateBatch(
    baseLocale: BaseLocale,
    { numerosIds, changes }: UpdateBatchNumeroDTO,
  ): Promise<BatchNumeroResponseDTO> {
    // On récupère les différentes voies et toponymes des numeros qu'on va modifier
    const where: FindOptionsWhere<Numero> = {
      id: In(numerosIds),
      balId: baseLocale.id,
    };
    const voieIds: string[] = await this.findDistinct(where, 'voie_id');
    const toponymeIds: string[] = await this.findDistinct(where, 'toponyme_id');
    // Si la voie des numéro est changé, on vérifie que cette derniere existe bien
    if (
      changes.voieId &&
      !(await this.voieService.isVoieExist(changes.voieId, baseLocale.id))
    ) {
      throw new HttpException('Voie not found', HttpStatus.NOT_FOUND);
    }
    // Si le toponyme des numéro est changé, on vérifie que cet dernier existe bien
    if (
      changes.toponymeId &&
      !(await this.toponymeService.isToponymeExist(
        changes.toponymeId,
        baseLocale.id,
      ))
    ) {
      throw new HttpException('Toponyme not found', HttpStatus.NOT_FOUND);
    }
    // On créer le batch (en omettant positionType qui n'existe pas dans numero)
    const batchChanges: Partial<Numero> = {
      ...(changes.voieId && { voieId: changes.voieId }),
      ...(changes.toponymeId !== undefined && {
        toponymeId: changes.toponymeId,
      }),
      ...pick(changes, ['comment', 'certifie', 'communeDeleguee']),
    };
    // Si le positionType est changé, on change le type de la première position dans le batch
    let positionTypeAffected: number = 0;
    if (changes.positionType) {
      const { affected }: UpdateResult = await this.positionsRepository.update(
        { numeroId: In(numerosIds), rank: 0 },
        { type: changes.positionType },
      );
      positionTypeAffected = affected;
    }
    // On lance la requète
    const { affected }: UpdateResult = await this.numerosRepository.update(
      {
        id: In(numerosIds),
        balId: baseLocale.id,
      },
      batchChanges,
    );

    // Si il y a plus d'un numéro qui a changé
    if (affected > 0 || positionTypeAffected > 0) {
      // On met a jour le updatedAt de la BAL
      await this.baseLocaleService.touch(baseLocale.id);
      // Si la voie a changé
      if (changes.voieId) {
        // On met a jour le updatedAt de la BAL
        await this.voieService.touch(changes.voieId);
        // On recalcule tous les centroid des voies
        await Promise.all(
          voieIds.map((voieId) => this.voieService.calcCentroidAndBbox(voieId)),
        );
        await this.voieService.calcCentroidAndBbox(changes.voieId);
      } else {
        // Sinon on met a jour les updatedAt des voies des numeros
        await Promise.all(
          voieIds.map((voieId) => this.voieService.touch(voieId)),
        );
      }
      // Si on change le toponyme on met a jour son updatedAt
      if (changes.toponymeId) {
        await this.toponymeService.touch(changes.toponymeId);
      }
      // Si les numeros avaient des toponyme, on met a jour leurs updatedAt
      if (toponymeIds.length > 0) {
        await Promise.all(
          toponymeIds.map((toponymeId) =>
            this.toponymeService.touch(toponymeId),
          ),
        );
      }
    }

    return { modifiedCount: affected, changes };
  }

  public async softDeleteBatch(
    baseLocale: BaseLocale,
    { numerosIds }: DeleteBatchNumeroDTO,
  ): Promise<BatchNumeroResponseDTO> {
    // On récupère les différentes voies et toponymes des numeros qu'on va modifier
    const where: FindOptionsWhere<Numero> = {
      id: In(numerosIds),
      balId: baseLocale.id,
    };
    const voieIds: string[] = await this.findDistinct(where, 'voie_id');
    const toponymeIds: string[] = await this.findDistinct(where, 'toponyme_id');
    // On archive les numeros dans postgres
    const { affected }: UpdateResult = await this.numerosRepository.softDelete({
      id: In(numerosIds),
      balId: baseLocale.id,
    });
    // Si des numeros ont été archivés
    if (affected > 0) {
      // On met a jour le updatedAt de la BAL
      await this.baseLocaleService.touch(baseLocale.id);
      // On met a jour les centroid des voies des numeros archivé
      await Promise.all(
        voieIds.map((voidId) => this.voieService.calcCentroidAndBbox(voidId)),
      );
      // Si les numeros avaient des toponyme, on met a jour leurs updatedAt
      if (toponymeIds.length > 0) {
        await Promise.all(
          toponymeIds.map((toponymeId) =>
            this.toponymeService.touch(toponymeId),
          ),
        );
      }
    }

    return { modifiedCount: affected };
  }

  public async deleteBatch(
    baseLocale: BaseLocale,
    { numerosIds }: DeleteBatchNumeroDTO,
  ): Promise<void> {
    // On récupère les différentes voies et toponymes des numeros qu'on va modifier
    const where: FindOptionsWhere<Numero> = {
      id: In(numerosIds),
      balId: baseLocale.id,
    };
    const voieIds: string[] = await this.findDistinct(where, 'voie_id');
    const toponymeIds: string[] = await this.findDistinct(where, 'toponyme_id');
    // On supprime les numero dans postgres
    const { affected }: DeleteResult = await this.numerosRepository.delete({
      id: In(numerosIds),
      balId: baseLocale.id,
    });
    // Si des numeros ont été supprimé
    if (affected > 0) {
      // On met a jour le updatedAt de la BAL
      await this.baseLocaleService.touch(baseLocale.id);
      // On met a jour les updatedAt des voies des numeros archivé
      await Promise.all(
        voieIds.map((voieId) => this.voieService.touch(voieId)),
      );
      // Si les numeros avaient des toponyme, on met a jour leurs updatedAt
      if (toponymeIds.length > 0) {
        await Promise.all(
          toponymeIds.map((toponymeId) =>
            this.toponymeService.touch(toponymeId),
          ),
        );
      }
    }
  }

  public async findCentroidAndBboxVoie(
    voieId: string,
  ): Promise<{ centroid: Point; polygon: Polygon } | undefined> {
    const res: { centroid: string; polygon: string } =
      await this.numerosRepository
        .createQueryBuilder('numeros')
        .select(
          'ST_AsGeoJSON(st_centroid(st_union(positions.point)))',
          'centroid',
        )
        .addSelect(
          'ST_AsGeoJSON(ST_Extent(positions.point::geometry))',
          'polygon',
        )
        .leftJoin('numeros.positions', 'positions')
        .where('numeros.voie_id = :voieId', { voieId })
        .groupBy('numeros.voie_id')
        .getRawOne();
    return (
      res && {
        centroid: JSON.parse(res.centroid),
        polygon: JSON.parse(res.polygon),
      }
    );
  }

  async touch(numero: Numero, updatedAt: Date = new Date()) {
    if (numero.toponymeId) {
      await this.toponymeService.touch(numero.toponymeId, updatedAt);
    }
    await this.voieService.touch(numero.voieId, updatedAt);
    await this.baseLocaleService.touch(numero.balId, updatedAt);
  }
}
