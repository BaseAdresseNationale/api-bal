import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommuneDelegueeToNumeroAndToponyme1736862153738
  implements MigrationInterface
{
  name = 'AddCommuneDelegueeToNumeroAndToponyme1736862153738';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "toponymes" ADD "commune_deleguee" character varying(5)`,
    );
    await queryRunner.query(
      `ALTER TABLE "numeros" ADD "commune_deleguee" character varying(5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "numeros" DROP COLUMN "commune_deleguee"`,
    );
    await queryRunner.query(
      `ALTER TABLE "toponymes" DROP COLUMN "commune_deleguee"`,
    );
  }
}
