/**
 * A dependency that the source imports but `package.json` does not declare works
 * in this checkout, because every workspace shares one `node_modules`, and then
 * fails in a clean install or, worse, in the packaged app -- electron-builder
 * only ships what is declared. This walks the source and checks the other way
 * round too: anything imported must be a production dependency, since a
 * devDependency is not bundled either.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKSPACES = ['packages/main', 'packages/frontend'];

/** Provided by the runtime the app ships with, so a devDependency is correct. */
const DEV_IS_FINE = new Set(['electron']);

const BUILTINS = new Set(builtinModules);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/**
 * Only real module syntax counts: a doc comment that happens to quote
 * `require("Protol.liqi_struct_pb")` is a Lua snippet, not an import.
 */
function bareSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const pattern =
    /^\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|^\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

  return [...source.matchAll(pattern)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => Boolean(specifier))
    .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('@/'))
    .filter(
      (specifier) => !specifier.startsWith('node:') && !BUILTINS.has(specifier.split('/')[0]!),
    )
    .filter((specifier) => !specifier.startsWith('@types/'));
}

/** `@scope/pkg/deep/path` is still the `@scope/pkg` package. */
function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

function manifest(workspace: string) {
  const json = JSON.parse(readFileSync(join(repoRoot, workspace, 'package.json'), 'utf8'));
  return {
    name: json.name as string,
    dependencies: Object.keys(json.dependencies ?? {}),
    devDependencies: Object.keys(json.devDependencies ?? {}),
  };
}

const workspaceNames = new Set(WORKSPACES.map((workspace) => manifest(workspace).name));

/** Every package the workspace's source imports, minus its own workspace siblings. */
function importedPackages(workspace: string): Set<string> {
  const imported = new Set<string>();
  for (const file of walk(join(repoRoot, workspace, 'src'))) {
    for (const specifier of bareSpecifiers(file)) {
      const pkg = packageName(specifier);
      if (!workspaceNames.has(pkg)) imported.add(pkg);
    }
  }
  return imported;
}

describe('the dependencies each workspace declares', () => {
  for (const workspace of WORKSPACES) {
    const { name, dependencies, devDependencies } = manifest(workspace);

    it(`covers every package ${name} imports`, () => {
      const undeclared = [...importedPackages(workspace)].filter(
        (pkg) => !dependencies.includes(pkg) && !devDependencies.includes(pkg),
      );

      expect(undeclared).toEqual([]);
    });

    it(`keeps the packages ${name} imports at runtime out of devDependencies`, () => {
      const devOnly = [...importedPackages(workspace)].filter(
        (pkg) => devDependencies.includes(pkg) && !DEV_IS_FINE.has(pkg),
      );

      expect(devOnly).toEqual([]);
    });
  }
});
