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
import { Numero } from './numero.entity';
import { Position } from './position.entity';

@Entity({ name: 'toponymes' })
export class Toponyme extends GlobalEntity {
  @Index('IDX_toponymes_bal_id')
  @ApiProperty()
  @Column('varchar', { length: 24, name: 'bal_id', nullable: false })
  balId: string;

  @ApiProperty()
  @Column('text', { nullable: false })
  nom: string;

  @ApiProperty()
  @Column('json', { name: 'nom_alt', nullable: true })
  nomAlt: Record<string, string> | null;

  @ApiProperty()
  @Column('varchar', {
    name: 'commune_deleguee',
    default: null,
    nullable: true,
    length: 5,
  })
  communeDeleguee: string | null;

  @ApiProperty()
  @Column('text', { nullable: true, array: true })
  parcelles?: string[] | null;

  @ApiProperty({ type: () => Position, isArray: true })
  @OneToMany(() => Position, (position) => position.toponyme, {
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
  @ManyToOne(() => BaseLocale, (baseLocale) => baseLocale.toponymes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'bal_id' })
  baseLocale?: BaseLocale;

  @ApiProperty({ type: () => Numero, isArray: true })
  @OneToMany(() => Numero, (numero) => numero.toponyme)
  numeros?: Numero[];
}
