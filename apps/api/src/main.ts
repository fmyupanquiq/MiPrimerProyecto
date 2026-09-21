import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
app.enableShutdownHooks();

const port = Number(process.env['PORT'] ?? 3000);
await app.listen(port);
