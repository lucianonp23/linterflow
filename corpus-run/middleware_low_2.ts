import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class NoteTaggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const bodyTags = req.body?.tags ?? '';
    const queryTags = req.query?.tags ?? '';
    const rawTagInput = `${Array.isArray(bodyTags) ? bodyTags.join(',') : bodyTags},${Array.isArray(queryTags) ? queryTags.join(',') : queryTags}`;

    const normalizedTags = Array.from(
      new Set(
        rawTagInput
          .split(',')
          .map((tag) => String(tag).trim().toLowerCase())
          .filter(Boolean)
      )
    );

    req.body = req.body || {};
    req.body.tags = normalizedTags;
    req['processedNoteTags'] = normalizedTags;

    res.setHeader('X-Note-Tag-Count', normalizedTags.length.toString());
    res.setHeader('X-Tag-Processed-At', new Date().toISOString());

    next();
  }
}
