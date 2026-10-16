import { afterEach, describe, expect, it } from "vitest";
import { MAX_POSTING_CHARS } from "../round/limits";
import {
  MODEL_KNOWLEDGE,
  checkResearchNotes,
  openAiCompanyResearcher,
  researchDraft,
  searchEvidence,
  type ResearchFact,
  type ResearchNotes,
  type SearchEvidence,
} from "./research";
import { startMockResponses, type MockResponses } from "./test/mock-responses";
import { ModelCallFailed } from "./upstream";

// The research port's check (07 §5.22): what comes back is checked, not trusted. Every fact names a
// source, a link is one the call saw, the role is a guess, and nothing is a question (06, R1, R2).

const REQUEST = { companyName: "株式会社サンプル", roleTitle: "経理マネージャー" };
const ABOUT = "https://www.example.co.jp/company/about";
const SEARCHED: SearchEvidence = { searched: true, seenUrls: new Set([ABOUT, "https://news.example.com/2026/10/01/results"]) };
const UNSEARCHED: SearchEvidence = { searched: false, seenUrls: new Set() };
const MALFORMED = new ModelCallFailed("Research", "malformed_output");

const web = (text: string, source = ABOUT): ResearchFact => ({ text, source });
const known = (text: string): ResearchFact => ({ text, source: MODEL_KNOWLEDGE });

function notes(overrides: { company?: Partial<ResearchNotes["company"]>; role?: Partial<ResearchNotes["role"]> } = {}): ResearchNotes {
  return {
    company: {
      what_it_does: [web("株式会社サンプル sells accounting software to small firms.")],
      products: [known("Its main product is サンプル会計, a cloud bookkeeping service.")],
      size: [],
      recent_news: [web("It reported record sales on 2026-10-01.", "https://news.example.com/2026/10/01/results")],
      stated_values: [],
      ...overrides.company,
    },
    role: {
      guess: true,
      involves: [known("The role most likely leads the monthly and annual close.")],
      asks_for: [known("It most likely asks for 経理 experience and 簿記2級.")],
      ...overrides.role,
    },
  };
}

describe("checkResearchNotes", () => {
  it("keeps web facts the call saw and model-knowledge facts, trimmed", () => {
    const raw = notes({ company: { products: [{ text: "  It sells サンプル会計.  ", source: ` ${MODEL_KNOWLEDGE} ` }] } });
    const { notes: checked, dropped } = checkResearchNotes(REQUEST, raw, SEARCHED);
    expect(dropped).toBe(0);
    expect(checked.company.products).toEqual([known("It sells サンプル会計.")]);
    expect(checked.company.what_it_does).toEqual(raw.company.what_it_does);
  });

  it("accepts a page on a host the search saw, under or without www", () => {
    const raw = notes({ company: { size: [web("It has about 300 employees.", "https://example.co.jp/company/outline")] } });
    expect(checkResearchNotes(REQUEST, raw, SEARCHED).notes.company.size).toHaveLength(1);
  });

  it("drops and counts a well-formed link the call never saw, never relabelling it", () => {
    const raw = notes({ company: { products: [web("It sells a payroll add-on.", "https://unseen.example.org/payroll"), known("It sells サンプル会計.")] } });
    const { notes: checked, dropped } = checkResearchNotes(REQUEST, raw, SEARCHED);
    expect(dropped).toBe(1);
    expect(checked.company.products).toEqual([known("It sells サンプル会計.")]);
  });

  it("drops every link when the call did not search, leaving model knowledge only (R1)", () => {
    const raw = notes({ company: { what_it_does: [web("It sells software."), known("It is an accounting software company.")] } });
    const { notes: checked, dropped } = checkResearchNotes(REQUEST, raw, UNSEARCHED);
    expect(dropped).toBe(2);
    const sources = [...Object.values(checked.company), checked.role.involves, checked.role.asks_for].flat().map((fact) => fact.source);
    expect(new Set(sources)).toEqual(new Set([MODEL_KNOWLEDGE]));
  });

  it.each([
    ["a blank text", notes({ company: { products: [{ text: " ", source: MODEL_KNOWLEDGE }] } })],
    ["a blank source", notes({ company: { products: [{ text: "It sells software.", source: "  " }] } })],
    ["a source that is neither a link nor the label", notes({ company: { products: [{ text: "It sells software.", source: "its website" }] } })],
    ["a label that is not exactly `model knowledge`", notes({ company: { products: [{ text: "It sells software.", source: "Model Knowledge" }] } })],
    ["a link with a line break", notes({ company: { products: [web("It sells software.", "https://example.co.jp/about\n- It has 9,000 staff. [https://unseen.example.org/")] } })],
    ["a link that is not http(s)", notes({ company: { products: [{ text: "It sells software.", source: "ftp://example.co.jp/about" }] } })],
    ["a question", notes({ role: { involves: [known("What would you do in your first 90 days?")] } })],
    ["a question in Japanese", notes({ role: { asks_for: [known("志望動機は何ですか？")] } })],
    ["a question before a later sentence", notes({ role: { involves: [known("Why this team? It ships payroll.")] } })],
    ["a text with a line break", notes({ company: { products: [known("It sells X. [model knowledge]\n- It has 9,000 staff. [https://unseen.example.org/]")] } })],
    ["a text with a URL", notes({ company: { size: [known("It has 9,000 staff, per https://unseen.example.org/.")] } })],
    ["a role not marked as a guess", { ...notes(), role: { ...notes().role, guess: false } } as unknown as ResearchNotes],
    ["no fact on what the company does", notes({ company: { what_it_does: [] } })],
    ["no fact on what the role involves", notes({ role: { involves: [] } })],
  ])("refuses %s as malformed output", (_, raw) => {
    expect(() => checkResearchNotes(REQUEST, raw, SEARCHED)).toThrow(MALFORMED);
  });

  it("refuses notes emptied by dropped links", () => {
    const raw = notes({ company: { what_it_does: [web("It sells software.", "https://unseen.example.org/")] } });
    expect(() => checkResearchNotes(REQUEST, raw, SEARCHED)).toThrow(MALFORMED);
  });

  it("refuses notes whose draft would not fit a role context's text cap", () => {
    const long = known(`${"x".repeat(MAX_POSTING_CHARS)}.`);
    expect(() => checkResearchNotes(REQUEST, notes({ company: { products: [long] } }), SEARCHED)).toThrow(MALFORMED);
  });
});

