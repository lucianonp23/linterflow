import { Injectable, NotFoundException } from '@nestjs/common';

export type BookStatus = 'WANT_TO_READ' | 'READING' | 'FINISHED';

export interface Book {
  id: string;
  title: string;
  author: string;
  status: BookStatus;
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateBookDto {
  title: string;
  author: string;
}

export interface UpdateBookDto {
  title?: string;
  author?: string;
  status?: BookStatus;
  rating?: number;
}

@Injectable()
export class ReadingListService {
  private readonly books: Book[] = [];

  addBook(dto: CreateBookDto): Book {
    const now = new Date();
    const book: Book = {
      id: this.generateId(),
      title: dto.title,
      author: dto.author,
      status: 'WANT_TO_READ',
      createdAt: now,
      updatedAt: now,
    };

    this.books.push(book);
    return book;
  }

  findAll(): Book[] {
    return [...this.books];
  }

  findById(id: string): Book {
    const book = this.books.find((b) => b.id === id);
    if (!book) {
      throw new NotFoundException(`Book with ID "${id}" not found.`);
    }
    return book;
  }

  findByStatus(status: BookStatus): Book[] {
    return this.books.filter((b) => b.status === status);
  }

  update(id: string, dto: UpdateBookDto): Book {
    const book = this.findById(id);

    Object.assign(book, {
      title: dto.title ?? book.title,
      author: dto.author ?? book.author,
      status: dto.status ?? book.status,
      rating: dto.rating ?? book.rating,
      updatedAt: new Date(),
    });

    return book;
  }

  remove(id: string): void {
    const index = this.books.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new NotFoundException(`Book with ID "${id}" not found.`);
    }
    this.books.splice(index, 1);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }
}