import { expect } from "chai";
import { readReport } from "../report";

describe("elm-test report", () => {
  it("reports a suite-level autoFail even when individual tests pass", () => {
    expect(() =>
      readReport(
        [
          '{"event":"runStart","testCount":"1"}',
          '{"event":"testCompleted","labels":["Tests","passes"],"duration":"1","status":"pass"}',
          '{"event":"runComplete","passed":"1","failed":"0","duration":"1","autoFail":"Test.only was used"}',
        ].join("\n"),
      ),
    ).to.throw("Test.only was used");
  });
  it("adds the todo description omitted from elm-test's labels", () => {
    const report = readReport(
      [
        '{"event":"runStart","testCount":"2"}',
        '{"event":"testCompleted","labels":["Tests","suite","passes"],"duration":"1","status":"pass"}',
        '{"event":"testCompleted","labels":["Tests","suite"],"duration":"0","status":"todo","failures":["later"]}',
        '{"event":"runComplete","passed":"1","failed":"0","duration":"1"}',
      ].join("\n"),
    );
    const module = report.children[0];
    if (module.type !== "suite" || module.children[0].type !== "suite")
      throw new Error("Expected nested suites");
    expect(module.children[0].children.map((test) => test.label)).to.deep.equal(
      ["passes", "later"],
    );
  });
  it("rejects a truncated report instead of reporting success", () => {
    expect(() => readReport('{"event":"runStart","testCount":"1"}\n')).to.throw(
      "incomplete",
    );
  });

  it("keeps passes, failures, todos, durations, and debug output", () => {
    const report = readReport(
      [
        '{"event":"runStart","testCount":"3"}',
        "debug output",
        '{"event":"testCompleted","labels":["Tests","passes"],"duration":"12","status":"pass"}',
        '{"event":"testCompleted","labels":["Tests","fails"],"duration":"4","status":"fail","failures":[{"message":"different","reason":{"data":{"comparison":"equal","expected":"1","actual":"2"}}}]}',
        '{"event":"testCompleted","labels":["Tests"],"duration":"0","status":"todo","failures":["implement later"]}',
        '{"event":"runComplete","passed":"1","failed":"1","duration":"16"}',
      ].join("\n"),
    );
    const suite = report.children[0];
    if (suite.type !== "suite") throw new Error("Expected a suite");
    expect(
      suite.children.map((test) => test.type === "test" && test.data),
    ).to.deep.equal([
      {
        tag: "testCompleted",
        labels: ["Tests", "passes"],
        duration: 12,
        messages: ["debug output"],
        status: { tag: "pass" },
      },
      {
        tag: "testCompleted",
        labels: ["Tests", "fails"],
        duration: 4,
        messages: [],
        status: {
          tag: "fail",
          failures: [
            {
              tag: "comparison",
              comparison: "equal",
              expected: "1",
              actual: "2",
            },
          ],
        },
      },
      {
        tag: "testCompleted",
        labels: ["Tests", "implement later"],
        duration: 0,
        messages: [],
        status: { tag: "todo", comment: "implement later" },
      },
    ]);
  });

  it("rejects empty output and a summary with missing results", () => {
    expect(() => readReport("")).to.throw("incomplete");
    expect(() =>
      readReport(
        '{"event":"runStart","testCount":"1"}\n{"event":"runComplete","passed":"1","failed":"0","duration":"1"}',
      ),
    ).to.throw("incomplete");
  });

  it("rejects malformed result JSON even when its event can be recovered", () => {
    expect(() =>
      readReport(
        [
          '{"event":"runStart","testCount":"1"}',
          '{"event":"testCompleted","labels":["Tests","passes"],"duration":"12","status":"pass"',
          '{"event":"runComplete","passed":"1","failed":"0","duration":"12"}',
        ].join("\n"),
      ),
    ).to.throw();
  });
});
