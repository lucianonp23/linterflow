import { Injectable, NestMiddleware, BadRequestException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class InventoryRestockMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    if (req.method !== 'POST' && req.method !== 'PUT') {
      return next();
    }

    const body = req.body;

    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Invalid or missing request body');
    }

    if (!body.itemId || typeof body.itemId !== 'string' || body.itemId.trim().length === 0) {
      throw new BadRequestException('Valid itemId is required');
    }

    if (typeof body.quantity !== 'number' || body.quantity <= 0 || !Number.isInteger(body.quantity)) {
      throw new BadRequestException('Restock quantity must be a positive integer');
    }

    if (body.quantity > 10000) {
      throw new BadRequestException('Restock quantity exceeds maximum allowable batch size of 10000');
    }

    if (typeof body.currentStock === 'number' && typeof body.reorderThreshold === 'number' && body.currentStock > body.reorderThreshold) {
      throw new BadRequestException('Current stock exceeds reorder threshold; restock not required');
    }

    if (!req.headers['x-supplier-id'] && !body.supplierId) {
      throw new BadRequestException('Supplier identifier is required');
    }

    if (req.headers['x-warehouse-status'] === 'MAINTENANCE' || req.headers['x-warehouse-status'] === 'FULL') {
      throw new BadRequestException('Target warehouse is currently not accepting restocks');
    }

    next();
  }
}
