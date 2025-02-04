import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  BaseLocale,
  StatusSyncEnum,
  StatusBaseLocalEnum,
} from '@/shared/entities/base_locale.entity';
import { ApiDepotService } from '@/shared/modules/api_depot/api_depot.service';
import { Revision } from '@/shared/modules/api_depot/api-depot.types';

import { Task } from '../task_queue.class';
import { CacheService } from '@/shared/modules/cache/cache.service';

export const KEY_DETECT_CONFLICT_PUBLISHED_SINCE =
  'detectConflictPublishedSince';

@Injectable()
export class DetectConflictTask implements Task {
  title: string = 'Detect conflict';

  constructor(
    private readonly apiDepotService: ApiDepotService,
    @InjectRepository(BaseLocale)
    private basesLocalesRepository: Repository<BaseLocale>,
    private cacheService: CacheService,
    private readonly logger: Logger,
  ) {}

  public async run() {
    const futurePublishedSince = new Date();
    const cache = await this.cacheService.get(
      KEY_DETECT_CONFLICT_PUBLISHED_SINCE,
    );
    const detectConflictPublishedSince = new Date(cache?.value || '1970-01-01');
    this.logger.log(
      `Detect conflict since : ${detectConflictPublishedSince}`,
      DetectConflictTask.name,
    );
    const currentRevisions: Revision[] =
      await this.apiDepotService.getCurrentRevisions(
        detectConflictPublishedSince,
      );
    this.logger.log(
      `Number of current revisions processed : ${currentRevisions.length}`,
      DetectConflictTask.name,
    );
    const revisedCommunes = currentRevisions.map((r) => r.codeCommune);

    await this.cacheService.set(
      KEY_DETECT_CONFLICT_PUBLISHED_SINCE,
      futurePublishedSince.toISOString(),
    );

    for (const codeCommune of revisedCommunes) {
      try {
        await this.updateConflictStatus(codeCommune);
      } catch (error) {
        this.logger.error(
          `Unable to detect conflict for ${codeCommune}`,
          error,
          DetectConflictTask.name,
        );
      }
    }
  }

  private async updateConflictStatus(codeCommune: string) {
    const basesLocales = await this.basesLocalesRepository.findBy({
      commune: codeCommune,
      status: In([StatusBaseLocalEnum.REPLACED, StatusBaseLocalEnum.PUBLISHED]),
    });

    if (basesLocales.length === 0) {
      return;
    }

    const currentRevision: Revision =
      await this.apiDepotService.getCurrentRevision(codeCommune);

    if (!currentRevision) {
      this.logger.error(
        `Comportement inattendu : pas de révision courante pour la commune ${codeCommune}`,
        null,
        DetectConflictTask.name,
      );
      return;
    }

    for (const baseLocale of basesLocales) {
      if (currentRevision.id === baseLocale.sync.lastUploadedRevisionId) {
        await this.basesLocalesRepository
          .createQueryBuilder('bases_locales')
          .update(BaseLocale)
          .set({
            status: StatusBaseLocalEnum.PUBLISHED,
            sync: () => `sync || '{"status": "${StatusSyncEnum.SYNCED}"}'`,
          })
          .where({ id: baseLocale.id, status: StatusBaseLocalEnum.REPLACED })
          .execute();
      } else {
        await this.basesLocalesRepository
          .createQueryBuilder('bases_locales')
          .update(BaseLocale)
          .set({
            status: StatusBaseLocalEnum.REPLACED,
            sync: () => `sync || '{"status": "${StatusSyncEnum.CONFLICT}"}'`,
          })
          .where({ id: baseLocale.id, status: StatusBaseLocalEnum.PUBLISHED })
          .execute();
      }
    }
  }
}
