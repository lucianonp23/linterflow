import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Mini Social Network API')
    .setDescription(
      'Full-featured TypeScript REST API built with NestJS & TypeORM. Features JWT Auth, User Profiles, Follows, Short Posts, Likes, Comments, and Personalized Timeline Feed.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Social Network Server running at: http://localhost:${port}`);
  logger.log(`📚 Interactive Swagger API Docs at: http://localhost:${port}/api/docs`);
  logger.log(`🌐 Interactive Web UI Application at: http://localhost:${port}/`);
}

bootstrap();
