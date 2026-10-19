import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface LoanTrackingContext {
  lenderId: string;
  bookId: string;
  loanDurationDays: number;
  processedAt: string;
}

declare global {
  namespace Express {
    interface Request {
      loanContext?: LoanTrackingContext;
    }
  }
}

@Injectable()
export class BookLendingTrackerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawLender = req.headers['x-lender-id'];
    const rawBook = req.query.bookId;
    const rawDuration = req.query.duration;

    const lenderId = String(rawLender || 'guest-lender');
    const bookId = String(rawBook || 'unknown-book');
    const loanDurationDays = Number(rawDuration) || 14;
    const processedAt = new Date().toISOString();

    req.loanContext = {
      lenderId,
      bookId,
      loanDurationDays,
      processedAt,
    };

    res.setHeader('X-Loan-Processed-At', processedAt);
    res.setHeader('X-Loan-Lender-ID', lenderId);

    next();
  }
}
