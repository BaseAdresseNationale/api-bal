import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Numero } from '@/modules/numeros/schema/numero.schema';
import { BaseLocale } from '@/modules/base_locale/schema/base_locale.schema';

@Injectable()
export class NumeroMiddleware implements NestMiddleware {
  constructor(
    @InjectModel(Numero.name) private numeroModel: Model<Numero>,
    @InjectModel(BaseLocale.name) private baseLocaleModel: Model<BaseLocale>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const { numeroId } = req.params;
    if (numeroId) {
      const numero: Numero = await this.numeroModel
        .findOne({ _id: numeroId })
        .exec();
      res.locals.numero = numero;
      const basesLocale: BaseLocale = await this.baseLocaleModel
        .findOne({ _id: numero._bal })
        .select({ token: 1 })
        .exec();
      res.locals.isAdmin = req.headers.token === basesLocale.token;
    }
    next();
  }
}
