import fs from 'fs';
import path from 'path';

export interface ResourceStatus {
  lib: boolean;
  models: boolean;
  missingCritical: string[];
  missingOptional: string[];
}

export class ResourceValidator {
  constructor(private projectRoot: string) {}

  public validate(): ResourceStatus {
    const libPath = path.join(this.projectRoot, 'lib');
    const modelsPath = path.join(this.projectRoot, 'models');

    const libExists = this.checkLib(libPath);
    const modelsExists = this.checkModels(modelsPath);

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

  private checkLib(dirPath: string): boolean {
    if (!fs.existsSync(dirPath)) return false;
    const files = fs.readdirSync(dirPath);
    // On Windows look for .pyd, otherwise .so
    const isWin = process.platform === 'win32';
    const libRiichi = isWin ? 'libriichi.pyd' : 'libriichi.so';
    const libRiichi3p = isWin ? 'libriichi3p.pyd' : 'libriichi3p.so';

    return files.includes(libRiichi) && files.includes(libRiichi3p);
  }

  private checkModels(dirPath: string): boolean {
    if (!fs.existsSync(dirPath)) return false;
    const files = fs.readdirSync(dirPath);
    // Look for at least one .pth file
    return files.some((f) => f.endsWith('.pth'));
  }
}
