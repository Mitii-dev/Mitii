import { describe, expect, it } from "vitest";

import {
  expandRelatedNetworkHosts,
  extractHostsFromWebSearchOutput,
  inferPackageRegistryHostsFromQuery,
} from "../pipeline/executeToolSupport";

describe("extractHostsFromWebSearchOutput", () => {
  it("collects result hosts and admits npm registry for scoped package queries", () => {
    const hosts = extractHostsFromWebSearchOutput({
      query: "@xmldom/xmldom latest version 2025 vulnerability fix",
      results: [
        {
          title: "Snyk",
          url: "https://security.snyk.io/package/npm/%40xmldom%2Fxmldom",
          snippet: "Latest non-vulnerable version: 0.9.12",
        },
        {
          title: "GitHub issue",
          url: "https://github.com/xmldom/xmldom/issues/271",
          snippet: "now published as @xmldom/xmldom",
        },
      ],
    });
    expect(hosts).toContain("security.snyk.io");
    expect(hosts).toContain("github.com");
    expect(hosts).toContain("registry.npmjs.org");
    expect(hosts).toContain("www.npmjs.com");
  });

  it("expands npmjs.com result hosts to registry.npmjs.org", () => {
    expect(expandRelatedNetworkHosts(["www.npmjs.com"])).toEqual(
      expect.arrayContaining(["registry.npmjs.org", "npmjs.com"]),
    );
  });

  it("infers registries from ecosystem queries", () => {
    expect(inferPackageRegistryHostsFromQuery("npm view lodash version")).toEqual(
      expect.arrayContaining(["registry.npmjs.org"]),
    );
    expect(
      inferPackageRegistryHostsFromQuery("pip install requests latest"),
    ).toEqual(expect.arrayContaining(["pypi.org"]));
  });

  it("ignores private and non-http results", () => {
    const hosts = extractHostsFromWebSearchOutput({
      query: "local docs",
      results: [
        { url: "http://localhost:8080/docs" },
        { url: "ftp://files.example.com/a" },
        { url: "https://docs.example.com/a" },
      ],
    });
    expect(hosts).toEqual(["docs.example.com"]);
  });
});
