-- AlterTable
ALTER TABLE "tokens_atualizacao" ADD COLUMN     "geoCidade" TEXT,
ADD COLUMN     "geoPais" TEXT,
ADD COLUMN     "geoRegiao" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "userAgent" TEXT;
