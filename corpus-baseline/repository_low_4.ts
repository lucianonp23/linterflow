import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';

export interface GiftIdea {
  id: string;
  title: string;
  description?: string;
  price?: number;
  recipient?: string;
  isPurchased: boolean;
  createdAt: Date;
}

export interface CreateGiftIdeaDto {
  title: string;
  description?: string;
  price?: number;
  recipient?: string;
}

export interface UpdateGiftIdeaDto {
  title?: string;
  description?: string;
  price?: number;
  recipient?: string;
  isPurchased?: boolean;
}

@Injectable()
export class GiftIdeaRepository {
  private readonly store = new Map<string, GiftIdea>();

  public create(dto: CreateGiftIdeaDto): GiftIdea {
    const giftIdea: GiftIdea = {
      ...dto,
      id: randomUUID(),
      isPurchased: false,
      createdAt: new Date(),
    };
    this.store.set(giftIdea.id, giftIdea);
    return giftIdea;
  }

  public findAll(): GiftIdea[] {
    return Array.from(this.store.values());
  }

  public findOne(id: string): GiftIdea {
    const item = this.store.get(id);
    if (!item) {
      throw new NotFoundException(`Gift idea with ID "${id}" not found`);
    }
    return item;
  }

  public update(id: string, dto: UpdateGiftIdeaDto): GiftIdea {
    const existing = this.findOne(id);
    const updated: GiftIdea = {
      ...existing,
      ...dto,
    };
    this.store.set(id, updated);
    return updated;
  }

  public delete(id: string): boolean {
    this.findOne(id);
    return this.store.delete(id);
  }
}