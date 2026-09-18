// Copyright 2021 Frank Wagner. Licensed under the MIT License; see LICENSE.
import { expect } from "chai";
import {
  buildElmTestArgs,
  buildElmTestArgsWithReport,
  getFilePath,
} from "../util";

describe("elm-test command", () => {
  it("defaults to elm-test on PATH", () => {
    expect(buildElmTestArgs({})).to.deep.equal(["elm-test"]);
  });

  it("preserves configured binaries and file arguments including spaces", () => {
    expect(
      buildElmTestArgs({ elm: "/local elm", elmTest: "/local elm-test" }, [
        "/tests/My Tests.elm",
        "/tests/Other.elm",
      ]),
    ).to.deep.equal([
      "/local elm-test",
      "--compiler",
      "/local elm",
      "/tests/My Tests.elm",
      "/tests/Other.elm",
    ]);
  });

  it("requests the JSON report without changing the command", () => {
    expect(buildElmTestArgsWithReport(["elm-test", "Tests.elm"])).to.deep.equal(
      ["elm-test", "Tests.elm", "--report", "json"],
    );
  });

  it("maps nested module names to paths", () => {
    expect(
      getFilePath({
        tag: "testCompleted",
        labels: ["Nested.MyTests", "test"],
        duration: 1,
        messages: [],
        status: { tag: "pass" },
      }),
    ).to.equal("Nested/MyTests.elm");
  });
});
