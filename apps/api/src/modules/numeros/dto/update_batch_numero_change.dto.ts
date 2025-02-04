import { ApiProperty } from '@nestjs/swagger';
import {
  MaxLength,
  IsOptional,
  IsEnum,
  IsNotEmpty,
  IsMongoId,
  ValidateIf,
  Validate,
} from 'class-validator';

import { PositionTypeEnum } from '@/shared/entities/position.entity';
import { ValidatorCogCommune } from '@/shared/validators/cog.validator';
import { ValidatorBal } from '@/shared/validators/validator_bal.validator';

export class UpdateBatchNumeroChangeDTO {
  @IsOptional()
  @MaxLength(5000)
  @ApiProperty({ required: false, nullable: true })
  comment?: string;

  @IsOptional()
  @IsMongoId()
  @ApiProperty({ type: String, required: false, nullable: true })
  toponymeId?: string;

  @IsMongoId()
  @ValidateIf((object, value) => {
    return value !== undefined;
  })
  @ApiProperty({ type: String, required: false, nullable: false })
  voieId?: string;

  @IsOptional()
  @IsNotEmpty()
  @IsEnum(PositionTypeEnum)
  @Validate(ValidatorBal, ['position'])
  @ApiProperty({ required: false, nullable: false })
  positionType?: PositionTypeEnum;

  @IsOptional()
  @IsNotEmpty()
  @ApiProperty({ required: false, nullable: false })
  certifie?: boolean;

  @IsOptional()
  @Validate(ValidatorCogCommune, ['commune_deleguee'])
  @ApiProperty({ required: false, nullable: false })
  communeDeleguee?: string | null;
}
