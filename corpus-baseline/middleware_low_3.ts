import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

export interface LoanTrackingContext {
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

const DEFAULT_LENDER_ID = 'guest-lender';
const DEFAULT_BOOK_ID = 'unknown-book';
const DEFAULT_LOAN_DURATION_DAYS = 14;

const HEADER_LENDER_ID = 'x-lender-id';
const RESPONSE_HEADER_PROCESSED_AT = 'X-Loan-Processed-At';
const RESPONSE_HEADER_LENDER_ID = 'X-Loan-Lender-ID';

@Injectable()
export class BookLendingTrackerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const loanContext = this.buildLoanContext(req);

    req.loanContext = loanContext;

    this.setResponseHeaders(res, loanContext);

    next();
  }

  private buildLoanContext(req: Request): LoanTrackingContext {
    const rawLender = req.headers[HEADER_LENDER_ID];
    const rawBook = req.query.bookId;
    const rawDuration = req.query.duration;

    return {
      lenderId: String(rawLender || DEFAULT_LENDER_ID),
      bookId: String(rawBook || DEFAULT_BOOK_ID),
      loanDurationDays: Number(rawDuration) || DEFAULT_LOAN_DURATION_DAYS,
      processedAt: new Date().toISOString(),
    };
  }

  private setResponseHeaders(res: Response, context: LoanTrackingContext): void {
    res.setHeader(RESPONSE_HEADER_PROCESSED_AT, context.processedAt);
    res.setHeader(RESPONSE_HEADER_LENDER_ID, context.lenderId);
  }
}