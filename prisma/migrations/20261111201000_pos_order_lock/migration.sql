-- CreateTable
CREATE TABLE "PosOrderLock" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosOrderLock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosOrderLock_shop_orderId_idx" ON "PosOrderLock"("shop", "orderId");
