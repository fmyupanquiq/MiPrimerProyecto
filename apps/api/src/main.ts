import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { useSpanishValidationMessages } from '@letfer/shared';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadConfig, loadEnvFiles } from './config/app-config.js';

loadEnvFiles();
const config = loadConfig();
useSpanishValidationMessages();

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApp(app);
app.enableShutdownHooks();

await app.listen(config.port);
