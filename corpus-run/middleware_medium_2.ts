import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const RESTOCK_METHODS = new Set(['POST', 'PUT']);
const BLOCKED_WAREHOUSE_STATUSES = new Set(['MAINTENANCE', 'FULL']);

type RequestValidator = (req: Request) => void;

function validateBody(req: Request): void {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    throw new BadRequestException('Invalid or missing request body');
  }
}

function validateItemId(req: Request): void {
  const { itemId } = req.body;
  if (!itemId || typeof itemId !== 'string' || itemId.trim().length === 0) {
    throw new BadRequestException('Valid itemId is required');
  }
}

function validateQuantity(req: Request): void {
  const { quantity } = req.body;
  if (typeof quantity !== 'number' || quantity <= 0 || !Number.isInteger(quantity)) {
    throw new BadRequestException('Restock quantity must be a positive integer');
  }
}

function validateBatchSize(req: Request): void {
  if (req.body.quantity > 10000) {
    throw new BadRequestException('Restock quantity exceeds maximum allowable batch size of 10000');
  }
}

function validateStockThreshold(req: Request): void {
  const { currentStock, reorderThreshold } = req.body;
  if (typeof currentStock === 'number' && typeof reorderThreshold === 'number' && currentStock > reorderThreshold) {
    throw new BadRequestException('Current stock exceeds reorder threshold; restock not required');
  }
}

function validateSupplier(req: Request): void {
  if (!req.headers['x-supplier-id'] && !req.body.supplierId) {
    throw new BadRequestException('Supplier identifier is required');
  }
}

function validateWarehouseStatus(req: Request): void {
  const status = req.headers['x-warehouse-status'];
  if (BLOCKED_WAREHOUSE_STATUSES.has(status as string)) {
    throw new BadRequestException('Target warehouse is currently not accepting restocks');
  }
}

const VALIDATORS: RequestValidator[] = [
  validateBody,
  validateItemId,
  validateQuantity,
  validateBatchSize,
  validateStockThreshold,
  validateSupplier,
  validateWarehouseStatus,
];

@Injectable()
export class InventoryRestockMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (!RESTOCK_METHODS.has(req.method)) {
      return next();
    }

    for (const validate of VALIDATORS) {
      validate(req);
    }

    next();
  }
}