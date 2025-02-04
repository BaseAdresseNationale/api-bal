import {
  Strategy,
  Habilitation,
  StatusHabilitationEnum,
  TypeStrategyEnum,
} from '@/shared/modules/api_depot/api-depot.types';
import { ApiProperty } from '@nestjs/swagger';

export class StrategyDTO {
  @ApiProperty({ enum: TypeStrategyEnum })
  type: TypeStrategyEnum;

  @ApiProperty()
  pinCode: string;

  @ApiProperty()
  pinCodeExpiration: Date;

  @ApiProperty()
  remainingAttempts: number;

  @ApiProperty()
  createdAt: Date;
}

export class HabilitationDTO implements Habilitation {
  @ApiProperty()
  id: string;

  @ApiProperty()
  codeCommune: string;

  @ApiProperty()
  emailCommune: string;

  @ApiProperty()
  franceconnectAuthenticationUrl?: string;

  @ApiProperty({ type: () => StrategyDTO })
  strategy?: Strategy;

  @ApiProperty()
  client?: string;

  @ApiProperty({ enum: StatusHabilitationEnum })
  status: StatusHabilitationEnum;

  @ApiProperty()
  createdAt?: Date;

  @ApiProperty()
  updatedAt?: Date;

  @ApiProperty()
  expiresAt?: Date;
}
