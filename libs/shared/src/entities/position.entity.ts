import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  Point,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseLocale } from './base_locale.entity';
import { Numero } from './numero.entity';
import { Toponyme } from './toponyme.entity';

export enum PositionTypeEnum {
  ENTREE = 'entrée',
  BATIMENT = 'bâtiment',
  CAGE_ESCALIER = 'cage d’escalier',
  LOGEMENT = 'logement',
  SERVICE_TECHNIQUE = 'service technique',
  DELIVRANCE_POSTALE = 'délivrance postale',
  PARCELLE = 'parcelle',
  SEGMENT = 'segment',
  INCONNUE = 'inconnue',
}

@Entity({ name: 'positions' })
export class Position {
  @ApiProperty()
  @PrimaryGeneratedColumn()
  id: number;

  @ApiProperty()
  @Column('text', { name: 'bal_id', nullable: false })
  balId: string;

  @ApiProperty()
  @Column('text', { name: 'toponyme_id', nullable: true })
  toponymeId: string;

  @ApiProperty()
  @Column('text', { name: 'numero_id', nullable: true })
  numeroId: string;

  @ApiProperty({ enum: PositionTypeEnum })
  @Column('enum', {
    enum: PositionTypeEnum,
    default: PositionTypeEnum.ENTREE,
    nullable: false,
  })
  type: PositionTypeEnum;

  @ApiProperty()
  @Column('text', { nullable: true })
  source?: string;

  @ApiProperty()
  @Column('geometry', { nullable: false, spatialFeatureType: 'Point' })
  point: Point;

  @ManyToOne(() => Toponyme, (toponyme) => toponyme.positions)
  @JoinColumn({ name: 'toponyme_id' })
  toponyme: Toponyme;

  @ManyToOne(() => Numero, (numero) => numero.positions)
  @JoinColumn({ name: 'numero_id' })
  numero: Numero;

  @ManyToOne(() => BaseLocale, (baseLocale) => baseLocale.positions)
  @JoinColumn({ name: 'bal_id' })
  baseLocale: BaseLocale;
}
