import { expect } from "chai";
import { selectFiles, testId, TestNode } from "../selection";

describe("native test selection", () => {
  const first: TestNode = { id: "first", file: "file:///a.elm" };
  const sibling: TestNode = { id: "sibling", file: "file:///a.elm" };
  const other: TestNode = { id: "other", file: "file:///b.elm" };
  const root: TestNode = {
    id: "root",
    children: [{ id: "suite", children: [first, sibling] }, other],
  };

  it("executes the containing file when one test is selected", () => {
    expect(selectFiles(root, ["first"], [])).to.deep.equal(["file:///a.elm"]);
  });

  it("expands suites and deduplicates files", () => {
    expect(selectFiles(root, ["suite", "first", "other"], [])).to.deep.equal([
      "file:///a.elm",
      "file:///b.elm",
    ]);
  });

  it("runs all files for an unspecified selection or the project root", () => {
    expect(selectFiles(root, undefined, [])).to.deep.equal([
      "file:///a.elm",
      "file:///b.elm",
    ]);
    expect(selectFiles(root, ["root"], [])).to.deep.equal([
      "file:///a.elm",
      "file:///b.elm",
    ]);
    expect(selectFiles(root, [], [])).to.deep.equal([]);
  });

  it("excludes entire suites but retains files with selected siblings", () => {
    expect(selectFiles(root, undefined, ["suite"])).to.deep.equal([
      "file:///b.elm",
    ]);
    expect(selectFiles(root, ["suite"], ["first"])).to.deep.equal([
      "file:///a.elm",
    ]);
    expect(selectFiles(root, undefined, ["root"])).to.deep.equal([]);
  });

  it("keeps label separators distinct from hierarchy", () => {
    expect(testId(["Tests", "a/b"])).not.to.equal(testId(["Tests", "a", "b"]));
  });
});
