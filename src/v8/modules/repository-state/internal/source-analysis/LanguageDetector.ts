import {
  SOURCE_LANGUAGE_BASENAMES,
  SOURCE_LANGUAGE_EXTENSIONS,
} from "./constants";

import type {
  SourceLanguageDetection,
  SourceLanguageDetectorOptions,
} from "./types";

export class LanguageDetector {
  private readonly basenames:
    Readonly<Record<string, string>>;

  private readonly extensions:
    Readonly<Record<string, string>>;

  constructor(
    options:
      SourceLanguageDetectorOptions = {},
  ) {
    this.basenames = {
      ...SOURCE_LANGUAGE_BASENAMES,
      ...this.normalizeMap(
        options.additionalBasenames,
        false,
      ),
    };

    this.extensions = {
      ...SOURCE_LANGUAGE_EXTENSIONS,
      ...this.normalizeMap(
        options.additionalExtensions,
        true,
      ),
    };
  }

  public detect(
    relativePath: string,
    explicitLanguage?: string,
  ): SourceLanguageDetection {
    const explicit =
      explicitLanguage?.trim();

    if (explicit) {
      return {
        language: explicit,
        source: "explicit",
        evidence:
          `Language "${explicit}" was supplied explicitly.`,
      };
    }

    const normalizedPath =
      relativePath
        .trim()
        .replace(/\\/g, "/");

    const basename =
      normalizedPath
        .split("/")
        .pop()
        ?.toLowerCase() ?? "";

    const basenameLanguage =
      this.basenames[basename];

    if (basenameLanguage) {
      return {
        language:
          basenameLanguage,
        source: "basename",
        evidence:
          `Matched source basename "${basename}".`,
      };
    }

    const dotIndex =
      basename.lastIndexOf(".");

    if (dotIndex >= 0) {
      const extension =
        basename.slice(dotIndex);

      const extensionLanguage =
        this.extensions[extension];

      if (extensionLanguage) {
        return {
          language:
            extensionLanguage,
          source: "extension",
          evidence:
            `Matched source extension "${extension}".`,
        };
      }
    }

    return {
      source: "unknown",
      evidence:
        `No language mapping matched "${relativePath}".`,
    };
  }

  private normalizeMap(
    values:
      Readonly<
        Record<string, string>
      > | undefined,
    extension: boolean,
  ): Readonly<Record<string, string>> {
    if (!values) {
      return {};
    }

    const normalized:
      Record<string, string> = {};

    for (
      const [
        rawKey,
        rawLanguage,
      ] of Object.entries(values)
    ) {
      let key =
        rawKey.trim().toLowerCase();

      const language =
        rawLanguage.trim();

      if (
        extension &&
        key &&
        !key.startsWith(".")
      ) {
        key = `.${key}`;
      }

      if (key && language) {
        normalized[key] =
          language;
      }
    }

    return normalized;
  }
}

