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

const DEFAULT_CATEGORY = 'general';
const HEADER_QUOTE_CATEGORY = 'x-quote-category';
const HEADER_FILTER_FAVORITE = 'x-filter-favorite';
const HEADER_PROCESSED_AT = 'X-Quote-Processed-At';
const HEADER_CATEGORY_ASSIGNED = 'X-Quote-Category-Assigned';
const QUERY_IS_FAVORITE = 'isFavorite';

@Injectable()
export class FavoriteQuotesMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const normalizedCategory = this.extractNormalizedCategory(req);
    const hasFavoriteFilter = this.extractFavoriteFilter(req);
    const processedAt = new Date().toISOString();

    req.quoteMetadata = {
      processedAt,
      normalizedCategory,
      hasFavoriteFilter,
    };

    res.setHeader(HEADER_PROCESSED_AT, processedAt);
    res.setHeader(HEADER_CATEGORY_ASSIGNED, normalizedCategory);

    next();
  }

  private extractNormalizedCategory(req: Request): string {
    const rawCategory = req.headers[HEADER_QUOTE_CATEGORY];
    const categoryString = Array.isArray(rawCategory) ? rawCategory[0] : rawCategory;
    return (categoryString || DEFAULT_CATEGORY).trim().toLowerCase();
  }

  private extractFavoriteFilter(req: Request): boolean {
    const rawFavoriteFilter = req.query[QUERY_IS_FAVORITE] || req.headers[HEADER_FILTER_FAVORITE];
    return String(rawFavoriteFilter).toLowerCase() === 'true';
  }
}