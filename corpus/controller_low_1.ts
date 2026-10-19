import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  NotFoundException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  category: string;
  createdAt: Date;
}

export class CreateBookmarkDto {
  title: string;
  url: string;
  category?: string;
}

export class UpdateBookmarkDto {
  title?: string;
  url?: string;
  category?: string;
}

@Controller('bookmarks')
export class BookmarksController {
  private bookmarks: Bookmark[] = [];

  @Get()
  findAll(): Bookmark[] {
    return this.bookmarks;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Bookmark {
    const bookmark = this.bookmarks.find((b) => b.id === id);
    if (!bookmark) {
      throw new NotFoundException(`Bookmark with ID ${id} not found`);
    }
    return bookmark;
  }

  @Post()
  create(@Body() dto: CreateBookmarkDto): Bookmark {
    const newBookmark: Bookmark = {
      id: Date.now().toString(),
      title: dto.title,
      url: dto.url,
      category: dto.category || 'Uncategorized',
      createdAt: new Date(),
    };
    this.bookmarks.push(newBookmark);
    return newBookmark;
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateBookmarkDto,
  ): Bookmark {
    const index = this.bookmarks.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new NotFoundException(`Bookmark with ID ${id} not found`);
    }
    const existing = this.bookmarks[index];
    const updated: Bookmark = {
      ...existing,
      title: dto.title ?? existing.title,
      url: dto.url ?? existing.url,
      category: dto.category ?? existing.category,
    };
    this.bookmarks[index] = updated;
    return updated;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    const index = this.bookmarks.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new NotFoundException(`Bookmark with ID ${id} not found`);
    }
    this.bookmarks.splice(index, 1);
  }
}
