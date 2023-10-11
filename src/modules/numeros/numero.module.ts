import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Numero, NumeroSchema } from './schema/numero.schema';
import {
  BaseLocale,
  BaseLocaleSchema,
} from '@/modules/base_locale/schema/base_locale.schema';
import { NumeroService } from './numero.service';
import { NumeroController } from './numero.controller';
import { NumeroMiddleware } from '@/lib/middlewares/numero.middleware';
import { TilesSchemaMiddleware } from './schema/tiles.schema.middleware';
import { TilesService } from '@/lib/services/tiles.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Numero.name, schema: NumeroSchema },
      { name: BaseLocale.name, schema: BaseLocaleSchema },
    ]),
  ],
  providers: [
    NumeroService,
    NumeroMiddleware,
    TilesSchemaMiddleware,
    TilesService,
  ],
  controllers: [NumeroController],
})
export class NumeroModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(NumeroMiddleware)
      .forRoutes({ path: 'numeros/:numeroId', method: RequestMethod.ALL });
  }
}
