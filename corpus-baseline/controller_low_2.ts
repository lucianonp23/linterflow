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

export class CreateTodoDto {
  title: string;
  description?: string;
}

export class UpdateTodoDto {
  title?: string;
  description?: string;
  isCompleted?: boolean;
}

export class Todo {
  id: string;
  title: string;
  description: string;
  isCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Controller('todos')
export class TodoController {
  private readonly todos: Todo[] = [];

  @Get()
  findAll(): Todo[] {
    return this.todos;
  }

  @Get(':id')
  findOne(@Param('id') id: string): Todo {
    const todo = this.todos.find((item) => item.id === id);
    if (!todo) {
      throw new NotFoundException(`Todo with ID ${id} not found`);
    }
    return todo;
  }

  @Post()
  create(@Body() dto: CreateTodoDto): Todo {
    const now = new Date();
    const newTodo: Todo = {
      id: Math.random().toString(36).substring(2, 9),
      title: dto.title,
      description: dto.description ?? '',
      isCompleted: false,
      createdAt: now,
      updatedAt: now,
    };
    this.todos.push(newTodo);
    return newTodo;
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTodoDto): Todo {
    const todo = this.findOne(id);
    todo.title = dto.title ?? todo.title;
    todo.description = dto.description ?? todo.description;
    todo.isCompleted = dto.isCompleted ?? todo.isCompleted;
    todo.updatedAt = new Date();
    return todo;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    const index = this.todos.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new NotFoundException(`Todo with ID ${id} not found`);
    }
    this.todos.splice(index, 1);
  }
}