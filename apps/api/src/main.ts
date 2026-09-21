import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureSpanishValidationMessages } from '@letfer/shared';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadConfig, loadEnvFiles } from './config/app-config.js';

loadEnvFiles();
const config = loadConfig();
configureSpanishValidationMessages();

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApp(app);
app.enableShutdownHooks();

await app.listen(config.port);
