import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ResourceStatus {
  models: boolean;
  missingCritical: string[];
  missingOptional: string[];
}

export class ResourceValidator {
  constructor(private projectRoot: string) {}

  public async validate(): Promise<ResourceStatus> {
    const modelsExists = await this.checkModels(join(this.projectRoot, 'models'));

    return {
      models: modelsExists,
      missingCritical: modelsExists ? [] : ['models'],
      missingOptional: [],
    };
  }

  private async checkModels(dirPath: string): Promise<boolean> {
    try {
      const files = await readdir(dirPath);
      return files.some((f) => f.endsWith('.safetensors'));
    } catch {
      return false;
    }
  }
}
