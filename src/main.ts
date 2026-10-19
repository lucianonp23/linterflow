import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve the built Vue 3 SPA from the public/ directory at the project root
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Enable automatic input validation globally
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Strips out properties that shouldn't be received
    forbidNonWhitelisted: true, // Throws an error if extra properties are sent
  }));

  // Swagger / OpenAPI interactive documentation, served at /api
  const swaggerConfig = new DocumentBuilder()
    .setTitle('LinterFlow API')
    .setDescription(
      'Self-healing SAST + LLM pipeline. Trigger the automated refactoring loop and inspect the request schema.',
    )
    .setVersion('1.0')
    .addTag('orchestrator', 'Starts and controls the refactoring pipeline')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, document);

  // Configurable so a second instance (e.g. a feature branch) can run
  // alongside the default one on :3000.
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`LinterFlow API is running on: http://localhost:${port}`);
  console.log(`Swagger UI available at:      http://localhost:${port}/api`);
}
bootstrap();