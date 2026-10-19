import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const SHORT_CODE_HEADER = 'x-short-code';
const REGISTRY_PROCESSED_HEADER = 'X-Link-Registry-Processed';
const SANITIZE_PATTERN = /[^a-z0-9_-]/g;

@Injectable()
export class LinkShortenerRegistryMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawCode = this.extractRawCode(req);
    const sanitizedCode = this.sanitizeCode(rawCode);

    req.headers[SHORT_CODE_HEADER] = sanitizedCode;

    Object.assign(req, {
      registryContext: {
        shortCode: sanitizedCode,
        receivedAt: new Date().toISOString(),
        clientIp: this.getClientIp(req),
      },
    });

    res.setHeader(REGISTRY_PROCESSED_HEADER, 'true');

    next();
  }

  private extractRawCode(req: Request): string {
    const headerCode = req.headers[SHORT_CODE_HEADER];
    const queryCode = req.query.code;
    return String(headerCode || queryCode || '');
  }

  private sanitizeCode(rawCode: string): string {
    return rawCode.trim().toLowerCase().replace(SANITIZE_PATTERN, '');
  }

  private getClientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || '';
  }
}