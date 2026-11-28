import type { FileSystemReadPort } from "../shared";

import { ProjectCatalogBuilder } from "./ProjectCatalogBuilder";
import { ProjectRootDetector } from "./ProjectRootDetector";

import { ManifestReaderRegistry } from "./manifests";
import {
  CargoTomlReader,
  ComposerJsonReader,
  DotnetProjectReader,
  GemfileReader,
  GoModuleReader,
  GradleProjectReader,
  MavenProjectReader,
  PackageJsonReader,
  PyprojectReader,
} from "./readers";

import type { ManifestReader, ProjectRootDetectorOptions } from "./types";

export interface DefaultProjectCatalogBuilderOptions {
  /**
   * Configuration for project-root detection.
   */
  rootDetector?: ProjectRootDetectorOptions;

  /**
   * Additional application or extension-provided readers.
   *
   * Reader IDs must be unique.
   */
  additionalReaders?: readonly ManifestReader[];
}

export function createDefaultProjectCatalogBuilder(
  fileSystem: FileSystemReadPort,
  options: DefaultProjectCatalogBuilderOptions = {},
): ProjectCatalogBuilder {
  const registry = new ManifestReaderRegistry();

  registerBuiltInReaders(registry, fileSystem);

  for (const reader of options.additionalReaders ?? []) {
    registry.register(reader);
  }

  const rootDetector = new ProjectRootDetector(options.rootDetector);

  return new ProjectCatalogBuilder(rootDetector, registry);
}

function registerBuiltInReaders(
  registry: ManifestReaderRegistry,
  fileSystem: FileSystemReadPort,
): void {
  const readers: readonly ManifestReader[] = [
    new PackageJsonReader(fileSystem),
    new MavenProjectReader(fileSystem),
    new GradleProjectReader(fileSystem),
    new GoModuleReader(fileSystem),
    new CargoTomlReader(fileSystem),
    new PyprojectReader(fileSystem),
    new ComposerJsonReader(fileSystem),
    new GemfileReader(fileSystem),
    new DotnetProjectReader(fileSystem),
  ];

  for (const reader of readers) {
    registry.register(reader);
  }
}
