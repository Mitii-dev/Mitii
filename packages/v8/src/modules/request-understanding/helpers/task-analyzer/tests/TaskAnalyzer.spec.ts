import assert from "node:assert/strict";
import test from "node:test";

import {
  TaskAnalysisSchema,
  TaskAnalyzer,
  TASK_ANALYZER_SOURCE_FILE_EXTENSIONS,
  taskAnalyzerInputSchema,
} from "../index";
import type { SuperIntentResult } from "../../intent/types";
import type { TaskAnalyzerInput } from "../contracts";

const createSuperIntent = (
  overrides: Partial<SuperIntentResult> & {
    interactionIntent?: SuperIntentResult["classification"]["interactionIntent"];
    primaryTaskIntent?: SuperIntentResult["classification"]["primaryTaskIntent"];
    confidence?: number;
  } = {},
): SuperIntentResult => ({
  status: "accepted",
  classification: {
    interactionIntent: overrides.interactionIntent ?? "act",
    primaryTaskIntent: overrides.primaryTaskIntent ?? "bugfix",
    secondaryTaskIntents: [],
    confidence: overrides.confidence ?? 0.92,
    alternatives: [],
    needsClarification: false,
    reason: "Test classification.",
  },
  scores: [],
  confidenceMargin: 0.25,
  recommendsClarification: false,
  diagnostics: {
    llmPrimaryIntent: overrides.primaryTaskIntent ?? "bugfix",
    llmInteractionIntent: overrides.interactionIntent ?? "act",
    taskAgreement: true,
    interactionAgreement: true,
    interactionConflict: false,
    agreementBonusApplied: 0,
    disagreementPenaltyApplied: 0,
    minimumConfidence: 0.6,
    minimumMargin: 0.15,
  },
  ...overrides,
});

const createInput = (
  userMessage: string,
  intentOverrides: Parameters<typeof createSuperIntent>[0] = {},
  referencedArtifacts: TaskAnalyzerInput["referencedArtifacts"] = [],
): TaskAnalyzerInput =>
  taskAnalyzerInputSchema.parse({
    userMessage,
    intent: createSuperIntent(intentOverrides),
    referencedArtifacts,
  });

test("task analyzer input and output contracts validate", () => {
  const analyzer = new TaskAnalyzer();
  const input = createInput(
    "Fix the failing test in src/auth/service.ts and run the tests.",
  );
  const result = analyzer.analyze(input);

  assert.doesNotThrow(() => taskAnalyzerInputSchema.parse(input));
  assert.doesNotThrow(() => TaskAnalysisSchema.parse(result));
});

test("task analyzer detects explicit file targets across top languages", () => {
  const analyzer = new TaskAnalyzer();
  const files = [
    "src/main.py",
    "internal/handler.go",
    "lib/parser.rs",
    "com/example/App.java",
    "Program.cs",
    "app/models/user.rb",
    "routes/api.php",
    "Sources/App.swift",
  ];

  for (const file of files) {
    const result = analyzer.analyze(
      createInput(`Fix the bug in ${file} without changing other files.`),
    );

    assert.ok(
      result.targets.some(
        (target) => target.kind === "file" && target.value.endsWith(file),
      ),
      `Expected file target for ${file}`,
    );
  }
});

test("task analyzer extension catalog covers repository-state top languages", () => {
  const required = [
    "ts",
    "tsx",
    "js",
    "py",
    "java",
    "go",
    "rs",
    "cs",
    "rb",
    "php",
    "swift",
    "kt",
    "scala",
    "cpp",
    "sql",
  ];

  for (const extension of required) {
    assert.ok(
      TASK_ANALYZER_SOURCE_FILE_EXTENSIONS.includes(
        extension as (typeof TASK_ANALYZER_SOURCE_FILE_EXTENSIONS)[number],
      ),
      `Missing extension: ${extension}`,
    );
  }
});

test("task analyzer extracts @packages mentions and error symbols", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput(
      [
        "SyntaxError: Identifier 'InputTypes' has already been declared",
        "check in @packages and fix it",
      ].join("\n"),
      { primaryTaskIntent: "bugfix" },
    ),
  );

  assert.ok(
    result.targets.some(
      (target) =>
        target.kind === "folder" &&
        target.value === "packages" &&
        target.explicit,
    ),
    "Expected explicit @packages folder target",
  );
  assert.ok(
    result.targets.some(
      (target) =>
        target.kind === "symbol" &&
        target.value === "InputTypes" &&
        target.explicit,
    ),
    "Expected InputTypes symbol target from SyntaxError text",
  );
});

