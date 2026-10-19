import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_ON_CUSTOMER = 'WAITING_ON_CUSTOMER',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketCategory {
  BILLING = 'BILLING',
  TECHNICAL = 'TECHNICAL',
  GENERAL = 'GENERAL',
  CRITICAL_INFRA = 'CRITICAL_INFRA',
}

export interface Ticket {
  id: string;
  customerId: string;
  title: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  category: TicketCategory;
  assigneeId?: string;
  tags: string[];
  slaBreached: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTicketDto {
  id?: string;
  customerId: string;
  title: string;
  description: string;
  priority: TicketPriority;
  category: TicketCategory;
  assigneeId?: string;
  tags?: string[];
}

export interface UpdateTicketDto {
  title?: string;
  description?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  category?: TicketCategory;
  assigneeId?: string;
  tags?: string[];
  slaBreached?: boolean;
}

@Injectable()
export class SupportTicketRepository {
  private readonly tickets = new Map<string, Ticket>();

  private getPriorityWeight(priority: TicketPriority): number {
    switch (priority) {
      case TicketPriority.URGENT:
        return 4;
      case TicketPriority.HIGH:
        return 3;
      case TicketPriority.MEDIUM:
        return 2;
      case TicketPriority.LOW:
        return 1;
      default:
        return 0;
    }
  }

  public create(dto: CreateTicketDto): Ticket {
    if (!dto.title || dto.title.trim().length < 5 || dto.title.length > 120) {
      throw new BadRequestException('Title must be between 5 and 120 characters.');
    }

    if (!dto.description || dto.description.trim().length < 10) {
      throw new BadRequestException('Description must be at least 10 characters long.');
    }

    if (!dto.customerId || dto.customerId.trim().length === 0) {
      throw new BadRequestException('Customer ID is required.');
    }

    if (dto.priority === TicketPriority.URGENT && dto.category === TicketCategory.GENERAL) {
      throw new BadRequestException('GENERAL category tickets cannot be assigned URGENT priority.');
    }

    if (dto.tags && dto.tags.length > 5) {
      throw new BadRequestException('A ticket cannot have more than 5 tags.');
    }

    if (dto.tags && dto.tags.some((tag) => tag.startsWith('SYS_'))) {
      throw new BadRequestException('Tags cannot start with reserved prefix "SYS_".');
    }

    const openCount = Array.from(this.tickets.values()).filter(
      (t) => t.customerId === dto.customerId && t.status !== TicketStatus.CLOSED && t.status !== TicketStatus.RESOLVED
    ).length;
    if (openCount >= 5) {
      throw new ConflictException('Customer has reached maximum allowed open tickets limit (5).');
    }

    const id = dto.id || `TICK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    if (this.tickets.has(id)) {
      throw new ConflictException(`Ticket with ID ${id} already exists.`);
    }

    const now = new Date();
    const ticket: Ticket = {
      id,
      customerId: dto.customerId,
      title: dto.title.trim(),
      description: dto.description.trim(),
      priority: dto.priority,
      status: TicketStatus.OPEN,
      category: dto.category,
      assigneeId: dto.assigneeId,
      tags: dto.tags || [],
      slaBreached: false,
      createdAt: now,
      updatedAt: now,
    };

    this.tickets.set(id, ticket);
    return { ...ticket };
  }

  public findById(id: string): Ticket {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Ticket ID must be provided.');
    }
    const ticket = this.tickets.get(id);
    if (!ticket) {
      throw new NotFoundException(`Ticket with ID "${id}" was not found.`);
    }
    return { ...ticket };
  }

  public findAll(): Ticket[] {
    return Array.from(this.tickets.values()).map((t) => ({ ...t }));
  }

  public update(id: string, dto: UpdateTicketDto): Ticket {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Ticket ID must be provided.');
    }

    const existing = this.tickets.get(id);
    if (!existing) {
      throw new NotFoundException(`Ticket with ID "${id}" was not found.`);
    }

    if (existing.status === TicketStatus.CLOSED) {
      throw new BadRequestException('Closed tickets cannot be modified.');
    }

    if (dto.status === TicketStatus.IN_PROGRESS && !dto.assigneeId && !existing.assigneeId) {
      throw new BadRequestException('Ticket cannot be set to IN_PROGRESS without an assigned agent.');
    }

    if (existing.slaBreached && dto.priority && dto.priority !== existing.priority) {
      throw new BadRequestException('Priority cannot be modified once SLA is breached.');
    }

    if (dto.tags && dto.tags.some((tag) => tag.startsWith('SYS_'))) {
      throw new BadRequestException('Tags cannot start with reserved prefix "SYS_".');
    }

    const updatedTicket: Ticket = {
      ...existing,
      title: dto.title !== undefined ? dto.title.trim() : existing.title,
      description: dto.description !== undefined ? dto.description.trim() : existing.description,
      priority: dto.priority || existing.priority,
      status: dto.status || existing.status,
      category: dto.category || existing.category,
      assigneeId: dto.assigneeId !== undefined ? dto.assigneeId : existing.assigneeId,
      tags: dto.tags || existing.tags,
      slaBreached: dto.slaBreached !== undefined ? dto.slaBreached : existing.slaBreached,
      updatedAt: new Date(),
    };

    this.tickets.set(id, updatedTicket);
    return { ...updatedTicket };
  }

  public delete(id: string): boolean {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Ticket ID must be provided.');
    }

    const existing = this.tickets.get(id);
    if (!existing) {
      throw new NotFoundException(`Ticket with ID "${id}" was not found.`);
    }

    if (existing.status === TicketStatus.IN_PROGRESS) {
      throw new BadRequestException('Cannot delete a ticket that is currently IN_PROGRESS.');
    }

    if (existing.status !== TicketStatus.CLOSED) {
      throw new BadRequestException('Only tickets with CLOSED status can be deleted.');
    }

    return this.tickets.delete(id);
  }

  public popNextPriorityTicket(agentId: string, allowedCategories?: TicketCategory[]): Ticket {
    if (!agentId || agentId.trim().length === 0) {
      throw new BadRequestException('Agent ID must be provided to claim next ticket.');
    }

    const availableTickets = Array.from(this.tickets.values()).filter((ticket) => {
      if (ticket.status !== TicketStatus.OPEN) return false;
      if (allowedCategories && allowedCategories.length > 0 && !allowedCategories.includes(ticket.category)) return false;
      return true;
    });

    if (availableTickets.length === 0) {
      throw new NotFoundException('No available open tickets in queue matching criteria.');
    }

    availableTickets.sort((a, b) => {
      const weightA = this.getPriorityWeight(a.priority);
      const weightB = this.getPriorityWeight(b.priority);
      if (weightA !== weightB) {
        return weightB - weightA;
      }
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const targetTicket = availableTickets[0];
    targetTicket.status = TicketStatus.IN_PROGRESS;
    targetTicket.assigneeId = agentId;
    targetTicket.updatedAt = new Date();

    this.tickets.set(targetTicket.id, targetTicket);
    return { ...targetTicket };
  }
}
