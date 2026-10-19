import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';

export interface WishlistItem {
  id: string;
  userId: string;
  name: string;
  productIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export type CreateWishlistDto = Omit<WishlistItem, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateWishlistDto = Partial<Omit<WishlistItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>;

@Injectable()
export class WishlistRepository {
  private readonly store: Map<string, WishlistItem> = new Map();
  private idCounter = 1;

  async create(dto: CreateWishlistDto): Promise<WishlistItem> {
    if (!dto.userId || !dto.name) {
      throw new BadRequestException('User ID and wishlist name are required');
    }

    const id = (this.idCounter++).toString();
    const now = new Date();
    const wishlist: WishlistItem = {
      id,
      userId: dto.userId,
      name: dto.name,
      productIds: dto.productIds ? [...dto.productIds] : [],
      createdAt: now,
      updatedAt: now,
    };

    this.store.set(id, wishlist);
    return this.cloneItem(wishlist);
  }

  async findAll(): Promise<WishlistItem[]> {
    return Array.from(this.store.values()).map((item) => this.cloneItem(item));
  }

  async findById(id: string): Promise<WishlistItem> {
    const wishlist = this.getWishlistOrThrow(id);
    return this.cloneItem(wishlist);
  }

  async findByUserId(userId: string): Promise<WishlistItem[]> {
    return Array.from(this.store.values())
      .filter((item) => item.userId === userId)
      .map((item) => this.cloneItem(item));
  }

  async update(id: string, dto: UpdateWishlistDto): Promise<WishlistItem> {
    const existing = await this.findById(id);
    const updated: WishlistItem = {
      ...existing,
      ...dto,
      updatedAt: new Date(),
    };

    this.store.set(id, updated);
    return this.cloneItem(updated);
  }

  async addProduct(id: string, productId: string): Promise<WishlistItem> {
    if (!productId) {
      throw new BadRequestException('Product ID is required');
    }

    const wishlist = await this.findById(id);
    const productIds = Array.from(new Set([...wishlist.productIds, productId]));

    return this.update(id, { productIds });
  }

  async removeProduct(id: string, productId: string): Promise<WishlistItem> {
    const wishlist = await this.findById(id);
    const productIds = wishlist.productIds.filter((pId) => pId !== productId);

    return this.update(id, { productIds });
  }

  async delete(id: string): Promise<void> {
    if (!this.store.has(id)) {
      throw new NotFoundException(`Wishlist with ID "${id}" not found`);
    }
    this.store.delete(id);
  }

  private getWishlistOrThrow(id: string): WishlistItem {
    const wishlist = this.store.get(id);
    if (!wishlist) {
      throw new NotFoundException(`Wishlist with ID "${id}" not found`);
    }
    return wishlist;
  }

  private cloneItem(item: WishlistItem): WishlistItem {
    return {
      ...item,
      productIds: [...item.productIds],
    };
  }
}