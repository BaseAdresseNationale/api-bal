import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  BaseLocale,
  BaseLocaleSchema,
} from '@/shared/schemas/base_locale/base_locale.schema';
import { Numero, NumeroSchema } from '@/shared/schemas/numero/numero.schema';
import { Voie, VoieSchema } from '@/shared/schemas/voie/voie.schema';
import {
  Toponyme,
  ToponymeSchema,
} from '@/shared/schemas/toponyme/toponyme.schema';
import { ApiDepotModule } from '@/shared/modules/api_depot/api_depot.module';
import { ExportCsvModule } from '@/shared/modules/export_csv/export_csv.module';
import { ExportCsvService } from '@/shared/modules/export_csv/export_csv.service';
import { MailerModule } from '@/shared/modules/mailer/mailer.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: BaseLocale.name, schema: BaseLocaleSchema },
      { name: Numero.name, schema: NumeroSchema },
      { name: Voie.name, schema: VoieSchema },
      { name: Toponyme.name, schema: ToponymeSchema },
    ]),
    ApiDepotModule,
    ExportCsvModule,
    MailerModule,
  ],
  providers: [ExportCsvService],
  exports: [ExportCsvService],
})
export class PublicationModule {}
