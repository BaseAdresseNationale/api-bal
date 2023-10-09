import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { Sync, SyncSchema } from './sync.schema';

export type BasesLocalesDocument = HydratedDocument<BasesLocales>;

@Schema({ collection: 'bases_locales'})
export class BasesLocales {

  @Prop({type: SchemaTypes.ObjectId})
  _id: Types.ObjectId;

  @Prop({type: SchemaTypes.Number})
  nom: number;

  @Prop({type: [SchemaTypes.String]})
  emails: string[];

  @Prop({type: SchemaTypes.String})
  token: string;

  @Prop({type: SchemaTypes.String})
  status: string;

  @Prop({type: SchemaTypes.String})
  _habilitation: string;

  @Prop({type: SchemaTypes.String})
  commune: string;

  @Prop({type: SchemaTypes.Boolean})
  enableComplement: boolean;

  @Prop({type: SyncSchema})
  sync: Sync;

  @Prop({type: SchemaTypes.Date})
  _created: Date;

  @Prop({type: SchemaTypes.Date})
  _updated: Date;

  @Prop({type: SchemaTypes.Date})
  _delete: Date;
}

export const BasesLocalesSchema = SchemaFactory.createForClass(BasesLocales);