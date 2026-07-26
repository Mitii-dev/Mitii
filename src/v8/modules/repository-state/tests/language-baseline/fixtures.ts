import type {
  LanguageCapabilityLevel,
  LanguageId,
} from "../../contracts/language";

export interface LanguageBaselineFixture {
  id: LanguageId;
  relativePath: string;
  content: string;
  searchToken: string;
  capability: LanguageCapabilityLevel;
  /**
   * True when the registry marks the language enhanced and a default
   * parser is expected to produce structural facts.
   */
  expectEnhancedSymbols: boolean;
  shebang?: string;
}

/**
 * One small representative snippet per V8 target language plus unknown.
 * Contents stay tiny: detection, deterministic chunking, and lexical token presence.
 */
export const LANGUAGE_BASELINE_FIXTURES: readonly LanguageBaselineFixture[] = [
  {
    id: "typescript",
    relativePath: "src/auth.ts",
    content: [
      "export function authenticateUser(token: string): boolean {",
      "  return token === 'baseline-typescript-token';",
      "}",
    ].join("\n"),
    searchToken: "baseline-typescript-token",
    capability: "enhanced",
    expectEnhancedSymbols: true,
  },
  {
    id: "javascript",
    relativePath: "src/auth.js",
    content: [
      "export function authenticateUser(token) {",
      "  return token === 'baseline-javascript-token';",
      "}",
    ].join("\n"),
    searchToken: "baseline-javascript-token",
    capability: "enhanced",
    expectEnhancedSymbols: true,
  },
  {
    id: "python",
    relativePath: "app/auth.py",
    content: [
      "def authenticate_user(token: str) -> bool:",
      "    return token == 'baseline-python-token'",
    ].join("\n"),
    searchToken: "baseline-python-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
    shebang: "#!/usr/bin/env python3",
  },
  {
    id: "java",
    relativePath: "src/Auth.java",
    content: [
      "public class Auth {",
      "  public boolean authenticateUser(String token) {",
      "    return \"baseline-java-token\".equals(token);",
      "  }",
      "}",
    ].join("\n"),
    searchToken: "baseline-java-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "csharp",
    relativePath: "Auth.cs",
    content: [
      "public class Auth {",
      "  public bool AuthenticateUser(string token) {",
      "    return token == \"baseline-csharp-token\";",
      "  }",
      "}",
    ].join("\n"),
    searchToken: "baseline-csharp-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "go",
    relativePath: "auth.go",
    content: [
      "package auth",
      "",
      "func AuthenticateUser(token string) bool {",
      "  return token == \"baseline-go-token\"",
      "}",
    ].join("\n"),
    searchToken: "baseline-go-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "rust",
    relativePath: "src/auth.rs",
    content: [
      "pub fn authenticate_user(token: &str) -> bool {",
      "    token == \"baseline-rust-token\"",
      "}",
    ].join("\n"),
    searchToken: "baseline-rust-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "c",
    relativePath: "auth.c",
    content: [
      "int authenticate_user(const char *token) {",
      "  return strcmp(token, \"baseline-c-token\") == 0;",
      "}",
    ].join("\n"),
    searchToken: "baseline-c-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "cpp",
    relativePath: "auth.cpp",
    content: [
      "bool authenticateUser(const std::string& token) {",
      "  return token == \"baseline-cpp-token\";",
      "}",
    ].join("\n"),
    searchToken: "baseline-cpp-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "ruby",
    relativePath: "auth.rb",
    content: [
      "def authenticate_user(token)",
      "  token == 'baseline-ruby-token'",
      "end",
    ].join("\n"),
    searchToken: "baseline-ruby-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
    shebang: "#!/usr/bin/env ruby",
  },
  {
    id: "php",
    relativePath: "auth.php",
    content: [
      "<?php",
      "function authenticate_user(string $token): bool {",
      "  return $token === 'baseline-php-token';",
      "}",
    ].join("\n"),
    searchToken: "baseline-php-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "kotlin",
    relativePath: "Auth.kt",
    content: [
      "fun authenticateUser(token: String): Boolean {",
      "  return token == \"baseline-kotlin-token\"",
      "}",
    ].join("\n"),
    searchToken: "baseline-kotlin-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "swift",
    relativePath: "Auth.swift",
    content: [
      "func authenticateUser(token: String) -> Bool {",
      "  return token == \"baseline-swift-token\"",
      "}",
    ].join("\n"),
    searchToken: "baseline-swift-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "shell",
    relativePath: "scripts/auth.sh",
    content: [
      "authenticate_user() {",
      "  [ \"$1\" = \"baseline-shell-token\" ]",
      "}",
    ].join("\n"),
    searchToken: "baseline-shell-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
    shebang: "#!/usr/bin/env bash",
  },
  {
    id: "sql",
    relativePath: "schema.sql",
    content: [
      "CREATE TABLE baseline_users (",
      "  id INTEGER PRIMARY KEY,",
      "  token TEXT NOT NULL",
      ");",
      "-- baseline-sql-token",
    ].join("\n"),
    searchToken: "baseline-sql-token",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
  {
    id: "unknown",
    relativePath: "notes/config.env.local",
    content: [
      "APP_NAME=mitii",
      "API_KEY=baseline-unknown-secret-value",
      "FEATURE_FLAG=true",
    ].join("\n"),
    searchToken: "baseline-unknown-secret-value",
    capability: "baseline",
    expectEnhancedSymbols: false,
  },
];
