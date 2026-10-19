import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class NoteTaggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const rawTagInput = `${this.formatTagInput(req.body?.tags)},${this.formatTagInput(req.query?.tags)}`;
    const normalizedTags = this.extractNormalizedTags(rawTagInput);

    req.body = req.body || {};
    req.body.tags = normalizedTags;
    req['processedNoteTags'] = normalizedTags;

    res.setHeader('X-Note-Tag-Count', normalizedTags.length.toString());
    res.setHeader('X-Tag-Processed-At', new Date().toISOString());

    next();
  }

  private formatTagInput(tags: unknown): string {
    const value = tags ?? '';
    return Array.isArray(value) ? value.join(',') : String(value);
  }

  private extractNormalizedTags(rawInput: string): string[] {
    const tags = rawInput
      .split(',')
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean);

    return Array.from(new Set(tags));
  }
}