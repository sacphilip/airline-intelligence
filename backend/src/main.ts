import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' });

  const config = new DocumentBuilder()
    .setTitle('Flight Tracker API')
    .setDescription('ADS-B + AeroDataBox flight tracking backend')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
  // Expose a stable /api-json alias for tooling
  SwaggerModule.setup('api', app, document, { jsonDocumentUrl: '/api-json' });

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  console.log(`Flight tracker backend running on http://localhost:${port}`);
  console.log(`OpenAPI schema: http://localhost:${port}/api-json`);
}
bootstrap();
