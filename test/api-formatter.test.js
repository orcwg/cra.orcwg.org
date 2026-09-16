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

const pages = createApiArray({ faqs: [faq] });
const page = pages.find((p) => p.endpoint === "/api/v0/faqs/cra-basics/what-is-the-cra.json");

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
});
