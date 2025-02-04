import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import {
  Habilitation,
  StatusHabilitationEnum,
} from '@/shared/modules/api_depot/api-depot.types';
import { ApiDepotService } from '@/shared/modules/api_depot/api_depot.service';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { BaseLocaleService } from '../../base_locale.service';

@Injectable()
export class HabilitationService {
  constructor(
    private readonly baseLocaleService: BaseLocaleService,
    private readonly apiDepotService: ApiDepotService,
    private readonly logger: Logger,
  ) {}

  async findOne(habilitationId: string): Promise<Habilitation> {
    if (!ObjectId.isValid(habilitationId)) {
      throw new HttpException(
        'L’identifiant de l’habilitation est invalide',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.apiDepotService.findOneHabiliation(habilitationId);
    } catch (error) {
      this.logger.error(
        `Impossible de trouver l'habilitation ${habilitationId}`,
        error.response?.data || 'No server response',
        HabilitationService.name,
      );
      throw new HttpException(
        (error.response?.data as any).message || 'No server response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async isValid(habilitationId: string): Promise<boolean> {
    let habilitation: Habilitation;

    if (!ObjectId.isValid(habilitationId)) {
      throw new HttpException(
        'L’identifiant de l’habilitation est invalide',
        HttpStatus.NOT_FOUND,
      );
    }

    try {
      habilitation =
        await this.apiDepotService.findOneHabiliation(habilitationId);
    } catch (error) {
      this.logger.error(
        `Impossible de trouver l'habilitation ${habilitationId}`,
        error.response?.data || 'No server response',
        HabilitationService.name,
      );
      throw new HttpException(
        (error.response?.data as any).message || 'No server response',
        HttpStatus.BAD_GATEWAY,
      );
    }

    // On verifie que l'habilitation est valide
    if (habilitation.status !== StatusHabilitationEnum.ACCEPTED) {
      return false;
    }
    // On verifie que l'habilitation n'est pas expirée
    if (
      !habilitation.expiresAt ||
      new Date(habilitation.expiresAt) < new Date()
    ) {
      return false;
    }
    return true;
  }

  async createOne(baseLocale: BaseLocale): Promise<Habilitation> {
    if (baseLocale.habilitationId) {
      const habilitation = await this.findOne(baseLocale.habilitationId);

      const now = new Date();
      const { status, expiresAt } = habilitation;

      if (
        status === StatusHabilitationEnum.ACCEPTED &&
        new Date(expiresAt) > now
      ) {
        throw new HttpException(
          'Cette Base Adresse Locale possède déjà une habilitation',
          HttpStatus.PRECONDITION_FAILED,
        );
      }
    }
    let habilitation: Habilitation;
    try {
      habilitation =
        await this.apiDepotService.createOneHabiliation(baseLocale);
    } catch (error) {
      this.logger.error(
        `Impossible de créer une habilitation pour la commune ${baseLocale.commune}`,
        error.response?.data || 'No server response',
        HabilitationService.name,
      );
      throw new HttpException(
        (error.response?.data as any).message || 'No server response',
        HttpStatus.BAD_GATEWAY,
      );
    }

    await this.baseLocaleService.updateHabilitation(baseLocale, habilitation);

    return habilitation;
  }

  async sendPinCode(habilitationId: string): Promise<void> {
    const habilitation: Habilitation = await this.findOne(habilitationId);
    if (habilitation.status !== StatusHabilitationEnum.PENDING) {
      throw new HttpException(
        'Aucune demande d’habilitation en attente',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    try {
      await this.apiDepotService.sendPinCodeHabiliation(habilitationId);
    } catch (error) {
      this.logger.error(
        `Impossible d'envoyer le code pour l'habilitation ${habilitationId}`,
        error.response?.data || 'No server response',
        HabilitationService.name,
      );
      throw new HttpException(
        (error.response?.data as any).message || 'No server response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  async validatePinCode(habilitationId: string, code: string): Promise<any> {
    const habilitation: Habilitation = await this.findOne(habilitationId);

    if (habilitation.status !== StatusHabilitationEnum.PENDING) {
      throw new HttpException(
        'Aucune demande d’habilitation en attente',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    try {
      const data = await this.apiDepotService.validatePinCodeHabiliation(
        habilitationId,
        code,
      );
      return data;
    } catch (error) {
      this.logger.error(
        `Impossible de valider le code pour l'habilitation ${habilitationId}`,
        error.response?.data || 'No server response',
        HabilitationService.name,
      );
      throw new HttpException(
        (error.response?.data as any).message || 'No server response',
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
