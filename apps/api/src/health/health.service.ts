import { Injectable } from '@nestjs/common';
import { SYSTEM_NAME } from '@letfer/shared';

export interface HealthStatus {
  status: 'ok';
  service: string;
}

@Injectable()
export class HealthService {
  check(): HealthStatus {
    return { status: 'ok', service: `${SYSTEM_NAME} API` };
  }
}
