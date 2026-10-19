import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

export interface Movie {
  id: string;
  title: string;
  genre: string;
  releaseYear: number;
  watched: boolean;
}

export class CreateMovieDto {
  title: string;
  genre: string;
  releaseYear: number;
}

export class UpdateMovieDto {
  title?: string;
  genre?: string;
  releaseYear?: number;
  watched?: boolean;
}

@Controller('watchlist')
export class WatchlistController {
  private watchlist: Movie[] = [];
  private idCounter = 1;

  @Get()
  getAll(): Movie[] {
    return this.watchlist;
  }

  @Get(':id')
  getOne(@Param('id') id: string): Movie {
    const movie = this.watchlist.find((m) => m.id === id);
    if (!movie) {
      throw new NotFoundException(`Movie with ID ${id} not found`);
    }
    return movie;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  addMovie(@Body() dto: CreateMovieDto): Movie {
    if (!dto.title) {
      throw new BadRequestException('Movie title is required');
    }
    const newMovie: Movie = {
      id: (this.idCounter++).toString(),
      title: dto.title,
      genre: dto.genre ?? 'Uncategorized',
      releaseYear: dto.releaseYear ?? new Date().getFullYear(),
      watched: false,
    };
    this.watchlist.push(newMovie);
    return newMovie;
  }

  @Put(':id')
  updateMovie(@Param('id') id: string, @Body() dto: UpdateMovieDto): Movie {
    const movie = this.getOne(id);
    movie.title = dto.title ?? movie.title;
    movie.genre = dto.genre ?? movie.genre;
    movie.releaseYear = dto.releaseYear ?? movie.releaseYear;
    movie.watched = dto.watched ?? movie.watched;
    return movie;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMovie(@Param('id') id: string): void {
    const index = this.watchlist.findIndex((m) => m.id === id);
    if (index === -1) {
      throw new NotFoundException(`Movie with ID ${id} not found`);
    }
    this.watchlist.splice(index, 1);
  }
}
