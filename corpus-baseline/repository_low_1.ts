import { Injectable, NotFoundException } from '@nestjs/common';

export class PodcastSubscription {
  id!: string;
  title!: string;
  feedUrl!: string;
  subscribedAt!: Date;
}

export class CreateSubscriptionDto {
  title!: string;
  feedUrl!: string;
}

export class UpdateSubscriptionDto {
  title?: string;
  feedUrl?: string;
}

@Injectable()
export class PodcastSubscriptionRepository {
  private readonly subscriptions = new Map<string, PodcastSubscription>();

  create(dto: CreateSubscriptionDto): PodcastSubscription {
    const id = this.generateId();
    const subscription: PodcastSubscription = {
      id,
      title: dto.title,
      feedUrl: dto.feedUrl,
      subscribedAt: new Date(),
    };

    this.subscriptions.set(id, subscription);
    return subscription;
  }

  findAll(): PodcastSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  findById(id: string): PodcastSubscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) {
      throw new NotFoundException(`Subscription with ID "${id}" not found`);
    }
    return subscription;
  }

  update(id: string, dto: UpdateSubscriptionDto): PodcastSubscription {
    const existing = this.findById(id);
    const updated: PodcastSubscription = {
      ...existing,
      title: dto.title ?? existing.title,
      feedUrl: dto.feedUrl ?? existing.feedUrl,
    };

    this.subscriptions.set(id, updated);
    return updated;
  }

  delete(id: string): void {
    this.findById(id);
    this.subscriptions.delete(id);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}