-- AlterTable: 期限付きオフラインアクセストークン用（Shopify 公式推奨）
ALTER TABLE "Session" ADD COLUMN "refreshToken" TEXT;
ALTER TABLE "Session" ADD COLUMN "refreshTokenExpires" DATETIME;
