import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import * as hasha from 'hasha';

import {
  Revision,
  Habilitation,
  StatusHabilitationEnum,
  TypeFileEnum,
} from '@/shared/modules/api_depot/api-depot.types';
import {
  BaseLocale,
  StatusBaseLocalEnum,
  StatusSyncEnum,
  BaseLocaleSync,
} from '@/shared/entities/base_locale.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { ApiDepotService } from '@/shared/modules/api_depot/api_depot.service';
import { ExportCsvService } from '@/shared/modules/export_csv/export_csv.service';
import { getApiUrl, getEditorUrl } from '@/shared/utils/mailer.utils';

@Injectable()
export class PublicationService {
  constructor(
    private readonly apiDepotService: ApiDepotService,
    private readonly exportCsvService: ExportCsvService,
    private readonly mailerService: MailerService,
    @InjectRepository(BaseLocale)
    private basesLocalesRepository: Repository<BaseLocale>,
    @InjectRepository(Numero)
    private numerosRepository: Repository<Numero>,
    private configService: ConfigService,
  ) {}

  async exec(
    balId: string,
    options: { force?: boolean } = {},
  ): Promise<BaseLocale> {
    const baseLocale = await this.basesLocalesRepository.findOneBy({
      id: balId,
    });

    // On vérifie que la BAL n'est pas en DEMO ou DRAFT
    if (baseLocale.status === StatusBaseLocalEnum.DEMO) {
      throw new HttpException(
        'La synchronisation pas possibles pour les Bases Adresses Locales de démo',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    const codeCommune = baseLocale.commune;

    // On vérifie que la BAL a une habilitation rattachée
    if (!baseLocale.habilitationId) {
      await this.pause(balId);
      throw new HttpException(
        'Aucune habilitation rattachée à cette Base Adresse Locale',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // On récupère l'habilitation sur l'api-depot
    let habilitation: Habilitation;
    try {
      habilitation = await this.apiDepotService.findOneHabiliation(
        baseLocale.habilitationId,
      );
    } catch (err) {
      // Si l'habilitation est introuvable sur l'API dépot on met la BAL en pause
      if (err.status === HttpStatus.NOT_FOUND) {
        await this.pause(balId);
      }
      throw err;
    }

    // On verifie que l'habilitation est valide
    if (habilitation.status !== StatusHabilitationEnum.ACCEPTED) {
      await this.pause(balId);
      throw new HttpException(
        'L’habilitation rattachée n’est pas une habilitation valide',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // On verifie que l'habilitation n'est pas expirée
    if (
      !habilitation.expiresAt ||
      new Date(habilitation.expiresAt) < new Date()
    ) {
      await this.pause(balId);
      throw new HttpException(
        'L’habilitation rattachée a expiré',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // On récupère le nombre de numeros de la BAL
    const numeroCount = await this.numerosRepository.countBy({
      balId,
      deletedAt: null,
    });
    // On vérifie qu'il y ai au moins un numero dans la BAL
    if (numeroCount === 0) {
      throw new HttpException(
        'La base locale ne possède aucune adresse',
        HttpStatus.PRECONDITION_FAILED,
      );
    }
    // On traite ensuite le cas de la première publication
    if (baseLocale.status === StatusBaseLocalEnum.DRAFT) {
      // On créer le fichier BAL CSV
      const file: string = await this.exportCsvService.exportToCsv(baseLocale);
      // On créer la publication sur l'api-depot
      const publishedRevision: Revision =
        await this.apiDepotService.publishNewRevision(
          codeCommune,
          baseLocale.id,
          file,
          baseLocale.habilitationId,
        );

      // SEND MAIL
      const editorUrl = getEditorUrl(baseLocale);
      const apiUrl = getApiUrl();
      await this.mailerService.sendMail({
        to: baseLocale.emails,
        subject: 'Publication de votre Base Adresse Locale',
        template: 'bal-publication-notification',
        bcc: this.configService.get('SMTP_BCC'),
        context: {
          baseLocale,
          codeCommune,
          editorUrl,
          apiUrl,
        },
      });

      return this.markAsSynced(baseLocale, publishedRevision.id);
    }

    const sync = await this.updateSyncInfo(baseLocale);

    // On traite les BAL dont le sync est en conflit ou outdated
    if (
      (sync.status === StatusSyncEnum.CONFLICT && options.force) ||
      sync.status === StatusSyncEnum.OUTDATED
    ) {
      // On créer le fichier BAL CSV
      const file: string = await this.exportCsvService.exportToCsv(baseLocale);
      // ON créer le hash du fichier BAL CSV
      const hash = hasha(file, { algorithm: 'sha256' });
      // On récupère la révision courante pour la commune
      const currentRevision =
        await this.apiDepotService.getCurrentRevision(codeCommune);
      // On récupère le fichier BAL de la révision courante
      const currentRevisionBalFile = currentRevision?.files.find(
        (f) => f.type === TypeFileEnum.BAL,
      );
      // On traite si le hash du fichier BAL CSV est différent du fichier de la révision courante
      // Cela veut dire qu'il y a eu un changement dans le fichier
      if (currentRevisionBalFile?.hash !== hash) {
        // On créer la publication sur l'api-depot
        const publishedRevision = await this.apiDepotService.publishNewRevision(
          codeCommune,
          baseLocale.id,
          file,
          baseLocale.habilitationId,
        );
        // On marque le sync de la BAL en published
        return this.markAsSynced(baseLocale, publishedRevision.id);
      }

      // On marque le sync de la BAL en published
      return this.markAsSynced(baseLocale, sync.lastUploadedRevisionId);
    }

    return this.basesLocalesRepository.findOneBy({ id: balId });
  }

  public async pause(balId: string) {
    return this.setIsPaused(balId, true);
  }

  public async resume(balId: string) {
    return this.setIsPaused(balId, false);
  }

  private async setIsPaused(balId: string, isPaused: boolean): Promise<void> {
    await this.basesLocalesRepository
      .createQueryBuilder('bases_locales')
      .update(BaseLocale)
      .set({
        sync: () => `sync || '{"isPaused": ${isPaused}}'`,
      })
      .where({ id: balId })
      .execute();
  }

  private async updateSync(
    baseLocale: BaseLocale,
    syncChanges: Partial<BaseLocaleSync>,
  ): Promise<BaseLocaleSync> {
    const changes: Partial<BaseLocale> = {
      sync: {
        ...baseLocale.sync,
        ...syncChanges,
      },
      ...(syncChanges.status === StatusSyncEnum.CONFLICT && {
        status: StatusBaseLocalEnum.REPLACED,
      }),
    };

    await this.basesLocalesRepository.update(
      {
        id: baseLocale.id,
      },
      changes,
    );

    return changes.sync;
  }

  private async markAsSynced(
    baseLocale: BaseLocale,
    lastUploadedRevisionId: string,
  ) {
    const now = new Date();
    const sync: BaseLocaleSync = {
      status: StatusSyncEnum.SYNCED,
      isPaused: false,
      currentUpdated: now,
      lastUploadedRevisionId,
    };

    await this.basesLocalesRepository.update(
      { id: baseLocale.id },
      {
        status: StatusBaseLocalEnum.PUBLISHED,
        sync,
        updatedAt: () => `'${now.toISOString()}'`,
      },
    );

    return this.basesLocalesRepository.findOneBy({ id: baseLocale.id });
  }

  private async updateSyncInfo(
    baseLocale: BaseLocale,
  ): Promise<BaseLocaleSync> {
    // Si le status de la BAL est différent de PUBLISHED on retourne sync
    if (baseLocale.status !== StatusBaseLocalEnum.PUBLISHED) {
      return baseLocale.sync;
    }

    // On vérifie que le status est synced ou outdated
    if (
      !baseLocale.sync ||
      (baseLocale.sync.status !== StatusSyncEnum.SYNCED &&
        baseLocale.sync.status !== StatusSyncEnum.OUTDATED)
    ) {
      throw new HttpException(
        'Le statut de synchronisation doit être "synced" ou "outdated"',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // On récupère la révision courante de l'api-depot
    const currentRevision = await this.apiDepotService.getCurrentRevision(
      baseLocale.commune,
    );

    // On vérifie si la dernière publication de la BAL est la révision courante
    if (
      currentRevision?.id !== baseLocale.sync.lastUploadedRevisionId.toString()
    ) {
      return this.updateSync(baseLocale, {
        status: StatusSyncEnum.CONFLICT,
        isPaused: true,
      });
    }

    // Si la date du changement de BAL est la même que la date du currentUpdated du sync de la BAL
    // On met le status du sync de la BAL a sync et on le retourne

    if (baseLocale.updatedAt === baseLocale.sync.currentUpdated) {
      if (baseLocale.sync.status === StatusSyncEnum.SYNCED) {
        return baseLocale.sync;
      }

      return this.updateSync(baseLocale, {
        status: StatusSyncEnum.SYNCED,
      });
    }

    // Si le status du sync est outdated on retourne sync
    if (baseLocale.sync.status === StatusSyncEnum.OUTDATED) {
      return baseLocale.sync;
    }

    // Sinon on set le status de sync à outdated
    return this.updateSync(baseLocale, {
      status: StatusSyncEnum.OUTDATED,
    });
  }
}