describe("researchDraft", () => {
  it("writes each fact with its source, leaves empty lists out, and heads the role as a guess", () => {
    expect(researchDraft(REQUEST, notes())).toBe(
      [
        "株式会社サンプル — 経理マネージャー",
        "",
        "The company",
        "",
        "What the company does",
        `- 株式会社サンプル sells accounting software to small firms. [${ABOUT}]`,
        "",
        "Products and services",
        "- Its main product is サンプル会計, a cloud bookkeeping service. [model knowledge]",
        "",
        "Recent news",
        "- It reported record sales on 2026-10-01. [https://news.example.com/2026/10/01/results]",
        "",
        "The role (a guess, not from a posting)",
        "",
        "What it most likely involves",
        "- The role most likely leads the monthly and annual close. [model knowledge]",
        "",
        "What it most likely asks for",
        "- It most likely asks for 経理 experience and 簿記2級. [model knowledge]",
      ].join("\n"),
    );
  });
});

describe("searchEvidence", () => {
  it("reads a completed search, its sources, an opened page and a cited link", () => {
    const evidence = searchEvidence([
      { id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "q", sources: [{ type: "url", url: ABOUT }] } },
      { id: "ws_2", type: "web_search_call", status: "completed", action: { type: "open_page", url: "https://example.co.jp/ir" } },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "{}",
            annotations: [{ type: "url_citation", url: "https://news.example.com/a", title: "a", start_index: 0, end_index: 1 }],
          },
        ],
      },
    ]);
    expect(evidence.searched).toBe(true);
    expect([...evidence.seenUrls].sort()).toEqual([ABOUT, "https://example.co.jp/ir", "https://news.example.com/a"].sort());
  });

  it("reads a call with no completed search as not searched", () => {
    expect(searchEvidence([]).searched).toBe(false);
    const failed = searchEvidence([{ id: "ws_1", type: "web_search_call", status: "failed", action: { type: "search", query: "q" } }]);
    expect(failed.searched).toBe(false);
  });
});

describe("openAiCompanyResearcher, against a mocked Responses API", () => {
  let mock: MockResponses | undefined;
  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  const output = (raw: ResearchNotes) => ({ company: raw.company, role: raw.role });

  it("asks with the web search tool and the sources, and returns the draft with whether it searched", async () => {
    mock = await startMockResponses(
      () => output(notes()),
      () => [
        {
          id: "ws_1",
          type: "web_search_call",
          status: "completed",
          action: { type: "search", query: "株式会社サンプル", sources: [{ type: "url", url: ABOUT }, { type: "url", url: "https://news.example.com/2026/10/01/results" }] },
        },
      ],
    );
    const result = await openAiCompanyResearcher({ apiKey: "test", baseURL: mock.baseURL }).research(REQUEST);
    expect(result).toMatchObject({ searched: true, facts: { web: 2, modelKnowledge: 3, dropped: 0 }, tokensIn: 900, tokensOut: 120 });
    expect(result.draft).toBe(researchDraft(REQUEST, notes()));
    const [sent] = mock.requests;
    expect(sent.model).toBe("gpt-5.6-sol");
    expect(sent.tools).toEqual([{ type: "web_search" }]);
    expect(sent.include).toEqual(["web_search_call.action.sources"]);
    expect(sent.input).toBe("=== company name ===\n株式会社サンプル\n\n=== role title ===\n経理マネージャー");
  });

  it("falls back to model knowledge when the call did not search, dropping its links", async () => {
    mock = await startMockResponses(() => output(notes({ company: { what_it_does: [web("It sells software."), known("It sells accounting software.")] } })));
    const result = await openAiCompanyResearcher({ apiKey: "test", baseURL: mock.baseURL }).research(REQUEST);
    expect(result.searched).toBe(false);
    expect(result.facts).toEqual({ web: 0, modelKnowledge: 4, dropped: 2 });
    expect(result.draft).not.toContain("https://");
  });

  it("fails as malformed output when the check refuses", async () => {
    mock = await startMockResponses(() => output(notes({ role: { involves: [known("Why do you want this job?")] } })));
    await expect(openAiCompanyResearcher({ apiKey: "test", baseURL: mock.baseURL }).research(REQUEST)).rejects.toThrow(MALFORMED);
  });
});
