const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { createApiArray } = require("../src/_data/utils/api-formatter.js");

const faq = {
  id: "cra-basics/what-is-the-cra",
  type: "faq",
  question: "What is the CRA?",
  permalink: "/faq/cra-basics/what-is-the-cra/",
  srcUrl: "https://example.org/source",
  licenseUrl: "https://example.org/license",
  _internal: "hidden",
};

const guidanceRequest = {
  id: "custom-dev",
  type: "guidance-request",
  title: "Custom development",
  permalink: "/pending-guidance/custom-dev/",
  relatedFaqs: [faq],
};

const faqWithRelations = {
  id: "stewards/demonstrate",
  type: "faq",
  question: "How do I demonstrate?",
  permalink: "/faq/stewards/demonstrate/",
  relatedGuidanceRequest: guidanceRequest,
  relatedIssues: [{ type: "github", id: "11", url: "https://github.com/orcwg/cra-hub/issues/11" }],
};

const pages = createApiArray({ faqs: [faq, faqWithRelations], "guidance-requests": [guidanceRequest] });
const page = pages.find((p) => p.endpoint === "/api/v0/faqs/cra-basics/what-is-the-cra.json");
const endpoint = (path) => pages.find((p) => p.endpoint === path);

describe("createApiArray", () => {
  test("links to the item's page, its endpoint and its collection", () => {
    assert.deepEqual(page.payload.links, {
      self: "https://cra.orcwg.org/api/v0/faqs/cra-basics/what-is-the-cra.json",
      html: "https://cra.orcwg.org/faq/cra-basics/what-is-the-cra/",
      collection: "https://cra.orcwg.org/api/v0/faqs.json",
      via: "https://example.org/source",
      license: "https://example.org/license",
    });
  });

  test("builds no URL with a double slash", () => {
    const urls = JSON.stringify(pages).match(/https:\/\/cra\.orcwg\.org[^"]*/g);
    assert.deepEqual(urls.filter((url) => url.includes("//", "https://".length)), []);
  });

  test("keeps link and internal fields out of the data", () => {
    assert.deepEqual(Object.keys(page.payload.data), ["id", "type", "question", "permalink"]);
  });

  test("references and collection items link to the endpoint the item is served at", () => {
    const requestUrl = "https://cra.orcwg.org/api/v0/guidance-requests/custom-dev.json";
    assert.equal(endpoint("/api/v0/guidance-requests/custom-dev.json").payload.links.self, requestUrl);
    assert.deepEqual(endpoint("/api/v0/guidance-requests.json").payload.data.items, [
      { type: "guidance-request", id: "custom-dev", title: "Custom development", url: requestUrl }
    ]);
    assert.deepEqual(endpoint("/api/v0/faqs/stewards/demonstrate.json").payload.data.relatedGuidanceRequest, {
      id: "custom-dev", type: "guidance-request", url: requestUrl
    });
    assert.deepEqual(endpoint("/api/v0/guidance-requests/custom-dev.json").payload.data.relatedFaqs, [
      { id: "cra-basics/what-is-the-cra", type: "faq", url: "https://cra.orcwg.org/api/v0/faqs/cra-basics/what-is-the-cra.json" }
    ]);
  });

  test("related issues link to the issue on GitHub", () => {
    assert.deepEqual(endpoint("/api/v0/faqs/stewards/demonstrate.json").payload.data.relatedIssues, [
      { id: "11", type: "github", url: "https://github.com/orcwg/cra-hub/issues/11" }
    ]);
  });
});
