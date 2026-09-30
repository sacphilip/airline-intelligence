import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableCors({ origin: process.env.FRONTEND_URL ?? 'http://localhost:3000' });

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);
  console.log(`Flight tracker backend running on http://localhost:${port}`);
}
bootstrap();
