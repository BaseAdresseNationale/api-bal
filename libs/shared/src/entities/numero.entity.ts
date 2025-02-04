import { ApiProperty } from '@nestjs/swagger';
import {
  AfterLoad,
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { GlobalEntity } from './global.entity';
import { BaseLocale } from './base_locale.entity';
import { Voie } from './voie.entity';
import { Toponyme } from './toponyme.entity';
import { Position } from './position.entity';

export function displaySuffix(numero: Numero): string {
  if (numero.suffixe) {
    if (numero.suffixe.trim().match(/^\d/)) {
      return '-' + numero.suffixe.trim();
    }
    return numero.suffixe.trim();
  }
  return '';
}

@Entity({ name: 'numeros' })
export class Numero extends GlobalEntity {
  @Index('IDX_numeros_bal_id')
  @ApiProperty()
  @Column('varchar', { length: 24, name: 'bal_id', nullable: false })
  balId: string;

  @Index('IDX_numeros_voie_id')
  @ApiProperty()
  @Column('varchar', { length: 24, name: 'voie_id', nullable: false })
  voieId: string;

  @Index('IDX_numeros_toponyme_id')
  @ApiProperty()
  @Column('varchar', { length: 24, name: 'toponyme_id', nullable: true })
  toponymeId: string;

  @ApiProperty()
  @Column('int', { nullable: false })
  numero: number;

  @ApiProperty()
  @Column('text', { nullable: true })
  suffixe?: string | null;

  @ApiProperty()
  numeroComplet: string;

  @ApiProperty()
  @Column('text', { nullable: true })
  comment?: string | null;

  @ApiProperty()
  @Column('text', { nullable: true, array: true })
  parcelles?: string[] | null;

  @ApiProperty()
  @Column('boolean', { nullable: false, default: false })
  certifie?: boolean;

  @ApiProperty()
  @Column('varchar', {
    name: 'commune_deleguee',
    default: null,
    nullable: true,
    length: 5,
  })
  communeDeleguee: string | null;

  @ApiProperty({ type: () => Position, isArray: true })
  @OneToMany(() => Position, (position) => position.numero, {
    eager: true,
    cascade: true,
  })
  positions?: Position[];

  @BeforeInsert()
  @BeforeUpdate()
  setRankPosition?() {
    for (let i = 0; i < this?.positions?.length; i++) {
      this.positions[i].rank = i;
    }
  }

  @AfterLoad()
  sortPositions?() {
    if (this?.positions?.length) {
      this.positions.sort((a, b) => a.rank - b.rank);
    }
  }

  @ApiProperty({ type: () => BaseLocale })
  @ManyToOne(() => BaseLocale, (baseLocale) => baseLocale.numeros, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bal_id' })
  baseLocale?: BaseLocale;

  @ApiProperty({ type: () => Voie })
  @ManyToOne(() => Voie, (voie) => voie.numeros, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'voie_id' })
  voie?: Voie;

  @ApiProperty({ type: () => Toponyme })
  @ManyToOne(() => Toponyme, (toponyme) => toponyme.numeros)
  @JoinColumn({ name: 'toponyme_id' })
  toponyme?: Toponyme;

  @AfterLoad()
  getNumeroComplet?() {
    this.numeroComplet = this.numero + ' ' + displaySuffix(this);
  }
}
