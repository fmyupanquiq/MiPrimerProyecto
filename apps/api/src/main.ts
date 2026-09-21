import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { loadConfig, loadEnvFiles } from './config/app-config.js';

loadEnvFiles();
const config = loadConfig();

const app = await NestFactory.create(AppModule);
configureApp(app);
app.enableShutdownHooks();

await app.listen(config.port);
