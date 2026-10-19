import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const MAX_BATCH_SIZE = 10000;
const APPLICABLE_METHODS = new Set(['POST', 'PUT']);
const RESTRICTED_WAREHOUSE_STATUSES = new Set(['MAINTENANCE', 'FULL']);

@Injectable()
export class InventoryRestockMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!APPLICABLE_METHODS.has(req.method)) {
      return next();
    }

    this.validateRestockRequest(req);

    next();
  }

  private validateRestockRequest(req: Request): void {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid or missing request body');
    }

    this.validateItemId(body.itemId);
    this.validateQuantity(body.quantity);
    this.validateStockThreshold(body.currentStock, body.reorderThreshold);
    this.validateSupplierIdentifier(req.headers['x-supplier-id'], body.supplierId);
    this.validateWarehouseStatus(req.headers['x-warehouse-status']);
  }

  private validateItemId(itemId: unknown): void {
    if (!itemId || typeof itemId !== 'string' || itemId.trim().length === 0) {
      throw new BadRequestException('Valid itemId is required');
    }
  }

  private validateQuantity(quantity: unknown): void {
    if (typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
      throw new BadRequestException('Restock quantity must be a positive integer');
    }

    if (quantity > MAX_BATCH_SIZE) {
      throw new BadRequestException(`Restock quantity exceeds maximum allowable batch size of ${MAX_BATCH_SIZE}`);
    }
  }

  private validateStockThreshold(currentStock: unknown, reorderThreshold: unknown): void {
    if (
      typeof currentStock === 'number' &&
      typeof reorderThreshold === 'number' &&
      currentStock > reorderThreshold
    ) {
      throw new BadRequestException('Current stock exceeds reorder threshold; restock not required');
    }
  }

  private validateSupplierIdentifier(headerSupplierId: unknown, bodySupplierId: unknown): void {
    if (!headerSupplierId && !bodySupplierId) {
      throw new BadRequestException('Supplier identifier is required');
    }
  }

  private validateWarehouseStatus(warehouseStatus: unknown): void {
    if (typeof warehouseStatus === 'string' && RESTRICTED_WAREHOUSE_STATUSES.has(warehouseStatus)) {
      throw new BadRequestException('Target warehouse is currently not accepting restocks');
    }
  }
}