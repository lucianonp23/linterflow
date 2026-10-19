import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LinkShortenerRegistryMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawCode = String(req.headers['x-short-code'] || req.query.code || '');
    const sanitizedCode = rawCode.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

    req.headers['x-short-code'] = sanitizedCode;

    Object.assign(req, {
      registryContext: {
        shortCode: sanitizedCode,
        receivedAt: new Date().toISOString(),
        clientIp: req.ip || req.socket.remoteAddress || '',
      },
    });

    res.setHeader('X-Link-Registry-Processed', 'true');

    next();
  }
}
