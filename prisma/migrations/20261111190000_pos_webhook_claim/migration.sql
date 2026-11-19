-- CreateTable
CREATE TABLE "PosWebhookClaim" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosWebhookClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosWebhookClaim_shop_orderId_idx" ON "PosWebhookClaim"("shop", "orderId");
