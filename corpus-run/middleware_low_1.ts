import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export interface QuoteRequestMetadata {
  processedAt: string;
  normalizedCategory: string;
  hasFavoriteFilter: boolean;
}

declare global {
  namespace Express {
    interface Request {
      quoteMetadata?: QuoteRequestMetadata;
    }
  }
}

@Injectable()
export class FavoriteQuotesMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawCategory = req.headers['x-quote-category'];
    const categoryString = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
    const normalizedCategory = (categoryString || 'general').trim().toLowerCase();

    const rawFavoriteFilter = req.query['isFavorite'] || req.headers['x-filter-favorite'];
    const hasFavoriteFilter = String(rawFavoriteFilter).toLowerCase() === 'true';

    req.quoteMetadata = {
      processedAt: new Date().toISOString(),
      normalizedCategory,
      hasFavoriteFilter,
    };

    res.setHeader('X-Quote-Processed-At', req.quoteMetadata.processedAt);
    res.setHeader('X-Quote-Category-Assigned', normalizedCategory);

    next();
  }
}
