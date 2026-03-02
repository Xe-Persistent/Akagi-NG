import fs from 'fs/promises';
import path from 'path';

export interface ResourceStatus {
  lib: boolean;
  models: boolean;
  missingCritical: string[];
  missingOptional: string[];
}

export class ResourceValidator {
  constructor(private projectRoot: string) {}

  public async validate(): Promise<ResourceStatus> {
    const libPath = path.join(this.projectRoot, 'lib');
    const modelsPath = path.join(this.projectRoot, 'models');

    const [libExists, modelsExists] = await Promise.all([
      this.checkLib(libPath),
      this.checkModels(modelsPath),
    ]);

    const missingCritical: string[] = [];
    const missingOptional: string[] = [];

    if (!libExists) {
      missingCritical.push('lib');
    }

    if (!modelsExists) {
      missingOptional.push('models');
    }

    return {
      lib: libExists,
      models: modelsExists,
      missingCritical,
      missingOptional,
    };
  }

  private async checkLib(dirPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(dirPath);
      // On Windows look for .pyd, otherwise .so
      const isWin = process.platform === 'win32';
      const libRiichi = isWin ? 'libriichi.pyd' : 'libriichi.so';
      const libRiichi3p = isWin ? 'libriichi3p.pyd' : 'libriichi3p.so';

      return files.includes(libRiichi) && files.includes(libRiichi3p);
    } catch {
      return false;
    }
  }

  private async checkModels(dirPath: string): Promise<boolean> {
    try {
      const files = await fs.readdir(dirPath);
      // Look for at least one .pth file
      return files.some((f) => f.endsWith('.pth'));
    } catch {
      return false;
    }
  }
}