test("task analyzer flags destructive act requests as critical risk", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput("Run rm -rf on the build directory.", {
      interactionIntent: "act",
      primaryTaskIntent: "feature",
    }),
  );

  assert.equal(result.risk, "high");
  assert.ok(result.signals.some((signal) => signal.type === "risk"));
});

test("task analyzer treats destructive language as lower risk for questions", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput("Explain what rm -rf does and when it is dangerous.", {
      interactionIntent: "question",
      primaryTaskIntent: "question",
    }),
  );

  assert.notEqual(result.risk, "critical");
});

test("task analyzer extracts constraints and requested outcomes", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput(
      "Fix src/api/client.ts. Do not modify files outside src/api. Then run the tests.",
      { primaryTaskIntent: "bugfix" },
    ),
  );

  assert.ok(result.constraints.some((value) => /outside src\/api/i.test(value)));
  assert.ok(result.requestedOutcomes.length >= 1);
  assert.equal(result.recommendsVerification, true);
});

test("task analyzer marks vague act requests as unclear", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput("Improve this.", {
      interactionIntent: "act",
      primaryTaskIntent: "feature",
      confidence: 0.55,
    }),
  );

  assert.equal(result.clarity, "unclear");
  assert.equal(result.recommendsTaskClarification, true);
});

test("task analyzer recommends repository discovery when refactor lacks explicit targets", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput("Refactor authentication across the codebase.", {
      primaryTaskIntent: "refactor",
    }),
  );

  assert.equal(result.recommendsRepositoryDiscovery, true);
});

test("task analyzer treats breadth language as repository scope", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput(
      "Refactor authentication across the codebase and document the flow.",
      {
        primaryTaskIntent: "refactor",
        interactionIntent: "act",
      },
    ),
  );

  assert.equal(result.scope, "repository");
  assert.equal(result.recommendsRepositoryDiscovery, true);
});

test("task analyzer treats project restructure as repository scope", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput(
      "Restructure this project, make sure every test case follow proper interface and lib\n- Need proper folder restructure as well",
      {
        primaryTaskIntent: "refactor",
        interactionIntent: "act",
      },
    ),
  );

  assert.equal(result.scope, "repository");
  assert.equal(result.recommendsRepositoryDiscovery, true);
});

test("task analyzer does not treat locative app/codebase phrases as repository scope", () => {
  const analyzer = new TaskAnalyzer();

  assert.notEqual(
    analyzer.analyze(
      createInput(
        "Build and unit-test the app instead of booting an HTTP server.",
        { primaryTaskIntent: "feature", interactionIntent: "act" },
      ),
    ).scope,
    "repository",
  );

  assert.notEqual(
    analyzer.analyze(
      createInput(
        "Helpers don't exist anywhere in this codebase — implement them with crypto.",
        { primaryTaskIntent: "bugfix", interactionIntent: "act" },
      ),
    ).scope,
    "repository",
  );

  assert.notEqual(
    analyzer.analyze(
      createInput("The app won't start. Please investigate and fix it.", {
        primaryTaskIntent: "bugfix",
        interactionIntent: "act",
      }),
    ).scope,
    "repository",
  );

  assert.notEqual(
    analyzer.analyze(
      createInput(
        "Inject CartRepository the same way the repository is injected.",
        { primaryTaskIntent: "bugfix", interactionIntent: "act" },
      ),
    ).scope,
    "repository",
  );
});

test("task analyzer uses referenced artifacts as implicit targets", () => {
  const analyzer = new TaskAnalyzer();
  const result = analyzer.analyze(
    createInput(
      "Fix the selected handler.",
      { primaryTaskIntent: "bugfix" },
      [
        {
          name: "handler.go",
          path: "internal/auth/handler.go",
          kind: "selection",
        },
      ],
    ),
  );

  assert.ok(
    result.targets.some(
      (target) =>
        target.kind === "file" &&
        target.value === "internal/auth/handler.go" &&
        target.explicit === false,
    ),
  );
  assert.equal(result.recommendsRepositoryDiscovery, false);
});

test("task analyzer unit tests cover missing stage analyzers", () => {
  const analyzer = new TaskAnalyzer();

  assert.equal(
    analyzer
      .analyze(createInput("Rename variable in src/util/helpers.ts"))
      .complexity,
    "simple",
  );

  assert.equal(
    analyzer
      .analyze(
        createInput(
          "Implement OAuth, migrate the database schema, and deploy to production.",
          { primaryTaskIntent: "feature" },
        ),
      )
      .complexity,
    "very_complex",
  );

  assert.equal(
    analyzer
      .analyze(createInput("Update only this file: src/styles/theme.css"))
      .scope,
    "single_location",
  );
});
